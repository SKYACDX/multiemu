// JNI bridge for NDS emulation -- see gba_jni.cpp for the equivalent GBA
// bridge over mGBA. Unlike mGBA, melonDS's core needs a real Platform::
// implementation from the frontend (see ds_platform.cpp) before any of
// its code can run at all; that groundwork is done and verified (the
// whole thing links against libcore.a with zero unresolved symbols,
// checked with `-Wl,--no-undefined` -- see docs/melonds-setup.md).
//
// What's NOT here yet: actually constructing an NDS instance and
// loading a ROM. That needs a real BIOS/firmware strategy first --
// melonDS supports a built-in "FreeBIOS" fallback (no real Nintendo
// dumps required) for many commercial ROMs, which is the path to take
// here rather than requiring the user to supply copyrighted BIOS files.
#include <jni.h>

extern "C" JNIEXPORT jstring JNICALL
Java_com_multiemu_dscore_DsNative_nativeVersionProbe(JNIEnv* env, jclass) {
    return env->NewStringUTF("dscore: melonDS core linked, ROM loading not implemented yet");
}
