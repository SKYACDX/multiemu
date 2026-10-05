package com.multiemu.n3dscore

import android.view.Surface

/**
 * The 3DS core (Azahar, through libretro -- see n3ds_jni.cpp). One console
 * per process, since the core keeps its emulator in globals. Every call
 * must come from the same thread: the one N3dsView runs frames on, where
 * the EGL context lives.
 */
object N3dsNative {
    /** False on devices the core isn't built for (anything but arm64). */
    val available: Boolean = runCatching { System.loadLibrary("n3dsjni") }.isSuccess

    /** Null on success, else a message for the user. */
    @JvmStatic external fun nativeStart(romPath: String, dataDir: String): String?
    @JvmStatic external fun nativeStop()
    @JvmStatic external fun nativeSetSurface(surface: Surface?)
    @JvmStatic external fun nativeRunFrame()
    /** Interleaved stereo; returns frames written. */
    @JvmStatic external fun nativeReadAudio(out: ShortArray): Int
    @JvmStatic external fun nativeSampleRate(): Int
    @JvmStatic external fun nativeFps(): Double
    /** A touch at (x, y) on a view of [width] x [height] showing the picture. Safe from any thread. */
    @JvmStatic external fun nativeTouch(x: Float, y: Float, width: Int, height: Int, pressed: Boolean)
    /** [id] is a libretro joypad id (RETRO_DEVICE_ID_JOYPAD_*). Safe from any thread. */
    @JvmStatic external fun nativeSetButton(id: Int, pressed: Boolean)
}
