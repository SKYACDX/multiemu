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
        val audioSampleRateHz: Int by lazy { nativeGetAudioSampleRate() }

        /** Returns null if the ROM isn't an NDS ROM melonDS recognizes. savePath may be null to skip persistence. */
        fun load(rom: ByteArray, savePath: String?): DsNative? {
            val handle = nativeCreate(rom, savePath)
            if (handle == 0L) return null
            return DsNative(handle)
        }

        /**
         * Reads the ROM directly off disk on the native side instead of
         * through a Java byte[] -- use this one, not [load], for
         * anything but a tiny ROM. NDS ROMs run 128-512MB; round-tripping
         * that through a base64 JS-bridge string (as the GB/GBA picker
         * flow does) reliably OOMs. See RomFilePickerModule.pickRomPath.
         */
        fun loadFromPath(romPath: String, savePath: String?): DsNative? {
            val handle = nativeCreateFromPath(romPath, savePath)
            if (handle == 0L) return null
            return DsNative(handle)
        }

        @JvmStatic private external fun nativeCreate(rom: ByteArray, savePath: String?): Long
        @JvmStatic private external fun nativeCreateFromPath(romPath: String, savePath: String?): Long
        @JvmStatic private external fun nativeDestroy(handle: Long)
        @JvmStatic private external fun nativeRunFrame(handle: Long)
        @JvmStatic private external fun nativeGetWidth(): Int
        @JvmStatic private external fun nativeGetHeight(): Int
        @JvmStatic private external fun nativeGetFramebuffer(handle: Long, screen: Int, outPixels: IntArray)
        @JvmStatic private external fun nativeSetButtonPressed(handle: Long, buttonId: Int, pressed: Boolean)
        @JvmStatic private external fun nativeTouchScreen(handle: Long, x: Int, y: Int)
        @JvmStatic private external fun nativeReleaseScreen(handle: Long)
        @JvmStatic private external fun nativeGetAudioSampleRate(): Int
        @JvmStatic private external fun nativeReadAudioSamples(handle: Long, outSamples: ShortArray): Int
        @JvmStatic private external fun nativeSaveState(handle: Long): ByteArray?
        @JvmStatic private external fun nativeLoadState(handle: Long, data: ByteArray): Boolean
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

    /** Drains pending audio into outSamples (interleaved stereo 16-bit PCM); returns frames written. */
    fun readAudioSamples(outSamples: ShortArray): Int {
        check(handle != 0L) { "DsNative used after close()" }
        return nativeReadAudioSamples(handle, outSamples)
    }

    /** Full emulator state (CPU/memory/GPU/APU/etc), not just the cartridge save file -- see Savestate.h. */
    fun saveState(): ByteArray? {
        check(handle != 0L) { "DsNative used after close()" }
        return nativeSaveState(handle)
    }

    fun loadState(data: ByteArray): Boolean {
        check(handle != 0L) { "DsNative used after close()" }
        return nativeLoadState(handle, data)
    }

    override fun close() {
        if (handle != 0L) {
            nativeDestroy(handle)
            handle = 0L
        }
    }
}
