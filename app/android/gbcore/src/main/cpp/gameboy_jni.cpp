// JNI bridge between the Kotlin GameBoyNative class and gb::GameBoy. Kept
// deliberately thin: all emulation logic stays in core/gb, this file only
// translates JNI types (jbyteArray, jintArray, jlong-as-pointer) at the
// boundary.
#include <jni.h>

#include <cstring>
#include <memory>
#include <vector>

#include "gb/apu.h"
#include "gb/cartridge.h"
#include "gb/gameboy.h"

namespace {

// DMG shade (0=lightest..3=darkest) -> opaque ARGB_8888, in the classic
// four-shades-of-gray palette. A "real" DMG-green palette can replace
// this later without touching anything on the native side.
constexpr jint kPalette[4] = {
    static_cast<jint>(0xFFFFFFFF),
    static_cast<jint>(0xFFAAAAAA),
    static_cast<jint>(0xFF555555),
    static_cast<jint>(0xFF000000),
};

gb::GameBoy* handleToGameBoy(jlong handle) { return reinterpret_cast<gb::GameBoy*>(handle); }

}  // namespace

extern "C" {

// Sound. core/gb gained an APU (from the desktop port) but nothing on this
// side ever read it, so the Android build stayed silent. These two are the
// whole bridge: the rate is a constant of the core, and reading drains
// whatever the APU queued since the last call as interleaved stereo.
JNIEXPORT jint JNICALL Java_com_multiemu_gbcore_GameBoyNative_nativeGetAudioSampleRate(JNIEnv*, jclass) {
    return gb::Apu::kSampleRate;
}

JNIEXPORT jint JNICALL Java_com_multiemu_gbcore_GameBoyNative_nativeReadAudio(JNIEnv* env, jclass, jlong handle,
                                                                             jshortArray out) {
    const jsize length = env->GetArrayLength(out);
    jshort* samples = env->GetShortArrayElements(out, nullptr);
    const int frames = handleToGameBoy(handle)->readAudio(reinterpret_cast<gb::i16*>(samples), length / 2);
    env->ReleaseShortArrayElements(out, samples, 0);
    return frames;
}

// Returns 0 if the ROM's header is invalid or its mapper isn't supported
// yet (see gb::loadCartridge). Callers must check for 0 before using the
// handle.
JNIEXPORT jlong JNICALL Java_com_multiemu_gbcore_GameBoyNative_nativeCreate(JNIEnv* env, jclass,
                                                                             jbyteArray romBytes) {
    jsize length = env->GetArrayLength(romBytes);
    std::vector<gb::u8> rom(static_cast<std::size_t>(length));
    env->GetByteArrayRegion(romBytes, 0, length, reinterpret_cast<jbyte*>(rom.data()));

    auto cartridge = gb::loadCartridge(std::move(rom));
    if (!cartridge) return 0;

    auto* gameBoy = new gb::GameBoy(std::move(cartridge));
    return reinterpret_cast<jlong>(gameBoy);
}

JNIEXPORT void JNICALL Java_com_multiemu_gbcore_GameBoyNative_nativeDestroy(JNIEnv*, jclass,
                                                                             jlong handle) {
    delete handleToGameBoy(handle);
}

JNIEXPORT void JNICALL Java_com_multiemu_gbcore_GameBoyNative_nativeRunFrame(JNIEnv*, jclass,
                                                                              jlong handle) {
    handleToGameBoy(handle)->runUntilFrame();
}

// outPixels must be a pre-allocated int[160*144]; filled with ARGB_8888
// values ready for android.graphics.Bitmap.setPixels().
JNIEXPORT void JNICALL Java_com_multiemu_gbcore_GameBoyNative_nativeGetFramebuffer(
    JNIEnv* env, jclass, jlong handle, jintArray outPixels) {
    const auto& framebuffer = handleToGameBoy(handle)->framebuffer();

    std::vector<jint> pixels(framebuffer.size());
    for (std::size_t i = 0; i < framebuffer.size(); i++) {
        pixels[i] = kPalette[framebuffer[i] & 0x03];
    }
    env->SetIntArrayRegion(outPixels, 0, static_cast<jsize>(pixels.size()), pixels.data());
}

// buttonId must match the ordinal of gb::Button (see joypad.h):
// 0=Right 1=Left 2=Up 3=Down 4=A 5=B 6=Select 7=Start.
JNIEXPORT void JNICALL Java_com_multiemu_gbcore_GameBoyNative_nativeSetButtonPressed(
    JNIEnv*, jclass, jlong handle, jint buttonId, jboolean pressed) {
    handleToGameBoy(handle)->setButtonPressed(static_cast<gb::Button>(buttonId), pressed == JNI_TRUE);
}

JNIEXPORT jboolean JNICALL Java_com_multiemu_gbcore_GameBoyNative_nativeHasBattery(JNIEnv*, jclass,
                                                                                     jlong handle) {
    return handleToGameBoy(handle)->bus().cartridge().hasBattery() ? JNI_TRUE : JNI_FALSE;
}

// Returns the cartridge's current external RAM -- empty if it has none.
// Callers should only bother persisting this when nativeHasBattery() is
// true (a cartridge with no battery loses its RAM on power-off anyway,
// same as real hardware).
JNIEXPORT jbyteArray JNICALL Java_com_multiemu_gbcore_GameBoyNative_nativeGetSaveData(JNIEnv* env, jclass,
                                                                                        jlong handle) {
    const auto& ram = handleToGameBoy(handle)->bus().cartridge().ram();
    jbyteArray result = env->NewByteArray(static_cast<jsize>(ram.size()));
    env->SetByteArrayRegion(result, 0, static_cast<jsize>(ram.size()),
                             reinterpret_cast<const jbyte*>(ram.data()));
    return result;
}

JNIEXPORT void JNICALL Java_com_multiemu_gbcore_GameBoyNative_nativeLoadSaveData(JNIEnv* env, jclass,
                                                                                   jlong handle, jbyteArray data) {
    jsize length = env->GetArrayLength(data);
    std::vector<gb::u8> ram(static_cast<std::size_t>(length));
    env->GetByteArrayRegion(data, 0, length, reinterpret_cast<jbyte*>(ram.data()));
    handleToGameBoy(handle)->bus().cartridge().loadRam(ram);
}

}  // extern "C"
