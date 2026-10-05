// JNI bridge to Azahar, the Nintendo 3DS emulator, through its libretro
// core (libazahar_libretro.so, prebuilt by n3dscore/build-azahar.cmd).
// A libretro frontend trimmed to what this app needs -- the desktop port's
// src/native/n3ds_addon.cpp is the reference this follows, with EGL/GLES in
// place of WGL/OpenGL 4.3.
//
// The core renders into a framebuffer object we hand it, and that is blitted
// straight onto the view's surface: no readback to the CPU. Everything here
// runs on N3dsView's emulation thread, the one the EGL context is current on.
//
// The core keeps its emulator in globals, so there is only ever one console,
// and the state below is global too.
#include <jni.h>

#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <GLES3/gl32.h>
#include <android/log.h>
#include <android/native_window_jni.h>
#include <dlfcn.h>

#include <algorithm>
#include <atomic>
#include <cerrno>
#include <cstdarg>
#include <cstring>
#include <mutex>
#include <string>
#include <sys/stat.h>
#include <vector>

#include "libretro.h"

#define LOG_TAG "n3ds"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

namespace {

// ---- the core ----
void* g_core = nullptr;
void (*g_retroRun)() = nullptr;
retro_hw_render_callback* g_hwRender = nullptr;
bool g_initialized = false;
bool g_loaded = false;
bool g_noGame = false;
std::string g_lastMessage;
std::string g_dataDir;
retro_system_av_info g_av{};

// ---- GL ----
EGLDisplay g_display = EGL_NO_DISPLAY;
EGLConfig g_config = nullptr;
EGLContext g_context = EGL_NO_CONTEXT;
EGLSurface g_pbuffer = EGL_NO_SURFACE;
EGLSurface g_window = EGL_NO_SURFACE;
ANativeWindow* g_nativeWindow = nullptr;
GLuint g_fbo = 0, g_texture = 0, g_depth = 0;
unsigned g_pictureWidth = 0, g_pictureHeight = 0;
bool g_hasPicture = false;

// ---- input / audio ----
std::atomic<uint32_t> g_keys{0};  // set from the UI thread, read on the emulation thread
std::mutex g_audioLock;
std::vector<int16_t> g_audio;

template <typename T>
T coreSymbol(const char* name) {
    return reinterpret_cast<T>(dlsym(g_core, name));
}

// Core GLES entry points come from libGLESv3 itself; eglGetProcAddress only
// promises extensions on older Android versions.
retro_proc_address_t GetGlProc(const char* name) {
    static void* gles = dlopen("libGLESv3.so", RTLD_NOW | RTLD_LOCAL);
    void* proc = gles ? dlsym(gles, name) : nullptr;
    if (!proc) proc = reinterpret_cast<void*>(eglGetProcAddress(name));
    return reinterpret_cast<retro_proc_address_t>(proc);
}

void RetroLog(enum retro_log_level level, const char* format, ...) {
    if (level < RETRO_LOG_WARN) return;
    va_list args;
    va_start(args, format);
    __android_log_vprint(level >= RETRO_LOG_ERROR ? ANDROID_LOG_ERROR : ANDROID_LOG_WARN, "azahar", format, args);
    va_end(args);
}

uintptr_t CurrentFramebuffer() { return g_fbo; }

// The options this app sets; anything else keeps the core's own default.
// The console runs in Spanish, the language of this app.
const char* Option(const char* key) {
    if (std::strcmp(key, "citra_language_value") == 0) return "Spanish";
    return nullptr;
}

bool Environment(unsigned cmd, void* data) {
    switch (cmd) {
    case RETRO_ENVIRONMENT_GET_PREFERRED_HW_RENDER:
        *static_cast<unsigned*>(data) = RETRO_HW_CONTEXT_OPENGLES3;
        return true;
    case RETRO_ENVIRONMENT_SET_HW_RENDER: {
        auto* hw = static_cast<retro_hw_render_callback*>(data);
        if (hw->context_type != RETRO_HW_CONTEXT_OPENGLES3 && hw->context_type != RETRO_HW_CONTEXT_OPENGLES_VERSION) {
            return false;
        }
        hw->get_current_framebuffer = &CurrentFramebuffer;
        hw->get_proc_address = &GetGlProc;
        g_hwRender = hw;
        return true;
    }
    case RETRO_ENVIRONMENT_SET_PIXEL_FORMAT:
        return *static_cast<retro_pixel_format*>(data) == RETRO_PIXEL_FORMAT_XRGB8888;
    case RETRO_ENVIRONMENT_GET_LOG_INTERFACE:
        static_cast<retro_log_callback*>(data)->log = &RetroLog;
        return true;
    case RETRO_ENVIRONMENT_GET_SAVE_DIRECTORY:
    case RETRO_ENVIRONMENT_GET_SYSTEM_DIRECTORY:
        *static_cast<const char**>(data) = g_dataDir.c_str();
        return true;
    case RETRO_ENVIRONMENT_GET_VARIABLE: {
        auto* variable = static_cast<retro_variable*>(data);
        variable->value = Option(variable->key);
        return variable->value != nullptr;
    }
    case RETRO_ENVIRONMENT_GET_VARIABLE_UPDATE:
        *static_cast<bool*>(data) = false;
        return true;
    case RETRO_ENVIRONMENT_GET_CAN_DUPE:
        *static_cast<bool*>(data) = true;
        return true;
    case RETRO_ENVIRONMENT_SET_MESSAGE:
        g_lastMessage = static_cast<retro_message*>(data)->msg;
        LOGI("core: %s", g_lastMessage.c_str());
        return true;
    // Told, and nothing to do about it.
    case RETRO_ENVIRONMENT_SET_VARIABLES:
    case RETRO_ENVIRONMENT_SET_CORE_OPTIONS:
    case RETRO_ENVIRONMENT_SET_CORE_OPTIONS_V2:
    case RETRO_ENVIRONMENT_SET_INPUT_DESCRIPTORS:
    case RETRO_ENVIRONMENT_SET_CONTROLLER_INFO:
    case RETRO_ENVIRONMENT_SET_MEMORY_MAPS:
    case RETRO_ENVIRONMENT_SET_SERIALIZATION_QUIRKS:
    case RETRO_ENVIRONMENT_SET_HW_SHARED_CONTEXT:
    case RETRO_ENVIRONMENT_SET_GEOMETRY:
        return true;
    default:
        return false;
    }
}

void VideoRefresh(const void* data, unsigned width, unsigned height, size_t) {
    // An empty 0x0 frame is what the core hands over with no game running.
    if (!data && width == 0) g_noGame = true;
    if (data != RETRO_HW_FRAME_BUFFER_VALID) return;  // a dupe keeps the last picture
    g_pictureWidth = width;
    g_pictureHeight = height;
    g_hasPicture = true;
}

void PushAudio(const int16_t* samples, size_t count) {
    std::lock_guard<std::mutex> lock(g_audioLock);
    g_audio.insert(g_audio.end(), samples, samples + count);
    // Nobody draining (no AudioTrack yet, or paused): keep at most ~1s.
    const size_t cap = static_cast<size_t>(std::max(1.0, g_av.timing.sample_rate)) * 2;
    if (g_audio.size() > cap) g_audio.erase(g_audio.begin(), g_audio.end() - cap);
}

void AudioSample(int16_t left, int16_t right) {
    const int16_t frame[2] = {left, right};
    PushAudio(frame, 2);
}

size_t AudioBatch(const int16_t* data, size_t frames) {
    PushAudio(data, frames * 2);
    return frames;
}

void InputPoll() {}

int16_t InputState(unsigned port, unsigned device, unsigned index, unsigned id) {
    if (port != 0) return 0;
    if (device == RETRO_DEVICE_JOYPAD) return (g_keys >> id) & 1;
    // The Circle Pad follows the D-pad until there is an analog control:
    // plenty of 3DS games move only with the stick.
    if (device == RETRO_DEVICE_ANALOG && index == RETRO_DEVICE_INDEX_ANALOG_LEFT) {
        auto held = [](unsigned button) { return static_cast<int>((g_keys >> button) & 1); };
        const int axis = id == RETRO_DEVICE_ID_ANALOG_X
                             ? held(RETRO_DEVICE_ID_JOYPAD_RIGHT) - held(RETRO_DEVICE_ID_JOYPAD_LEFT)
                             : held(RETRO_DEVICE_ID_JOYPAD_DOWN) - held(RETRO_DEVICE_ID_JOYPAD_UP);
        return static_cast<int16_t>(axis * 0x7FFF);
    }
    return 0;
}

// The core creates only the last level of its data folder, and if the parent
// is missing it quietly falls back to a default path. Make all of it.
void MakeDirs(const std::string& path) {
    for (size_t i = 1; i <= path.size(); i++) {
        if (i == path.size() || path[i] == '/') mkdir(path.substr(0, i).c_str(), 0700);
    }
}

std::string CreateContext() {
    g_display = eglGetDisplay(EGL_DEFAULT_DISPLAY);
    if (g_display == EGL_NO_DISPLAY || !eglInitialize(g_display, nullptr, nullptr)) return "EGL no disponible";
    const EGLint configAttribs[] = {
        EGL_SURFACE_TYPE, EGL_WINDOW_BIT | EGL_PBUFFER_BIT,
        EGL_RENDERABLE_TYPE, EGL_OPENGL_ES3_BIT_KHR,
        EGL_RED_SIZE, 8, EGL_GREEN_SIZE, 8, EGL_BLUE_SIZE, 8, EGL_ALPHA_SIZE, 8,
        EGL_NONE,
    };
    EGLint count = 0;
    if (!eglChooseConfig(g_display, configAttribs, &g_config, 1, &count) || count == 0) return "sin configuración EGL";
    const EGLint pbufferAttribs[] = {EGL_WIDTH, 4, EGL_HEIGHT, 4, EGL_NONE};
    g_pbuffer = eglCreatePbufferSurface(g_display, g_config, pbufferAttribs);
    // The core asks for OpenGL ES 3.2 (see citra_libretro.cpp).
    const EGLint contextAttribs[] = {EGL_CONTEXT_MAJOR_VERSION_KHR, 3, EGL_CONTEXT_MINOR_VERSION_KHR, 2, EGL_NONE};
    g_context = eglCreateContext(g_display, g_config, EGL_NO_CONTEXT, contextAttribs);
    if (g_context == EGL_NO_CONTEXT) return "este teléfono no ofrece OpenGL ES 3.2, que el 3DS necesita";
    if (!eglMakeCurrent(g_display, g_pbuffer, g_pbuffer, g_context)) return "eglMakeCurrent falló";
    LOGI("GL: %s / %s", glGetString(GL_RENDERER), glGetString(GL_VERSION));
    return {};
}

std::string CreateFramebuffer(unsigned width, unsigned height) {
    glGenTextures(1, &g_texture);
    glBindTexture(GL_TEXTURE_2D, g_texture);
    glTexStorage2D(GL_TEXTURE_2D, 1, GL_RGBA8, width, height);
    glGenRenderbuffers(1, &g_depth);
    glBindRenderbuffer(GL_RENDERBUFFER, g_depth);
    glRenderbufferStorage(GL_RENDERBUFFER, GL_DEPTH24_STENCIL8, width, height);
    glGenFramebuffers(1, &g_fbo);
    glBindFramebuffer(GL_FRAMEBUFFER, g_fbo);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, g_texture, 0);
    glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_DEPTH_STENCIL_ATTACHMENT, GL_RENDERBUFFER, g_depth);
    if (glCheckFramebufferStatus(GL_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE) return "framebuffer incompleto";
    return {};
}

