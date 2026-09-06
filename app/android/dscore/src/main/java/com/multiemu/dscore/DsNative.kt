package com.multiemu.dscore

/**
 * Thin Kotlin wrapper around melonDS's core (see ds_jni.cpp/ds_platform.cpp).
 * Placeholder -- only proves the native library loads; no ROM loading yet.
 */
object DsNative {
    init {
        System.loadLibrary("dsjni")
    }

    @JvmStatic external fun nativeVersionProbe(): String
}
