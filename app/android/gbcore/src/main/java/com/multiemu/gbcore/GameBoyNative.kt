package com.multiemu.gbcore

/**
 * Button ordinals must match gb::Button in core/gb/include/gb/joypad.h
 * exactly -- the native side casts the raw int straight to that enum.
 */
enum class GameBoyButton {
    RIGHT, LEFT, UP, DOWN, A, B, SELECT, START
}

/**
 * Thin Kotlin wrapper around a native gb::GameBoy instance. One instance
 * of this class owns exactly one native GameBoy; call [close] (or use
 * Kotlin's `.use {}`) when done with it, since the native memory isn't
 * managed by the JVM's GC.
 *
 * This class only exists to expose the emulator to the platform layer
 * (a Compose view, or -- per the project's actual plan -- a React Native
 * native module) that pulls frames and forwards touch input. It has no
 * emulation logic of its own.
 */
class GameBoyNative private constructor(private var handle: Long) : AutoCloseable {

    companion object {
        init {
            System.loadLibrary("gbjni")
        }

        /** Returns null if [rom]'s header is invalid or its mapper isn't supported yet. */
        fun load(rom: ByteArray): GameBoyNative? {
            val handle = nativeCreate(rom)
            return if (handle == 0L) null else GameBoyNative(handle)
        }

        @JvmStatic private external fun nativeCreate(rom: ByteArray): Long
        @JvmStatic private external fun nativeDestroy(handle: Long)
        @JvmStatic private external fun nativeRunFrame(handle: Long)
        @JvmStatic private external fun nativeGetFramebuffer(handle: Long, outPixels: IntArray)
        @JvmStatic private external fun nativeSetButtonPressed(handle: Long, buttonId: Int, pressed: Boolean)
        @JvmStatic private external fun nativeHasBattery(handle: Long): Boolean
        @JvmStatic private external fun nativeGetSaveData(handle: Long): ByteArray
        @JvmStatic private external fun nativeLoadSaveData(handle: Long, data: ByteArray)
    }

    /** Whether this cartridge has battery-backed RAM worth persisting (see cartridge.h). */
    val hasBattery: Boolean by lazy { nativeHasBattery(handle) }

    fun getSaveData(): ByteArray {
        check(handle != 0L) { "GameBoyNative used after close()" }
        return nativeGetSaveData(handle)
    }

    fun loadSaveData(data: ByteArray) {
        check(handle != 0L) { "GameBoyNative used after close()" }
        nativeLoadSaveData(handle, data)
    }

    /** 160*144 ARGB_8888 pixels, reused across calls -- copy it if you need to keep a frame around. */
    val framebuffer = IntArray(160 * 144)

    /** Runs [times] emulated frames (for fast-forward), then refreshes [framebuffer] once. */
    fun runFrame(times: Int = 1) {
        check(handle != 0L) { "GameBoyNative used after close()" }
        repeat(times) { nativeRunFrame(handle) }
        nativeGetFramebuffer(handle, framebuffer)
    }

    fun setButtonPressed(button: GameBoyButton, pressed: Boolean) {
        check(handle != 0L) { "GameBoyNative used after close()" }
        nativeSetButtonPressed(handle, button.ordinal, pressed)
    }

    override fun close() {
        if (handle != 0L) {
            nativeDestroy(handle)
            handle = 0L
        }
    }
}