// Blits the last picture onto the window, letterboxed to its aspect ratio
// and anchored to the top, then shows it.
void Present() {
    if (g_window == EGL_NO_SURFACE || !g_hasPicture) return;
    EGLint surfaceWidth = 0, surfaceHeight = 0;
    eglQuerySurface(g_display, g_window, EGL_WIDTH, &surfaceWidth);
    eglQuerySurface(g_display, g_window, EGL_HEIGHT, &surfaceHeight);
    const float scale = std::min(float(surfaceWidth) / g_pictureWidth, float(surfaceHeight) / g_pictureHeight);
    const int width = int(g_pictureWidth * scale), height = int(g_pictureHeight * scale);
    const int x = (surfaceWidth - width) / 2;
    const int top = surfaceHeight;  // GL's y grows upwards: the top edge of the window

    glDisable(GL_SCISSOR_TEST);
    glBindFramebuffer(GL_DRAW_FRAMEBUFFER, 0);
    glViewport(0, 0, surfaceWidth, surfaceHeight);
    glClearColor(0, 0, 0, 1);
    glClear(GL_COLOR_BUFFER_BIT);
    glBindFramebuffer(GL_READ_FRAMEBUFFER, g_fbo);
    glBlitFramebuffer(0, 0, g_pictureWidth, g_pictureHeight, x, top - height, x + width, top, GL_COLOR_BUFFER_BIT,
                      GL_LINEAR);
    eglSwapBuffers(g_display, g_window);
}

