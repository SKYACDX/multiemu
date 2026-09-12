// JNI bridge for NDS emulation -- see gba_jni.cpp for the equivalent GBA
// bridge over mGBA. Platform:: (file I/O/threading/logging/save
// persistence) is implemented in ds_platform.cpp; this file is just the
// create/loadROM/runFrame/framebuffer/input surface on top of it.
//
// Boot strategy: NDSArgs' defaults are melonDS's own "FreeBIOS" (an
// open-source ARM9/ARM7 BIOS reimplementation) and generated firmware --
// deliberately not overridden here, so no real Nintendo BIOS/firmware
// dump is required. FreeBIOS can't boot through the firmware menu, so
// every boot is a "direct boot" straight into the cartridge (see
// NDS::NeedsDirectBoot/SetupDirectBoot below) -- that's normal for this
// setup, not a workaround.
#include <jni.h>

#include <cstdio>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

#include <android/log.h>
#include <unistd.h>
#include <android/native_window.h>
#include <android/native_window_jni.h>
#include <EGL/egl.h>
#include <GLES3/gl32.h>

#include "Args.h"
#include "GBACart.h"
#include "GPU3D_OpenGL.h"
#include "NDS.h"
#include "NDSCart.h"
#include "Savestate.h"

using namespace melonDS;

