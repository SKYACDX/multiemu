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
#include <memory>
#include <string>

#include "Args.h"
#include "NDS.h"
#include "NDSCart.h"

using namespace melonDS;

namespace {

// One emulated console + the bits Platform:: callbacks (ds_platform.cpp)
// need out-of-band -- SRAM writeback goes through the cart's own
// userdata (see NDSCart.cpp's Platform::WriteNDSSave call sites), which
// is this struct's address, kept alive for as long as the session is.
struct DsSession {
    std::unique_ptr<NDS> nds;
    std::string savePath;
    // DS KeyInput is active-low (see NDS::SetKeyMask): bit 0 = 1 means
    // "not pressed". Same first-10-bit order as GbaButton (A, B, SELECT,
    // START, RIGHT, LEFT, UP, DOWN, R, L), with X/Y added at 10/11.
    u32 keyMask = 0xFFF;
};

DsSession* handleToSession(jlong handle) { return reinterpret_cast<DsSession*>(handle); }

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

}  // namespace

extern "C" {

// Returns 0 if the ROM couldn't be parsed as an NDS cart. savePath may
// be null to skip save persistence (matches gba_jni.cpp's convention).
JNIEXPORT jlong JNICALL Java_com_multiemu_dscore_DsNative_nativeCreate(
    JNIEnv* env, jclass, jbyteArray romBytes, jstring savePath) {
    jsize romLen = env->GetArrayLength(romBytes);
    auto romData = std::make_unique<u8[]>(static_cast<size_t>(romLen));
    env->GetByteArrayRegion(romBytes, 0, romLen, reinterpret_cast<jbyte*>(romData.get()));

    auto session = std::make_unique<DsSession>();
    if (savePath) {
        const char* path = env->GetStringUTFChars(savePath, nullptr);
        session->savePath = path;
        env->ReleaseStringUTFChars(savePath, path);
    }

    NDSCart::NDSCartArgs cartArgs;
    LoadExistingSave(session->savePath, cartArgs);

    // userdata here (not NDS's own, set below) is what Platform::WriteNDSSave
    // receives -- see NDSCart.cpp.
    auto cart = NDSCart::ParseROM(std::move(romData), static_cast<u32>(romLen), &session->savePath, std::move(cartArgs));
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

JNIEXPORT void JNICALL Java_com_multiemu_dscore_DsNative_nativeDestroy(JNIEnv*, jclass, jlong handle) {
    delete handleToSession(handle);
}

JNIEXPORT void JNICALL Java_com_multiemu_dscore_DsNative_nativeRunFrame(JNIEnv*, jclass, jlong handle) {
    handleToSession(handle)->nds->RunFrame();
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
    NDS& nds = *handleToSession(handle)->nds;
    const u32* buf = nds.GPU.Framebuffer[nds.GPU.FrontBuffer][screen].get();
    env->SetIntArrayRegion(outPixels, 0, 256 * 192, reinterpret_cast<const jint*>(buf));
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

}  // extern "C"
