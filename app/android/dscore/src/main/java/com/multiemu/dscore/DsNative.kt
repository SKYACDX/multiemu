package com.multiemu.dscore

/**
 * Thin Kotlin wrapper around melonDS's core (see ds_jni.cpp/ds_platform.cpp).
 * Mirrors GbaNative's one-instance-per-native-object shape, doubled for
 * the two screens. No BIOS/firmware files needed -- see ds_jni.cpp's
 * header comment on the FreeBIOS direct-boot strategy.
 */
class DsNative private constructor(private var handle: Long) : AutoCloseable {

    companion object {
        init {
            System.loadLibrary("dsjni")
        }

        val width: Int by lazy { nativeGetWidth() }
        val height: Int by lazy { nativeGetHeight() }

        /** Returns null if the ROM isn't an NDS ROM melonDS recognizes. savePath may be null to skip persistence. */
        fun load(rom: ByteArray, savePath: String?): DsNative? {
            val handle = nativeCreate(rom, savePath)
            if (handle == 0L) return null
            return DsNative(handle)
        }

        @JvmStatic private external fun nativeCreate(rom: ByteArray, savePath: String?): Long
        @JvmStatic private external fun nativeDestroy(handle: Long)
        @JvmStatic private external fun nativeRunFrame(handle: Long)
        @JvmStatic private external fun nativeGetWidth(): Int
        @JvmStatic private external fun nativeGetHeight(): Int
        @JvmStatic private external fun nativeGetFramebuffer(handle: Long, screen: Int, outPixels: IntArray)
        @JvmStatic private external fun nativeSetButtonPressed(handle: Long, buttonId: Int, pressed: Boolean)
        @JvmStatic private external fun nativeTouchScreen(handle: Long, x: Int, y: Int)
        @JvmStatic private external fun nativeReleaseScreen(handle: Long)
    }

    /** width*height ARGB_8888 pixels each, reused across calls. */
    val topFramebuffer = IntArray(width * height)
    val bottomFramebuffer = IntArray(width * height)

    fun runFrame() {
        check(handle != 0L) { "DsNative used after close()" }
        nativeRunFrame(handle)
    }

    /** Copies out whatever frame each screen most recently finished. */
    fun readFramebuffers() {
        check(handle != 0L) { "DsNative used after close()" }
        nativeGetFramebuffer(handle, 0, topFramebuffer)
        nativeGetFramebuffer(handle, 1, bottomFramebuffer)
    }

    fun setButtonPressed(button: DsButton, pressed: Boolean) {
        check(handle != 0L) { "DsNative used after close()" }
        nativeSetButtonPressed(handle, button.ordinal, pressed)
    }

    /** x/y are bottom-screen pixel coordinates, 0..255 / 0..191. */
    fun touchScreen(x: Int, y: Int) {
        check(handle != 0L) { "DsNative used after close()" }
        nativeTouchScreen(handle, x, y)
    }

    fun releaseScreen() {
        check(handle != 0L) { "DsNative used after close()" }
        nativeReleaseScreen(handle)
    }

    override fun close() {
        if (handle != 0L) {
            nativeDestroy(handle)
            handle = 0L
        }
    }
}
