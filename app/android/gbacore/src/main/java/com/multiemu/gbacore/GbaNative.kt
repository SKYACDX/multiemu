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

        /** Returns null if [rom] isn't a GBA ROM mGBA recognizes. */
        fun load(rom: ByteArray): GbaNative? {
            val handle = nativeCreate(rom)
            if (handle == 0L) return null
            return GbaNative(handle, nativeGetWidth(handle), nativeGetHeight(handle))
        }

        @JvmStatic private external fun nativeCreate(rom: ByteArray): Long
        @JvmStatic private external fun nativeDestroy(handle: Long)
        @JvmStatic private external fun nativeRunFrame(handle: Long)
        @JvmStatic private external fun nativeGetFramebuffer(handle: Long, outPixels: IntArray)
        @JvmStatic private external fun nativeGetWidth(handle: Long): Int
        @JvmStatic private external fun nativeGetHeight(handle: Long): Int
        @JvmStatic private external fun nativeSetButtonPressed(handle: Long, buttonId: Int, pressed: Boolean)
    }

    /** width*height ARGB_8888 pixels (240*160 for GBA), reused across calls. */
    val framebuffer = IntArray(width * height)

    fun runFrame() {
        check(handle != 0L) { "GbaNative used after close()" }
        nativeRunFrame(handle)
        nativeGetFramebuffer(handle, framebuffer)
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