namespace {

// One process-wide GLES context, plus whichever surface it's currently
// drawing into. There are two kinds of surface here:
//
//  - a tiny pbuffer, used before DsView hands over a real Surface (and
//    whenever it takes one away). Nothing is ever presented from it; it
//    exists only because an EGL context needs *a* surface to be current,
//    and melonDS still wants to render frames in the meantime.
//  - a window surface wrapping DsView's SurfaceView. This is the real
//    display path: the GL compositor's output gets blitted straight into
//    it and swapped, with no CPU round trip (no glReadPixels, no Bitmap,
//    no Canvas) -- see BlitOutputToScreen and nativeSetSurface.
//
// All of this is thread-bound: every one of these calls, and every GL
// call in a frame, has to happen on the same OS thread (DsView's emu
// thread). nativeSetSurface is therefore posted onto that thread rather
// than called straight from the UI thread -- see DsView.kt.
EGLDisplay g_eglDisplay = EGL_NO_DISPLAY;
EGLContext g_eglContext = EGL_NO_CONTEXT;
EGLConfig g_eglConfig = nullptr;
EGLSurface g_pbufferSurface = EGL_NO_SURFACE;
EGLSurface g_windowSurface = EGL_NO_SURFACE;
ANativeWindow* g_nativeWindow = nullptr;

bool EnsureGLContext() {
    if (g_eglContext != EGL_NO_CONTEXT) return true;

    EGLDisplay display = eglGetDisplay(EGL_DEFAULT_DISPLAY);
    if (display == EGL_NO_DISPLAY || !eglInitialize(display, nullptr, nullptr)) {
        __android_log_print(ANDROID_LOG_ERROR, "melonDS", "GL renderer: eglGetDisplay/eglInitialize failed");
        return false;
    }

    // WINDOW_BIT *and* PBUFFER_BIT: the same config has to serve both
    // surface kinds, since the context is created once and then moved
    // between them as DsView's Surface comes and goes.
    const EGLint configAttribs[] = {
        EGL_SURFACE_TYPE, EGL_WINDOW_BIT | EGL_PBUFFER_BIT,
        EGL_RENDERABLE_TYPE, EGL_OPENGL_ES3_BIT,
        EGL_RED_SIZE, 8, EGL_GREEN_SIZE, 8, EGL_BLUE_SIZE, 8, EGL_ALPHA_SIZE, 8,
        EGL_NONE,
    };
    EGLConfig config;
    EGLint numConfigs = 0;
    if (!eglChooseConfig(display, configAttribs, &config, 1, &numConfigs) || numConfigs == 0) {
        __android_log_print(ANDROID_LOG_ERROR, "melonDS", "GL renderer: eglChooseConfig failed");
        return false;
    }

    const EGLint pbufferAttribs[] = {EGL_WIDTH, 4, EGL_HEIGHT, 4, EGL_NONE};
    EGLSurface pbuffer = eglCreatePbufferSurface(display, config, pbufferAttribs);

    const EGLint contextAttribs[] = {EGL_CONTEXT_CLIENT_VERSION, 3, EGL_NONE};
    EGLContext context = eglCreateContext(display, config, EGL_NO_CONTEXT, contextAttribs);
    if (!context || pbuffer == EGL_NO_SURFACE || !eglMakeCurrent(display, pbuffer, pbuffer, context)) {
        __android_log_print(ANDROID_LOG_ERROR, "melonDS", "GL renderer: eglCreateContext/eglMakeCurrent failed");
        return false;
    }

    g_eglDisplay = display;
    g_eglConfig = config;
    g_pbufferSurface = pbuffer;
    g_eglContext = context;
    // tid matters, not trivia: this context is bound to whichever thread
    // got here first, and every later GL call (frames, nativeSetSurface)
    // silently no-ops from any other one -- so it has to match the tid
    // logged by the window-surface line below.
    __android_log_print(
        ANDROID_LOG_INFO, "melonDS", "GL renderer: context ready on tid %d, GL_VERSION: %s",
        gettid(), glGetString(GL_VERSION));
    return true;
}

// One emulated console + the bits Platform:: callbacks (ds_platform.cpp)
// need out-of-band -- SRAM writeback goes through the cart's own
// userdata (see NDSCart.cpp's Platform::WriteNDSSave call sites), which
// is this struct's address, kept alive for as long as the session is.
struct DsSession {
    std::unique_ptr<NDS> nds;
    std::string savePath;
    // Save path for whatever GBA cart is currently in the slot-2 (see
    // nativeInsertGbaCart) -- separate from savePath (the NDS cart's
    // own save), empty when no GBA cart is inserted.
    std::string gbaSavePath;
    // DS KeyInput is active-low (see NDS::SetKeyMask): bit 0 = 1 means
    // "not pressed". Same first-10-bit order as GbaButton (A, B, SELECT,
    // START, RIGHT, LEFT, UP, DOWN, R, L), with X/Y added at 10/11.
    u32 keyMask = 0xFFF;
    // Set on the first nativeRunFrame call (see TryEnableGLRenderer) so
    // the GL renderer is only ever attempted once per session, whether
    // or not it actually succeeds.
    bool glRendererAttempted = false;
    // Both screens, already composited (2D+3D) by melonDS's own GL
    // compositor -- see nativeRunFrame's comment on why this replaces
    // PrepareCaptureFrame/GetLine for the accelerated renderer. RGBA8,
    // 256 wide, resized to the compositor's actual output height (only
    // used -- and only ever non-empty -- when accelerated).
    std::vector<u8> compositedOutput;
};

DsSession* handleToSession(jlong handle) { return reinterpret_cast<DsSession*>(handle); }

// Swaps in the OpenGL 3D renderer if a GLES context could be set up --
// falls back to melonDS's default software renderer (already active,
// nothing to undo) on any failure. See docs/melonds-setup.md.
void TryEnableGLRenderer(DsSession* session) {
    if (!EnsureGLContext()) return;

    auto glRenderer = GLRenderer::New();
    if (!glRenderer) {
        __android_log_print(ANDROID_LOG_ERROR, "melonDS", "GL renderer: GLRenderer::New() failed, staying on software renderer");
        return;
    }
    // ScaleFactor/ScreenW/ScreenH all default-construct to 0 (see
    // GPU3D_OpenGL.h) -- a real frontend (e.g. melonDS's own Qt UI)
    // always calls this explicitly from a user-facing render-scale
    // setting, so without it every framebuffer/texture GLRenderer::New()
    // allocated is sized 0x0 and nothing ever actually renders (a black
    // screen -- the GPU has nothing to draw into, not a driver bug).
    // Scale 1 = native 256x192, no supersampling upscale.
    glRenderer->SetScaleFactor(1);
    // GPU::SetRenderer3D (not GPU3D.SetCurrentRenderer directly!) --
    // it also calls InitFramebuffers(), which resizes GPU::Framebuffer
    // to the wider layout the accelerated path needs ((256*3+1)*192,
    // vs plain 256*192 for software). Calling SetCurrentRenderer
    // directly skips that resize, leaving Framebuffer allocated at the
    // old, smaller size while GPU2D_Soft.cpp's DrawScanline (which
    // doesn't care which renderer is active) keeps writing at the new,
    // wider stride -- a heap-buffer-overflow past the smaller
    // allocation, confirmed with ASan (see docs/melonds-setup.md).
    session->nds->GPU.SetRenderer3D(std::move(glRenderer));
    __android_log_print(ANDROID_LOG_INFO, "melonDS", "GL renderer: active");
}

// Reads an existing save file whole, if any -- ParseROM wants the
// cart's initial SRAM contents up front, not lazily.
void LoadExistingSave(const std::string& path, NDSCart::NDSCartArgs& cartArgs) {
    if (path.empty()) return;
    FILE* f = fopen(path.c_str(), "rb");
    if (!f) return;
    fseek(f, 0, SEEK_END);
    long len = ftell(f);
    fseek(f, 0, SEEK_SET);
    if (len > 0) {
        auto data = std::make_unique<u8[]>(static_cast<size_t>(len));
        fread(data.get(), 1, static_cast<size_t>(len), f);
        cartArgs.SRAM = std::move(data);
        cartArgs.SRAMLength = static_cast<u32>(len);
    }
    fclose(f);
}

// Reads a whole file into memory, or returns {nullptr, 0} if it
// doesn't exist/can't be opened -- used for both the GBA cart ROM
// (nativeInsertGbaCart) and its existing save file, if any. GBA ROMs
// run at most 32MB, so unlike the main NDS ROM path this never needs
// to avoid holding the whole file in memory.
std::pair<std::unique_ptr<u8[]>, u32> ReadFileBytes(const std::string& path) {
    if (path.empty()) return {nullptr, 0};
    FILE* f = fopen(path.c_str(), "rb");
    if (!f) return {nullptr, 0};
    fseek(f, 0, SEEK_END);
    long len = ftell(f);
    fseek(f, 0, SEEK_SET);
    if (len <= 0) {
        fclose(f);
        return {nullptr, 0};
    }
    auto data = std::make_unique<u8[]>(static_cast<size_t>(len));
    fread(data.get(), 1, static_cast<size_t>(len), f);
    fclose(f);
    return {std::move(data), static_cast<u32>(len)};
}

// Shared by nativeCreate/nativeCreateFromPath -- everything past "have
// the ROM bytes in memory" is identical either way.
jlong CreateFromRomData(std::unique_ptr<u8[]> romData, u32 romLen, const char* savePathOrNull) {
    auto session = std::make_unique<DsSession>();
    if (savePathOrNull) session->savePath = savePathOrNull;

    NDSCart::NDSCartArgs cartArgs;
    LoadExistingSave(session->savePath, cartArgs);

    // userdata here (not NDS's own, set below) is what Platform::WriteNDSSave
    // receives -- see NDSCart.cpp.
    auto cart = NDSCart::ParseROM(std::move(romData), romLen, &session->savePath, std::move(cartArgs));
    if (!cart) return 0;

    // Defaults to FreeBIOS + generated firmware + software 3D renderer
    // -- see this file's header comment.
    NDSArgs args;
    session->nds = std::make_unique<NDS>(std::move(args), session.get());
    session->nds->SetNDSCart(std::move(cart));
    session->nds->Reset();
    if (session->nds->NeedsDirectBoot()) {
        session->nds->SetupDirectBoot(session->savePath.empty() ? "rom.nds" : session->savePath);
    }
    session->nds->Start();

    return reinterpret_cast<jlong>(session.release());
}

}  // namespace

