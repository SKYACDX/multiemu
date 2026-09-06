package com.multiemu.gbacore

/**
 * Thin Kotlin wrapper around a native LinkedGbaSession (see
 * gba_link.h/.cpp): two mGBA cores connected through mGBA's own
 * GBASIOLockstep, each driven by its own native background thread (not
 * by this class -- see the header for why). Mirrors GbaNative's
 * one-instance-per-native-object shape, doubled for two players.
 */
class GbaLinkNative private constructor(private var handle: Long, val width: Int, val height: Int) : AutoCloseable {

    companion object {
        init {
            // Same shared library as GbaNative (gba_link_jni.cpp is built
            // into libgbajni.so alongside gba_jni.cpp) -- loading it twice
            // from the same classloader is a no-op, not an error.
            System.loadLibrary("gbajni")
        }

        /** Returns null if either ROM isn't a GBA ROM mGBA recognizes. */
        fun create(romA: ByteArray, savePathA: String?, romB: ByteArray, savePathB: String?): GbaLinkNative? {
            val handle = nativeCreateSession(romA, savePathA, romB, savePathB)
            if (handle == 0L) return null
            return GbaLinkNative(handle, nativeGetWidth(handle), nativeGetHeight(handle))
        }

        @JvmStatic private external fun nativeCreateSession(romA: ByteArray, savePathA: String?, romB: ByteArray, savePathB: String?): Long
        @JvmStatic private external fun nativeDestroySession(handle: Long)
        @JvmStatic private external fun nativeGetWidth(handle: Long): Int
        @JvmStatic private external fun nativeGetHeight(handle: Long): Int
        @JvmStatic private external fun nativeGetFramebuffer(handle: Long, player: Int, outPixels: IntArray)
        @JvmStatic private external fun nativeSetButtonPressed(handle: Long, player: Int, buttonId: Int, pressed: Boolean)
        @JvmStatic private external fun nativeGetFramesRun(handle: Long, player: Int): Long
        @JvmStatic private external fun nativeGetDebugState(handle: Long): String
    }

    /** width*height ARGB_8888 pixels each, reused across calls. */
    val framebufferA = IntArray(width * height)
    val framebufferB = IntArray(width * height)

    /** Copies out whatever frame [player] (0 or 1) most recently finished. */
    fun readFramebuffer(player: Int) {
        check(handle != 0L) { "GbaLinkNative used after close()" }
        nativeGetFramebuffer(handle, player, if (player == 0) framebufferA else framebufferB)
    }

    fun setButtonPressed(player: Int, button: GbaButton, pressed: Boolean) {
        check(handle != 0L) { "GbaLinkNative used after close()" }
        nativeSetButtonPressed(handle, player, button.ordinal, pressed)
    }

    /** TEMPORARY diagnostic -- see LinkedGbaSession::framesRun. Delete once local link is confirmed working. */
    fun framesRun(player: Int): Long {
        check(handle != 0L) { "GbaLinkNative used after close()" }
        return nativeGetFramesRun(handle, player)
    }

    /** TEMPORARY diagnostic -- see LinkedGbaSession::debugState. */
    fun debugState(): String {
        check(handle != 0L) { "GbaLinkNative used after close()" }
        return nativeGetDebugState(handle)
    }

    override fun close() {
        if (handle != 0L) {
            nativeDestroySession(handle)
            handle = 0L
        }
    }
}
