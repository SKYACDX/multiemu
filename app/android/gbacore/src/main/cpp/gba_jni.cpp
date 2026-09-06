// JNI bridge between the Kotlin GbaNative class and mGBA's public C core
// API (mCore). Unlike gbcore (our own from-scratch Game Boy emulator),
// this module vendors mGBA (third_party/mgba, MPL-2.0) as the actual
// emulation engine -- writing a second CPU-accurate core from scratch
// (ARM7TDMI this time, plus a much more complex PPU) was explicitly
// judged out of scope; integrating an existing, mature core is the
// practical path to GBA support.
#include <jni.h>

#include <cstring>
#include <memory>
#include <vector>

#include "mgba/core/core.h"
#include "mgba/internal/gba/input.h"
#include "mgba-util/vfs.h"

namespace {

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
                                                                           jbyteArray romBytes) {
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

    auto* instance = new GbaInstance();
    instance->core = core;
    core->desiredVideoDimensions(core, &instance->width, &instance->height);
    instance->videoBuffer.assign(static_cast<std::size_t>(instance->width) * instance->height, 0);
    core->setVideoBuffer(core, instance->videoBuffer.data(), instance->width);

    if (!core->loadROM(core, vf)) {
        core->deinit(core);
        vf->close(vf);
        delete instance;
        return 0;
    }
    core->reset(core);

    return reinterpret_cast<jlong>(instance);
}

JNIEXPORT void JNICALL Java_com_multiemu_gbacore_GbaNative_nativeDestroy(JNIEnv*, jclass,
                                                                           jlong handle) {
    auto* instance = handleToInstance(handle);
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