extern "C" {

// Returns 0 if the ROM couldn't be parsed as an NDS cart. savePath may
// be null to skip save persistence (matches gba_jni.cpp's convention).
// For anything but a small ROM, prefer nativeCreateFromPath below --
// this one requires the whole ROM to already be sitting in a Java
// byte[] (and, upstream of this call, very likely a base64 string
// before that), which is fine for a 32MB GBA ROM but not for a
// 128-512MB NDS one -- see RomFilePickerModule.kt's pickRomPath.
JNIEXPORT jlong JNICALL Java_com_multiemu_dscore_DsNative_nativeCreate(
    JNIEnv* env, jclass, jbyteArray romBytes, jstring savePath) {
    jsize romLen = env->GetArrayLength(romBytes);
    auto romData = std::make_unique<u8[]>(static_cast<size_t>(romLen));
    env->GetByteArrayRegion(romBytes, 0, romLen, reinterpret_cast<jbyte*>(romData.get()));

    const char* savePathChars = savePath ? env->GetStringUTFChars(savePath, nullptr) : nullptr;
    jlong handle = CreateFromRomData(std::move(romData), static_cast<u32>(romLen), savePathChars);
    if (savePathChars) env->ReleaseStringUTFChars(savePath, savePathChars);
    return handle;
}

// Reads the ROM straight off disk instead of through a Java byte[] --
// the path a large NDS ROM should take (see RomFilePickerModule.kt's
// pickRomPath, which copies a picked SAF document to a local cache file
// precisely so this can read it directly, without ever base64-encoding
// it or holding it in a JS bridge string).
JNIEXPORT jlong JNICALL Java_com_multiemu_dscore_DsNative_nativeCreateFromPath(
    JNIEnv* env, jclass, jstring romPath, jstring savePath) {
    const char* romPathChars = env->GetStringUTFChars(romPath, nullptr);
    FILE* f = fopen(romPathChars, "rb");
    env->ReleaseStringUTFChars(romPath, romPathChars);
    if (!f) return 0;
    fseek(f, 0, SEEK_END);
    long romLen = ftell(f);
    fseek(f, 0, SEEK_SET);
    if (romLen <= 0) {
        fclose(f);
        return 0;
    }
    auto romData = std::make_unique<u8[]>(static_cast<size_t>(romLen));
    size_t readBytes = fread(romData.get(), 1, static_cast<size_t>(romLen), f);
    fclose(f);
    if (readBytes != static_cast<size_t>(romLen)) return 0;

    const char* savePathChars = savePath ? env->GetStringUTFChars(savePath, nullptr) : nullptr;
    jlong handle = CreateFromRomData(std::move(romData), static_cast<u32>(romLen), savePathChars);
    if (savePathChars) env->ReleaseStringUTFChars(savePath, savePathChars);
    return handle;
}

JNIEXPORT void JNICALL Java_com_multiemu_dscore_DsNative_nativeDestroy(JNIEnv*, jclass, jlong handle) {
    delete handleToSession(handle);
}

JNIEXPORT void JNICALL Java_com_multiemu_dscore_DsNative_nativeRunFrame(JNIEnv*, jclass, jlong handle) {
    auto* session = handleToSession(handle);
    if (!session->glRendererAttempted) {
        session->glRendererAttempted = true;
        TryEnableGLRenderer(session);
    }
    session->nds->RunFrame();
    // The accelerated renderer's real display path: GPU2D_Soft.cpp only
    // calls GetLine() (and so only ever updates GPU::Framebuffer's 3D
    // content) when the DS's own VRAM-capture hardware feature happens to
    // be enabled (a CaptureCnt bit regular gameplay essentially never
    // sets) -- confirmed by root-causing this exact bug: real polygons
    // were being rendered every frame (RenderNumPolygons > 0) while the
    // screen stayed solid black, because nothing was pulling that render
    // off the GPU. The real path a frontend is supposed to use is
    // melonDS's own GL compositor, which blends 2D+3D directly on the
    // GPU every frame regardless of CaptureCnt (GPU::FinishFrame calls
    // GPU3D.Blit(), unconditionally, whenever accelerated) -- so read
    // *that* compositor's output instead. See GPU3D.h's ReadOutputScreen.
    // With a window surface up, nativePresentFrame does the display work
    // instead (straight GPU->screen); this CPU readback only runs for the
    // Bitmap/Canvas fallback path, which is what's left when there's no
    // Surface (e.g. the view isn't attached yet).
    if (session->nds->GPU.GPU3D.IsRendererAccelerated() && g_windowSurface == EGL_NO_SURFACE) {
        auto& renderer = session->nds->GPU.GPU3D.GetCurrentRenderer();
        int width, height;
        renderer.GetOutputSize(width, height);
        session->compositedOutput.resize(static_cast<size_t>(width) * height * 4);
        // Async, one frame behind (see GPU3D.h's comment) -- a false
        // return (no frame landed yet) just leaves compositedOutput at
        // whatever it already held, which is either last frame's still-
        // valid image or (only ever on the very first call) zeroed/black.
        renderer.ReadOutputScreen(session->nds->GPU.FrontBuffer, session->compositedOutput.data());
    }
}

// Unbinds the GL context from the calling thread. The emulation thread
// is recreated whenever DsView remounts (every rotation), and an EGL
// context stays current on the thread that last bound it -- so the old
// thread has to let go before the new one can take it, or the handover
// fails and every GL call from the new thread silently does nothing.
JNIEXPORT void JNICALL Java_com_multiemu_dscore_DsNative_nativeReleaseContext(JNIEnv*, jclass) {
    if (g_eglDisplay == EGL_NO_DISPLAY) return;
    eglMakeCurrent(g_eglDisplay, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
}

// Re-binds an already-created context to the calling thread, parked on
// the pbuffer until nativeSetSurface swaps in the real window surface.
// Needed on a remount: the context outlives the thread that made it.
JNIEXPORT void JNICALL Java_com_multiemu_dscore_DsNative_nativeBindContext(JNIEnv*, jclass) {
    if (g_eglContext == EGL_NO_CONTEXT) return;
    EGLSurface surface = g_windowSurface != EGL_NO_SURFACE ? g_windowSurface : g_pbufferSurface;
    eglMakeCurrent(g_eglDisplay, surface, surface, g_eglContext);
}

// Hands over (or takes away, with surface == null) the SurfaceView's
// Surface. MUST run on the emu thread, same as every other GL call here
// -- DsView posts it there rather than calling it from the UI thread.
JNIEXPORT void JNICALL Java_com_multiemu_dscore_DsNative_nativeSetSurface(
    JNIEnv* env, jclass, jobject surface) {
    if (!EnsureGLContext()) return;

    // Drop whatever we had: a Surface can be replaced (rotation, resize)
    // or destroyed, and the old EGLSurface/ANativeWindow are dead either
    // way. Park the context on the pbuffer first so it never sits current
    // on a surface that's about to be destroyed.
    if (g_windowSurface != EGL_NO_SURFACE) {
        eglMakeCurrent(g_eglDisplay, g_pbufferSurface, g_pbufferSurface, g_eglContext);
        eglDestroySurface(g_eglDisplay, g_windowSurface);
        g_windowSurface = EGL_NO_SURFACE;
    }
    if (g_nativeWindow) {
        ANativeWindow_release(g_nativeWindow);
        g_nativeWindow = nullptr;
    }
    if (!surface) return;

    ANativeWindow* window = ANativeWindow_fromSurface(env, surface);
    if (!window) {
        __android_log_print(ANDROID_LOG_ERROR, "melonDS", "GL renderer: ANativeWindow_fromSurface failed");
        return;
    }
    EGLSurface eglSurface = eglCreateWindowSurface(g_eglDisplay, g_eglConfig, window, nullptr);
    if (eglSurface == EGL_NO_SURFACE || !eglMakeCurrent(g_eglDisplay, eglSurface, eglSurface, g_eglContext)) {
        __android_log_print(ANDROID_LOG_ERROR, "melonDS",
                            "GL renderer: eglCreateWindowSurface/eglMakeCurrent failed on tid %d (0x%x)",
                            gettid(), eglGetError());
        ANativeWindow_release(window);
        return;
    }
    // Don't block the emu loop waiting on the display's vsync: the loop
    // does its own pacing (see DsView's frameRunnable) and a frame here
    // routinely costs more than one refresh interval anyway, so swapping
    // with an interval of 1 would just reintroduce the stall this whole
    // path exists to remove.
    eglSwapInterval(g_eglDisplay, 0);

    g_nativeWindow = window;
    g_windowSurface = eglSurface;
    __android_log_print(ANDROID_LOG_INFO, "melonDS", "GL renderer: window surface ready on tid %d (%dx%d)",
                        gettid(), ANativeWindow_getWidth(window), ANativeWindow_getHeight(window));
}

// Draws the frame straight from the GL compositor's output to the window
// surface. Rects are top-left-origin pixels in surface space (DsView
// computes the same letterboxed rects it used to pass to Canvas).
// Returns one of DsNative's PRESENT_* codes. NO_SURFACE and
// NOT_ACCELERATED both mean "caller must use the Bitmap/Canvas path this
// frame", but they are very different in kind and the caller has to tell
// them apart: NO_SURFACE is transient (the Surface handover is posted to
// this same thread and can still be queued behind a multi-second ROM
// load), while NOT_ACCELERATED is a property of the session that won't
// change. Treating the transient one as permanent stranded the whole
// session on the CPU path -- see DsView's frameRunnable.
JNIEXPORT jint JNICALL Java_com_multiemu_dscore_DsNative_nativePresentFrame(
    JNIEnv*, jclass, jlong handle,
    jint topX, jint topY, jint topW, jint topH,
    jint botX, jint botY, jint botW, jint botH,
    jint surfaceWidth, jint surfaceHeight) {
    if (g_windowSurface == EGL_NO_SURFACE) return 1;  // PRESENT_NO_SURFACE
    auto* session = handleToSession(handle);
    if (!session->nds->GPU.GPU3D.IsRendererAccelerated()) return 2;  // PRESENT_NOT_ACCELERATED

    glViewport(0, 0, surfaceWidth, surfaceHeight);
    session->nds->GPU.GPU3D.GetCurrentRenderer().BlitToScreen(
        session->nds->GPU.FrontBuffer, topX, topY, topW, topH, botX, botY, botW, botH, surfaceHeight);
    eglSwapBuffers(g_eglDisplay, g_windowSurface);
    return 0;  // PRESENT_OK
}

JNIEXPORT jint JNICALL Java_com_multiemu_dscore_DsNative_nativeGetWidth(JNIEnv*, jclass) { return 256; }

JNIEXPORT jint JNICALL Java_com_multiemu_dscore_DsNative_nativeGetHeight(JNIEnv*, jclass) { return 192; }

// screen is 0 (top) or 1 (bottom). outPixels must be pre-allocated to
// 256*192 ints -- melonDS's framebuffer is already packed as
// 0xAARRGGBB per pixel (see GPU2D_Soft.cpp's "convert to 32-bit BGRA"
// comment: byte order in memory is B,G,R,A, which read back as a
// little-endian u32 is exactly ARGB8888), so this is a direct copy, no
// per-pixel conversion needed (unlike gba_jni.cpp's toArgb8888).
JNIEXPORT void JNICALL Java_com_multiemu_dscore_DsNative_nativeGetFramebuffer(
    JNIEnv* env, jclass, jlong handle, jint screen, jintArray outPixels) {
    auto* session = handleToSession(handle);
    NDS& nds = *session->nds;
    if (!nds.GPU.GPU3D.IsRendererAccelerated()) {
        const u32* buf = nds.GPU.Framebuffer[nds.GPU.FrontBuffer][screen].get();
        env->SetIntArrayRegion(outPixels, 0, 256 * 192, reinterpret_cast<const jint*>(buf));
        return;
    }
    // session->compositedOutput (filled every frame in nativeRunFrame) is
    // both screens already composited by melonDS's own GL shader, stacked
    // top-then-bottom with a small padding gap between them -- see
    // GLCompositor's vertex layout (GPU_OpenGL.cpp) -- 256 wide, so row
    // r starts at byte r*256*4. Row 0 is the top of the top screen (no
    // vertical flip needed -- confirmed visually, not just from reading
    // the vertex math, while root-causing this). The compositor shader
    // already re-expands from the DS's native 6-bit precision to 8-bit as
    // its last step, so only the channel order needs handling here: it
    // writes R,G,B,A in memory (we changed its swizzle from upstream's
    // .bgr so the direct GPU->window blit in BlitOutputToScreen lands the
    // right way round -- see GPU_OpenGL_shaders.h), while a
    // Bitmap.Config.ARGB_8888 int wants B,G,R,A. Hence the swap, which
    // upstream's ordering used to give for free. Only the
    // no-window-surface fallback reaches this, so the per-pixel cost
    // never lands on the normal path.
    constexpr int kBottomScreenRowOffset = 192 + 2;  // top screen + 2-row padding gap
    int rowOffset = (screen == 0) ? 0 : kBottomScreenRowOffset;
    const u32* buf = reinterpret_cast<const u32*>(session->compositedOutput.data()) + rowOffset * 256;
    jint argb[256 * 192];
    for (int i = 0; i < 256 * 192; i++) {
        u32 px = buf[i];
        argb[i] = static_cast<jint>((px & 0xFF00FF00u) | ((px & 0xFFu) << 16) | ((px >> 16) & 0xFFu));
    }
    env->SetIntArrayRegion(outPixels, 0, 256 * 192, argb);
}

// buttonBit must match DsButton's ordinal (see DsNative.kt) -- same
// first-10-bit order as GbaButton, see DsSession::keyMask above.
JNIEXPORT void JNICALL Java_com_multiemu_dscore_DsNative_nativeSetButtonPressed(
    JNIEnv*, jclass, jlong handle, jint buttonBit, jboolean pressed) {
    auto* session = handleToSession(handle);
    u32 bit = 1u << buttonBit;
    if (pressed == JNI_TRUE) {
        session->keyMask &= ~bit;
    } else {
        session->keyMask |= bit;
    }
    session->nds->SetKeyMask(session->keyMask);
}

// x/y are touch-screen pixel coordinates, 0..255 / 0..191.
JNIEXPORT void JNICALL Java_com_multiemu_dscore_DsNative_nativeTouchScreen(
    JNIEnv*, jclass, jlong handle, jint x, jint y) {
    handleToSession(handle)->nds->TouchScreen(static_cast<u16>(x), static_cast<u16>(y));
}

JNIEXPORT void JNICALL Java_com_multiemu_dscore_DsNative_nativeReleaseScreen(JNIEnv*, jclass, jlong handle) {
    handleToSession(handle)->nds->ReleaseScreen();
}

// Must match NDSArgs::OutputSampleRate's default (see this file's
// NDSArgs construction above).
JNIEXPORT jint JNICALL Java_com_multiemu_dscore_DsNative_nativeGetAudioSampleRate(JNIEnv*, jclass) { return 48000; }

// outSamples must be sized for stereo pairs (2 shorts/frame); returns
// the number of frames actually written. SPU::ReadOutput already
// produces interleaved stereo s16 (unlike mGBA's separate-channel
// blip_buf, see gba_jni.cpp), so this is a direct passthrough.
JNIEXPORT jint JNICALL Java_com_multiemu_dscore_DsNative_nativeReadAudioSamples(
    JNIEnv* env, jclass, jlong handle, jshortArray outSamples) {
    NDS& nds = *handleToSession(handle)->nds;
    int capacityFrames = env->GetArrayLength(outSamples) / 2;
    int available = nds.SPU.GetOutputSize();
    int frames = available < capacityFrames ? available : capacityFrames;
    if (frames <= 0) return 0;

    std::vector<s16> buffer(static_cast<size_t>(frames) * 2);
    int read = nds.SPU.ReadOutput(buffer.data(), frames);
    if (read > 0) {
        env->SetShortArrayRegion(outSamples, 0, read * 2, reinterpret_cast<jshort*>(buffer.data()));
    }
    return read;
}

// Full emulator state (CPU/memory/GPU/APU/etc), not just cartridge save
// RAM -- see Savestate.h and the Qt frontend's EmuInstance::saveState
// for the reference usage this mirrors. Unlike gba_jni.cpp's mGBA
// passthrough, melonDS's Savestate owns and grows its own buffer, so
// the size has to be read back from the object after DoSavestate runs.
JNIEXPORT jbyteArray JNICALL Java_com_multiemu_dscore_DsNative_nativeSaveState(JNIEnv* env, jclass,
                                                                                  jlong handle) {
    NDS& nds = *handleToSession(handle)->nds;
    Savestate state;
    if (state.Error || !nds.DoSavestate(&state) || state.Error) return nullptr;
    jsize length = static_cast<jsize>(state.Length());
    jbyteArray result = env->NewByteArray(length);
    env->SetByteArrayRegion(result, 0, length, reinterpret_cast<const jbyte*>(state.Buffer()));
    return result;
}

JNIEXPORT jboolean JNICALL Java_com_multiemu_dscore_DsNative_nativeLoadState(JNIEnv* env, jclass,
                                                                                jlong handle, jbyteArray data) {
    NDS& nds = *handleToSession(handle)->nds;
    jsize length = env->GetArrayLength(data);
    std::vector<u8> buffer(static_cast<size_t>(length));
    env->GetByteArrayRegion(data, 0, length, reinterpret_cast<jbyte*>(buffer.data()));
    Savestate state(buffer.data(), static_cast<u32>(length), false);
    if (state.Error) return JNI_FALSE;
    return (nds.DoSavestate(&state) && !state.Error) ? JNI_TRUE : JNI_FALSE;
}

// Inserts a GBA ROM into the DS's slot-2, the same physical mechanism
// Pal Park (Diamond/Pearl/Platinum) and the GBA-slot Pokemon transfer
// (HeartGold/SoulSilver) use to migrate Pokemon from a 3rd-gen game --
// melonDS's GBACart already implements the cart-detection and SRAM
// access those games expect, this just has to load one in. gbaSavePath
// should point at the same save file GbaView already uses for this
// ROM (its CRC32-keyed .sav under saves/) so a transfer sees whatever
// the user already caught playing it standalone; may be null to start
// with a freshly-battery-backed cart. Returns false if romPath isn't
// a GBA ROM melonDS recognizes.
JNIEXPORT jboolean JNICALL Java_com_multiemu_dscore_DsNative_nativeInsertGbaCart(
    JNIEnv* env, jclass, jlong handle, jstring gbaRomPath, jstring gbaSavePath) {
    auto* session = handleToSession(handle);

    const char* romPathChars = env->GetStringUTFChars(gbaRomPath, nullptr);
    auto [romData, romLen] = ReadFileBytes(romPathChars);
    env->ReleaseStringUTFChars(gbaRomPath, romPathChars);
    if (!romData) return JNI_FALSE;

    if (gbaSavePath) {
        const char* savePathChars = env->GetStringUTFChars(gbaSavePath, nullptr);
        session->gbaSavePath = savePathChars;
        env->ReleaseStringUTFChars(gbaSavePath, savePathChars);
    } else {
        session->gbaSavePath.clear();
    }
    auto [sramData, sramLen] = ReadFileBytes(session->gbaSavePath);

    // userdata here is what Platform::WriteGBASave receives -- see
    // GBACart.cpp's SRAMWrite call sites and ds_platform.cpp.
    auto cart = GBACart::ParseROM(std::move(romData), romLen, std::move(sramData), sramLen, &session->gbaSavePath);
    if (!cart) return JNI_FALSE;

    session->nds->SetGBACart(std::move(cart));
    return JNI_TRUE;
}

JNIEXPORT void JNICALL Java_com_multiemu_dscore_DsNative_nativeEjectGbaCart(JNIEnv*, jclass, jlong handle) {
    handleToSession(handle)->nds->EjectGBACart();
}

}  // extern "C"
