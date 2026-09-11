package com.multiemu.dscore

import android.view.Surface

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

        /**
         * Hands the SurfaceView's Surface (or null, when it goes away) to
         * the native GL layer, which wraps it in an EGL window surface so
         * frames can be blitted GPU->screen with no CPU round trip -- see
         * ds_jni.cpp's nativeSetSurface. Process-global, not per-session
         * (the GL context is), so it takes no handle and stays valid
         * across ROM loads. MUST be called on the same thread that runs
         * frames: an EGL context is thread-bound.
         */
        fun setSurface(surface: Surface?) = nativeSetSurface(surface)

        @JvmStatic private external fun nativeSetSurface(surface: Surface?)

        @JvmStatic private external fun nativeCreate(rom: ByteArray, savePath: String?): Long
        @JvmStatic private external fun nativeCreateFromPath(romPath: String, savePath: String?): Long
        @JvmStatic private external fun nativeDestroy(handle: Long)
        @JvmStatic private external fun nativeRunFrame(handle: Long)
        @JvmStatic private external fun nativeGetWidth(): Int
        @JvmStatic private external fun nativeGetHeight(): Int
        @JvmStatic private external fun nativeGetFramebuffer(handle: Long, screen: Int, outPixels: IntArray)
        @JvmStatic private external fun nativePresentFrame(
            handle: Long,
            topX: Int, topY: Int, topW: Int, topH: Int,
            botX: Int, botY: Int, botW: Int, botH: Int,
            surfaceWidth: Int, surfaceHeight: Int,
        ): Int

        /** [presentFrame] drew the frame; nothing else to do. */
        const val PRESENT_OK = 0

        /**
         * No EGL window surface (yet). Transient: [setSurface] is posted
         * to the emulation thread and can still be sitting behind a
         * multi-second ROM load. Use the Bitmap/Canvas path for this
         * frame and try again on the next one -- do NOT latch it off.
         */
        const val PRESENT_NO_SURFACE = 1

        /**
         * melonDS fell back to its software 3D renderer, so there's no
         * compositor output to blit. Permanent for the session, and
         * unlike [PRESENT_NO_SURFACE] the Surface has to be handed back
         * (EGL and lockCanvas cannot both own one).
         */
        const val PRESENT_NOT_ACCELERATED = 2
        @JvmStatic private external fun nativeSetButtonPressed(handle: Long, buttonId: Int, pressed: Boolean)
        @JvmStatic private external fun nativeTouchScreen(handle: Long, x: Int, y: Int)
        @JvmStatic private external fun nativeReleaseScreen(handle: Long)
        @JvmStatic private external fun nativeGetAudioSampleRate(): Int
        @JvmStatic private external fun nativeReadAudioSamples(handle: Long, outSamples: ShortArray): Int
        @JvmStatic private external fun nativeSaveState(handle: Long): ByteArray?
        @JvmStatic private external fun nativeLoadState(handle: Long, data: ByteArray): Boolean
        @JvmStatic private external fun nativeInsertGbaCart(handle: Long, gbaRomPath: String, gbaSavePath: String?): Boolean
        @JvmStatic private external fun nativeEjectGbaCart(handle: Long)
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

    /**
     * Draws the frame straight from the GL compositor to the window
     * surface handed over by [setSurface], skipping the whole
     * GPU->CPU->Bitmap->Canvas path [readFramebuffers] feeds. Rects are
     * top-left-origin pixels in surface space. Returns one of the
     * PRESENT_* codes -- anything but [PRESENT_OK] means the caller has
     * to fall back to that CPU path for this frame.
     */
    fun presentFrame(
        top: android.graphics.Rect,
        bottom: android.graphics.Rect,
        surfaceWidth: Int,
        surfaceHeight: Int,
    ): Int {
        check(handle != 0L) { "DsNative used after close()" }
        return nativePresentFrame(
            handle,
            top.left, top.top, top.width(), top.height(),
            bottom.left, bottom.top, bottom.width(), bottom.height(),
            surfaceWidth, surfaceHeight,
        )
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

    /**
     * Inserts a GBA ROM into the slot-2 -- the same physical mechanism
     * Pal Park and the GBA-slot Pokemon transfer use to read a 3rd-gen
     * game's Pokemon. [gbaSavePath] should be the same .sav path
     * GbaView already uses for this ROM (its CRC32-keyed save under
     * saves/) so the transfer sees whatever's already been caught
     * playing it standalone. Returns false if it's not a GBA ROM
     * melonDS recognizes.
     */
    fun insertGbaCart(gbaRomPath: String, gbaSavePath: String?): Boolean {
        check(handle != 0L) { "DsNative used after close()" }
        return nativeInsertGbaCart(handle, gbaRomPath, gbaSavePath)
    }

    fun ejectGbaCart() {
        check(handle != 0L) { "DsNative used after close()" }
        nativeEjectGbaCart(handle)
    }

    override fun close() {
        if (handle != 0L) {
            nativeDestroy(handle)
            handle = 0L
        }
    }
}
