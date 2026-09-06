package com.multiemu.gbacore

/**
 * Ordinals must match enum GBAKey in mGBA's mgba/internal/gba/input.h
 * exactly -- the native side shifts the raw ordinal into a key bitmask.
 */
enum class GbaButton {
    A, B, SELECT, START, RIGHT, LEFT, UP, DOWN, R, L
}

/**
 * Thin Kotlin wrapper around a native mGBA core instance (mCore). Mirrors
 * gbcore's GameBoyNative one-instance-per-native-object shape, but the
 * emulation itself is mGBA (third_party/mgba), not code written for this
 * project -- see gba_jni.cpp for the boundary.
 */
class GbaNative private constructor(private var handle: Long, val width: Int, val height: Int) : AutoCloseable {

    companion object {
        init {
            System.loadLibrary("gbajni")
        }

        /**
         * Returns null if [rom] isn't a GBA ROM mGBA recognizes. [savePath],
         * if given, is where mGBA reads/writes this game's save data --
         * see gba_jni.cpp's nativeCreate for why that's a real file handed
         * to the core up front rather than something read back out later.
         */
        fun load(rom: ByteArray, savePath: String?): GbaNative? {
            val handle = nativeCreate(rom, savePath)
            if (handle == 0L) return null
            return GbaNative(handle, nativeGetWidth(handle), nativeGetHeight(handle))
        }

        @JvmStatic private external fun nativeCreate(rom: ByteArray, savePath: String?): Long
        @JvmStatic private external fun nativeDestroy(handle: Long)
        @JvmStatic private external fun nativeRunFrame(handle: Long)
        @JvmStatic private external fun nativeGetFramebuffer(handle: Long, outPixels: IntArray)
        @JvmStatic private external fun nativeGetWidth(handle: Long): Int
        @JvmStatic private external fun nativeGetHeight(handle: Long): Int
        @JvmStatic private external fun nativeSetButtonPressed(handle: Long, buttonId: Int, pressed: Boolean)
        @JvmStatic private external fun nativeReadAudioSamples(handle: Long, outSamples: ShortArray): Int
        @JvmStatic private external fun nativeGetAudioSampleRate(): Int
        @JvmStatic private external fun nativeSaveState(handle: Long): ByteArray?
        @JvmStatic private external fun nativeLoadState(handle: Long, data: ByteArray): Boolean

        val audioSampleRateHz: Int by lazy { nativeGetAudioSampleRate() }
    }

    /** width*height ARGB_8888 pixels (240*160 for GBA), reused across calls. */
    val framebuffer = IntArray(width * height)

    /** Runs [times] emulated frames (for fast-forward) before refreshing [framebuffer] once. */
    fun runFrame(times: Int = 1) {
        check(handle != 0L) { "GbaNative used after close()" }
        repeat(times) { nativeRunFrame(handle) }
        nativeGetFramebuffer(handle, framebuffer)
    }

    /** Full emulator state, not just cartridge save RAM -- lets you save/load anywhere. Null on failure. */
    fun saveState(): ByteArray? {
        check(handle != 0L) { "GbaNative used after close()" }
        return nativeSaveState(handle)
    }

    fun loadState(data: ByteArray): Boolean {
        check(handle != 0L) { "GbaNative used after close()" }
        return nativeLoadState(handle, data)
    }

    /** Fills [outSamples] (stereo pairs) with whatever's ready; returns frames written. */
    fun readAudioSamples(outSamples: ShortArray): Int {
        check(handle != 0L) { "GbaNative used after close()" }
        return nativeReadAudioSamples(handle, outSamples)
    }

    fun setButtonPressed(button: GbaButton, pressed: Boolean) {
        check(handle != 0L) { "GbaNative used after close()" }
        nativeSetButtonPressed(handle, button.ordinal, pressed)
    }

    override fun close() {
        if (handle != 0L) {
            nativeDestroy(handle)
            handle = 0L
        }
    }
}