void Stop() {
    if (g_context != EGL_NO_CONTEXT) eglMakeCurrent(g_display, g_pbuffer, g_pbuffer, g_context);
    if (g_core) {
        if (g_loaded) {
            if (g_hwRender && g_hwRender->context_destroy) g_hwRender->context_destroy();
            coreSymbol<void (*)()>("retro_unload_game")();
        }
        if (g_initialized) coreSymbol<void (*)()>("retro_deinit")();
    }
    if (g_fbo) glDeleteFramebuffers(1, &g_fbo);
    if (g_depth) glDeleteRenderbuffers(1, &g_depth);
    if (g_texture) glDeleteTextures(1, &g_texture);
    g_fbo = g_depth = g_texture = 0;
    if (g_display != EGL_NO_DISPLAY) {
        eglMakeCurrent(g_display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
        if (g_window != EGL_NO_SURFACE) eglDestroySurface(g_display, g_window);
        if (g_pbuffer != EGL_NO_SURFACE) eglDestroySurface(g_display, g_pbuffer);
        if (g_context != EGL_NO_CONTEXT) eglDestroyContext(g_display, g_context);
    }
    if (g_nativeWindow) ANativeWindow_release(g_nativeWindow);
    g_window = g_pbuffer = EGL_NO_SURFACE;
    g_context = EGL_NO_CONTEXT;
    g_nativeWindow = nullptr;
    // dlclose doesn't reliably unload on Android; the core is reused as-is
    // across games, through retro_deinit/retro_init.
    g_loaded = g_initialized = g_hasPicture = g_noGame = false;
    g_hwRender = nullptr;
    g_keys = 0;
    std::lock_guard<std::mutex> lock(g_audioLock);
    g_audio.clear();
}

std::string Start(const std::string& romPath, const std::string& dataDir) {
    g_dataDir = dataDir;
    MakeDirs(g_dataDir);
    g_lastMessage.clear();

    if (!g_core) g_core = dlopen("libazahar_libretro.so", RTLD_NOW | RTLD_LOCAL);
    if (!g_core) return std::string("no se pudo cargar el núcleo de 3DS: ") + dlerror();
    g_retroRun = coreSymbol<void (*)()>("retro_run");

    std::string error = CreateContext();
    if (!error.empty()) return error;

    coreSymbol<void (*)(retro_environment_t)>("retro_set_environment")(&Environment);
    coreSymbol<void (*)(retro_video_refresh_t)>("retro_set_video_refresh")(&VideoRefresh);
    coreSymbol<void (*)(retro_audio_sample_t)>("retro_set_audio_sample")(&AudioSample);
    coreSymbol<void (*)(retro_audio_sample_batch_t)>("retro_set_audio_sample_batch")(&AudioBatch);
    coreSymbol<void (*)(retro_input_poll_t)>("retro_set_input_poll")(&InputPoll);
    coreSymbol<void (*)(retro_input_state_t)>("retro_set_input_state")(&InputState);
    coreSymbol<void (*)()>("retro_init")();
    g_initialized = true;

    retro_game_info game{};
    game.path = romPath.c_str();
    if (!coreSymbol<bool (*)(const retro_game_info*)>("retro_load_game")(&game)) {
        return "el núcleo de 3DS no pudo cargar el juego" + (g_lastMessage.empty() ? "" : " (" + g_lastMessage + ")");
    }
    g_loaded = true;
    if (!g_hwRender) return "el núcleo de 3DS no pidió OpenGL ES";

    coreSymbol<void (*)(retro_system_av_info*)>("retro_get_system_av_info")(&g_av);
    LOGI("geometry %ux%u (max %ux%u), %.3f fps, %.0f Hz", g_av.geometry.base_width, g_av.geometry.base_height,
         g_av.geometry.max_width, g_av.geometry.max_height, g_av.timing.fps, g_av.timing.sample_rate);
    error = CreateFramebuffer(std::max(g_av.geometry.max_width, g_av.geometry.base_width),
                              std::max(g_av.geometry.max_height, g_av.geometry.base_height));
    if (!error.empty()) return error;

    // The game itself is loaded here: the core waits for its GL context
    // before reading the ROM. A game it can't load (encrypted, damaged)
    // still returns without complaint; the first frame comes out empty.
    g_hwRender->context_reset();
    g_retroRun();
    if (g_noGame) {
        return "el núcleo de 3DS no pudo arrancar el juego" +
               (g_lastMessage.empty() ? std::string(". ¿Está cifrado?") : ": " + g_lastMessage);
    }
    return {};
}

std::string FromJava(JNIEnv* env, jstring value) {
    const char* chars = env->GetStringUTFChars(value, nullptr);
    std::string result(chars);
    env->ReleaseStringUTFChars(value, chars);
    return result;
}

}  // namespace

