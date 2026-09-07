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
#include <vector>

#include "Args.h"
#include "GBACart.h"
#include "NDS.h"
#include "NDSCart.h"
#include "Savestate.h"

using namespace melonDS;

namespace {

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
