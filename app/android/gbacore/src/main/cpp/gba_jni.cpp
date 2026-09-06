// JNI bridge between the Kotlin GbaNative class and mGBA's public C core
// API (mCore). Unlike gbcore (our own from-scratch Game Boy emulator),
// this module vendors mGBA (third_party/mgba, MPL-2.0) as the actual
// emulation engine -- writing a second CPU-accurate core from scratch
// (ARM7TDMI this time, plus a much more complex PPU) was explicitly
// judged out of scope; integrating an existing, mature core is the
// practical path to GBA support.
#include <jni.h>

#include <fcntl.h>

#include <cstring>
#include <memory>
#include <vector>

#include "mgba/core/blip_buf.h"
#include "mgba/core/core.h"
#include "mgba/internal/gba/input.h"
#include "mgba-util/vfs.h"

namespace {

// mGBA's GBA core defaults its two audio channels to 96000Hz (see
// blip_set_rates calls in src/gba/audio.c) -- unusually high, and not
// every device/audio HAL is guaranteed to accept an AudioTrack requesting
// it, which was silently producing no sound at all rather than an error.
// Every real mGBA frontend (3DS/libretro/OpenEmu -- see their main.c/.m)
// overrides this with blip_set_rates right after creating the core, to
// whatever rate suits their own output; 48000 is Android's safe default.
constexpr int kAudioSampleRateHz = 48000;

struct GbaInstance {
    mCore* core = nullptr;
    std::vector<color_t> videoBuffer;
    unsigned width = 0;
    unsigned height = 0;
};

GbaInstance* handleToInstance(jlong handle) { return reinterpret_cast<GbaInstance*>(handle); }

// mGBA's 32-bit color_t packs R in bits 0-7, G in 8-15, B in 16-23 (see
// M_COLOR_RED/GREEN/BLUE in mgba/core/interface.h) and leaves alpha
// unset -- Android's ARGB_8888 wants A in 24-31, R in 16-23, G in 8-15,
// B in 0-7, so red/blue need swapping and alpha forced opaque.
inline jint toArgb8888(color_t pixel) {
    auto p = static_cast<uint32_t>(pixel);
    uint32_t r = p & 0xFF;
    uint32_t g = (p >> 8) & 0xFF;
    uint32_t b = (p >> 16) & 0xFF;
    return static_cast<jint>(0xFF000000u | (r << 16) | (g << 8) | b);
}

}  // namespace