extern "C" {

// Returns null on success, else why the game couldn't start (already tidied up).
JNIEXPORT jstring JNICALL Java_com_multiemu_n3dscore_N3dsNative_nativeStart(JNIEnv* env, jclass, jstring romPath,
                                                                             jstring dataDir) {
    std::string error = Start(FromJava(env, romPath), FromJava(env, dataDir));
    if (error.empty()) return nullptr;
    LOGE("%s", error.c_str());
    Stop();
    return env->NewStringUTF(error.c_str());
}

JNIEXPORT void JNICALL Java_com_multiemu_n3dscore_N3dsNative_nativeStop(JNIEnv*, jclass) { Stop(); }

// surface null detaches (the view's surface is going away).
JNIEXPORT void JNICALL Java_com_multiemu_n3dscore_N3dsNative_nativeSetSurface(JNIEnv* env, jclass, jobject surface) {
    if (g_context == EGL_NO_CONTEXT) return;
    eglMakeCurrent(g_display, g_pbuffer, g_pbuffer, g_context);
    if (g_window != EGL_NO_SURFACE) eglDestroySurface(g_display, g_window);
    if (g_nativeWindow) ANativeWindow_release(g_nativeWindow);
    g_window = EGL_NO_SURFACE;
    g_nativeWindow = nullptr;
    if (!surface) return;
    g_nativeWindow = ANativeWindow_fromSurface(env, surface);
    if (!g_nativeWindow) return;
    g_window = eglCreateWindowSurface(g_display, g_config, g_nativeWindow, nullptr);
    if (g_window == EGL_NO_SURFACE || !eglMakeCurrent(g_display, g_window, g_window, g_context)) {
        LOGE("eglCreateWindowSurface failed: 0x%x", eglGetError());
        if (g_window != EGL_NO_SURFACE) eglDestroySurface(g_display, g_window);
        g_window = EGL_NO_SURFACE;
        eglMakeCurrent(g_display, g_pbuffer, g_pbuffer, g_context);
        return;
    }
    // Pacing is N3dsView's job; waiting for vsync here would quantize it.
    eglSwapInterval(g_display, 0);
}

JNIEXPORT void JNICALL Java_com_multiemu_n3dscore_N3dsNative_nativeRunFrame(JNIEnv*, jclass) {
    if (!g_loaded) return;
    g_retroRun();
    Present();
}

JNIEXPORT jint JNICALL Java_com_multiemu_n3dscore_N3dsNative_nativeReadAudio(JNIEnv* env, jclass, jshortArray out) {
    std::lock_guard<std::mutex> lock(g_audioLock);
    const size_t count = std::min(static_cast<size_t>(env->GetArrayLength(out)), g_audio.size()) & ~size_t(1);
    env->SetShortArrayRegion(out, 0, static_cast<jsize>(count), g_audio.data());
    g_audio.erase(g_audio.begin(), g_audio.begin() + count);
    return static_cast<jint>(count / 2);
}

JNIEXPORT jint JNICALL Java_com_multiemu_n3dscore_N3dsNative_nativeSampleRate(JNIEnv*, jclass) {
    return static_cast<jint>(g_av.timing.sample_rate);
}

JNIEXPORT jdouble JNICALL Java_com_multiemu_n3dscore_N3dsNative_nativeFps(JNIEnv*, jclass) { return g_av.timing.fps; }

// id is a RETRO_DEVICE_ID_JOYPAD_* value.
JNIEXPORT void JNICALL Java_com_multiemu_n3dscore_N3dsNative_nativeSetButton(JNIEnv*, jclass, jint id,
                                                                              jboolean pressed) {
    if (id < 0 || id > 15) return;
    if (pressed)
        g_keys |= 1u << id;
    else
        g_keys &= ~(1u << id);
}

}  // extern "C"
