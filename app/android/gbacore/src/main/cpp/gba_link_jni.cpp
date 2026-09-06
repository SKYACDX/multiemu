// JNI bridge for local (same-device) 2-player GBA link cable -- see
// gba_link.h/.cpp for the actual lockstep engine. Kept in its own file
// (rather than gba_jni.cpp) since this is a distinct, still-experimental
// feature that owns its cores' whole lifecycle rather than exposing the
// single-instance GbaNative shape.
#include <jni.h>

#include <fcntl.h>

#include <vector>

#include "gba_link.h"
#include "mgba/core/core.h"
#include "mgba-util/vfs.h"

namespace {

// Same ROM-loading sequence as gba_jni.cpp's nativeCreate (GBA-only
// check, config defaults including the volume-default fix, save VFile
// wired up front) -- duplicated rather than shared across a header
// because gba_jni.cpp's version is `static`/file-local and this is a
// separate, still-experimental feature not worth risking that file's
// stability to de-duplicate a couple dozen lines from.
mCore* loadGbaCore(JNIEnv* env, jbyteArray romBytes, jstring savePath) {
    jsize length = env->GetArrayLength(romBytes);
    std::vector<jbyte> rom(static_cast<std::size_t>(length));
    env->GetByteArrayRegion(romBytes, 0, length, rom.data());

    VFile* vf = VFileMemChunk(rom.data(), rom.size());
    if (!vf) return nullptr;

    mCore* core = mCoreFindVF(vf);
    if (!core || core->platform(core) != mPLATFORM_GBA) {
        if (core) core->deinit(core);
        vf->close(vf);
        return nullptr;
    }

    core->init(core);
    mCoreInitConfig(core, "gba");
    mCoreConfigSetDefaultIntValue(&core->config, "volume", 0x100);
    mCoreLoadForeignConfig(core, &core->config);

    if (!core->loadROM(core, vf)) {
        mCoreConfigDeinit(&core->config);
        core->deinit(core);
        vf->close(vf);
        return nullptr;
    }

    if (savePath) {
        const char* path = env->GetStringUTFChars(savePath, nullptr);
        VFile* saveVf = VFileOpen(path, O_CREAT | O_RDWR);
        env->ReleaseStringUTFChars(savePath, path);
        if (saveVf) core->loadSave(core, saveVf);
    }
    // No core->reset() here -- the caller must call setVideoBuffer() first,
    // then reset(). mGBA's _GBACoreReset only wires the renderer up
    // (GBAVideoAssociateRenderer) if outputBuffer is already set at the
    // moment it runs; resetting before the buffer exists leaves the
    // renderer never associated, so every frame renders into nothing and
    // the screen stays permanently black even though the core runs fine.
    // gba_jni.cpp's single-player path sidesteps this by calling
    // setVideoBuffer before loadROM/reset already.
    return core;
}

LinkedGbaSession* handleToSession(jlong handle) { return reinterpret_cast<LinkedGbaSession*>(handle); }

}  // namespace

extern "C" {

// Returns 0 if either ROM isn't a GBA ROM mGBA recognizes.
JNIEXPORT jlong JNICALL Java_com_multiemu_gbacore_GbaLinkNative_nativeCreateSession(
    JNIEnv* env, jclass, jbyteArray romA, jstring savePathA, jbyteArray romB, jstring savePathB) {
    mCore* coreA = loadGbaCore(env, romA, savePathA);
    if (!coreA) return 0;
    mCore* coreB = loadGbaCore(env, romB, savePathB);
    if (!coreB) {
        mCoreConfigDeinit(&coreA->config);
        coreA->deinit(coreA);
        return 0;
    }
    return reinterpret_cast<jlong>(new LinkedGbaSession(coreA, coreB));
}

JNIEXPORT void JNICALL Java_com_multiemu_gbacore_GbaLinkNative_nativeDestroySession(JNIEnv*, jclass, jlong handle) {
    delete handleToSession(handle);
}

JNIEXPORT jint JNICALL Java_com_multiemu_gbacore_GbaLinkNative_nativeGetWidth(JNIEnv*, jclass, jlong handle) {
    return static_cast<jint>(handleToSession(handle)->width());
}

JNIEXPORT jint JNICALL Java_com_multiemu_gbacore_GbaLinkNative_nativeGetHeight(JNIEnv*, jclass, jlong handle) {
    return static_cast<jint>(handleToSession(handle)->height());
}

// player is 0 or 1. outPixels must be pre-allocated to width*height ints.
JNIEXPORT void JNICALL Java_com_multiemu_gbacore_GbaLinkNative_nativeGetFramebuffer(
    JNIEnv* env, jclass, jlong handle, jint player, jintArray outPixels) {
    auto* session = handleToSession(handle);
    std::vector<uint32_t> pixels(static_cast<std::size_t>(session->width()) * session->height());
    session->getFramebuffer(player, pixels.data());
    env->SetIntArrayRegion(outPixels, 0, static_cast<jsize>(pixels.size()), reinterpret_cast<jint*>(pixels.data()));
}

// buttonId must match GbaButton's ordinal (see GbaNative.kt).
JNIEXPORT void JNICALL Java_com_multiemu_gbacore_GbaLinkNative_nativeSetButtonPressed(
    JNIEnv*, jclass, jlong handle, jint player, jint buttonId, jboolean pressed) {
    handleToSession(handle)->setButtonPressed(player, buttonId, pressed == JNI_TRUE);
}

// Must match LinkedGbaSession's kAudioSampleRateHz (gba_link.cpp).
JNIEXPORT jint JNICALL Java_com_multiemu_gbacore_GbaLinkNative_nativeGetAudioSampleRate(JNIEnv*, jclass) {
    return 48000;
}

// player is 0 or 1. outSamples must be sized for stereo pairs (2
// shorts/frame); returns the number of frames actually written, which
// may be less than the buffer's capacity -- see LinkedGbaSession::readAudioSamples.
JNIEXPORT jint JNICALL Java_com_multiemu_gbacore_GbaLinkNative_nativeReadAudioSamples(
    JNIEnv* env, jclass, jlong handle, jint player, jshortArray outSamples) {
    int capacityFrames = env->GetArrayLength(outSamples) / 2;
    std::vector<int16_t> buffer(static_cast<std::size_t>(capacityFrames) * 2);
    int frames = handleToSession(handle)->readAudioSamples(player, buffer.data(), capacityFrames);
    if (frames > 0) {
        env->SetShortArrayRegion(outSamples, 0, static_cast<jsize>(frames) * 2, reinterpret_cast<jshort*>(buffer.data()));
    }
    return frames;
}

}  // extern "C"