extern "C" {

// Returns 0 if the ROM isn't a GBA ROM mGBA recognizes (this module is
// GBA-only -- a GB/GBC ROM is correctly detected by mCoreFindVF too, but
// gbcore is the intended home for those, so it's rejected here rather
// than silently run through mGBA's own GB support).
JNIEXPORT jlong JNICALL Java_com_multiemu_gbacore_GbaNative_nativeCreate(JNIEnv* env, jclass,
                                                                           jbyteArray romBytes,
                                                                           jstring savePath) {
    jsize length = env->GetArrayLength(romBytes);
    std::vector<jbyte> rom(static_cast<std::size_t>(length));
    env->GetByteArrayRegion(romBytes, 0, length, rom.data());

    VFile* vf = VFileMemChunk(rom.data(), rom.size());
    if (!vf) return 0;

    mCore* core = mCoreFindVF(vf);
    if (!core || core->platform(core) != mPLATFORM_GBA) {
        if (core) core->deinit(core);
        vf->close(vf);
        return 0;
    }

    core->init(core);
    // mCoreInitConfig only initializes core->config's internal table (no
    // file I/O); mCoreLoadForeignConfig maps it into core->opts. Without
    // this, core->opts is whatever GBACoreCreate zero-initialized it to,
    // which happens to be fine for most fields but is undocumented --
    // this matches the sequence every real mGBA frontend uses (see
    // src/platform/sdl/main.c) instead of relying on that being safe.
    mCoreInitConfig(core, "gba");
    // core->opts.volume has NO built-in default -- mCoreConfigMap only
    // overwrites it if "volume" is actually set somewhere in config, and
    // an empty config (our case, no config.ini) leaves it zero-
    // initialized. _GBACoreLoadConfig (called at the end of
    // mCoreLoadForeignConfig) then does
    // `gba->audio.masterVolume = core->opts.volume`, which silently mutes
    // all audio -- the AudioTrack pipeline downstream was never the
    // problem, it was faithfully playing back real silence. Every real
    // mGBA frontend avoids this by constructing its mArguments with
    // `.volume = 0x100` (GBA_AUDIO_VOLUME_MAX) before loading config (see
    // src/platform/sdl/main.c); we have no such struct, so set the same
    // default directly on the config's defaults table instead.
    mCoreConfigSetDefaultIntValue(&core->config, "volume", 0x100);
    mCoreLoadForeignConfig(core, &core->config);

    auto* instance = new GbaInstance();
    instance->core = core;
    core->desiredVideoDimensions(core, &instance->width, &instance->height);
    instance->videoBuffer.assign(static_cast<std::size_t>(instance->width) * instance->height, 0);
    core->setVideoBuffer(core, instance->videoBuffer.data(), instance->width);

    if (!core->loadROM(core, vf)) {
        mCoreConfigDeinit(&core->config);
        core->deinit(core);
        vf->close(vf);
        delete instance;
        return 0;
    }
    // Unlike the ROM VFile, the save VFile stays open and writable for the
    // instance's whole lifetime: mGBA's cartridge RAM/flash emulation
    // writes straight through to it as the game saves, the same way a
    // real GBA's save chip is memory-mapped -- there's no "export the
    // save data" step to do ourselves, just give it a real file up front.
    if (savePath) {
        const char* path = env->GetStringUTFChars(savePath, nullptr);
        VFile* saveVf = VFileOpen(path, O_CREAT | O_RDWR);
        env->ReleaseStringUTFChars(savePath, path);
        if (saveVf) core->loadSave(core, saveVf);
    }
    core->reset(core);

    core->setAudioBufferSize(core, 2048);
    blip_set_rates(core->getAudioChannel(core, 0), core->frequency(core), kAudioSampleRateHz);
    blip_set_rates(core->getAudioChannel(core, 1), core->frequency(core), kAudioSampleRateHz);

    return reinterpret_cast<jlong>(instance);
}

JNIEXPORT void JNICALL Java_com_multiemu_gbacore_GbaNative_nativeDestroy(JNIEnv*, jclass,
                                                                           jlong handle) {
    auto* instance = handleToInstance(handle);
    mCoreConfigDeinit(&instance->core->config);
    instance->core->deinit(instance->core);
    delete instance;
}

JNIEXPORT void JNICALL Java_com_multiemu_gbacore_GbaNative_nativeRunFrame(JNIEnv*, jclass,
                                                                            jlong handle) {
    handleToInstance(handle)->core->runFrame(handleToInstance(handle)->core);
}

// outPixels must be pre-allocated to width*height ints (see
// nativeGetDimensions); filled with ARGB_8888 values ready for
// android.graphics.Bitmap.setPixels().
JNIEXPORT void JNICALL Java_com_multiemu_gbacore_GbaNative_nativeGetFramebuffer(
    JNIEnv* env, jclass, jlong handle, jintArray outPixels) {
    auto* instance = handleToInstance(handle);
    std::vector<jint> pixels(instance->videoBuffer.size());
    for (std::size_t i = 0; i < instance->videoBuffer.size(); i++) {
        pixels[i] = toArgb8888(instance->videoBuffer[i]);
    }
    env->SetIntArrayRegion(outPixels, 0, static_cast<jsize>(pixels.size()), pixels.data());
}

JNIEXPORT jint JNICALL Java_com_multiemu_gbacore_GbaNative_nativeGetWidth(JNIEnv*, jclass,
                                                                            jlong handle) {
    return static_cast<jint>(handleToInstance(handle)->width);
}

JNIEXPORT jint JNICALL Java_com_multiemu_gbacore_GbaNative_nativeGetHeight(JNIEnv*, jclass,
                                                                             jlong handle) {
    return static_cast<jint>(handleToInstance(handle)->height);
}

JNIEXPORT jint JNICALL Java_com_multiemu_gbacore_GbaNative_nativeGetAudioSampleRate(JNIEnv*, jclass) {
    return kAudioSampleRateHz;
}

// Reads whatever's ready from mGBA's own audio synthesis, resampled to
// kAudioSampleRateHz stereo 16-bit PCM (see the blip_set_rates calls in
// nativeCreate). outSamples must be sized for stereo pairs (2
// shorts/frame); returns the number of frames actually written, which
// may be less than the buffer's capacity.
JNIEXPORT jint JNICALL Java_com_multiemu_gbacore_GbaNative_nativeReadAudioSamples(
    JNIEnv* env, jclass, jlong handle, jshortArray outSamples) {
    mCore* core = handleToInstance(handle)->core;
    blip_t* left = core->getAudioChannel(core, 0);
    blip_t* right = core->getAudioChannel(core, 1);

    int capacityFrames = env->GetArrayLength(outSamples) / 2;
    int availableFrames = blip_samples_avail(left);
    int frames = availableFrames < capacityFrames ? availableFrames : capacityFrames;
    if (frames <= 0) return 0;

    std::vector<int16_t> buffer(static_cast<std::size_t>(frames) * 2);
    blip_read_samples(left, buffer.data(), frames, 1);
    blip_read_samples(right, buffer.data() + 1, frames, 1);
    env->SetShortArrayRegion(outSamples, 0, static_cast<jsize>(buffer.size()),
                              reinterpret_cast<jshort*>(buffer.data()));
    return frames;
}

// Full emulator state (CPU/memory/PPU/APU/etc), not just cartridge save
// RAM -- lets the user save/load at any point, not just where the game's
// own save system allows. mGBA's mCore already implements this fully
// (stateSize/saveState/loadState), so this is a direct passthrough.
JNIEXPORT jbyteArray JNICALL Java_com_multiemu_gbacore_GbaNative_nativeSaveState(JNIEnv* env, jclass,
                                                                                   jlong handle) {
    mCore* core = handleToInstance(handle)->core;
    std::size_t size = core->stateSize(core);
    std::vector<uint8_t> buffer(size);
    if (!core->saveState(core, buffer.data())) return nullptr;
    jbyteArray result = env->NewByteArray(static_cast<jsize>(size));
    env->SetByteArrayRegion(result, 0, static_cast<jsize>(size), reinterpret_cast<const jbyte*>(buffer.data()));
    return result;
}

JNIEXPORT jboolean JNICALL Java_com_multiemu_gbacore_GbaNative_nativeLoadState(JNIEnv* env, jclass,
                                                                                 jlong handle, jbyteArray data) {
    mCore* core = handleToInstance(handle)->core;
    jsize length = env->GetArrayLength(data);
    std::vector<uint8_t> buffer(static_cast<std::size_t>(length));
    env->GetByteArrayRegion(data, 0, length, reinterpret_cast<jbyte*>(buffer.data()));
    return core->loadState(core, buffer.data()) ? JNI_TRUE : JNI_FALSE;
}

// buttonId must match the ordinal of GbaButton (Kotlin side), which is
// defined to match enum GBAKey in mgba/internal/gba/input.h exactly:
// 0=A 1=B 2=Select 3=Start 4=Right 5=Left 6=Up 7=Down 8=R 9=L.
JNIEXPORT void JNICALL Java_com_multiemu_gbacore_GbaNative_nativeSetButtonPressed(
    JNIEnv*, jclass, jlong handle, jint buttonId, jboolean pressed) {
    mCore* core = handleToInstance(handle)->core;
    uint32_t bit = 1u << buttonId;
    if (pressed == JNI_TRUE) {
        core->addKeys(core, bit);
    } else {
        core->clearKeys(core, bit);
    }
}

}  // extern "C"
