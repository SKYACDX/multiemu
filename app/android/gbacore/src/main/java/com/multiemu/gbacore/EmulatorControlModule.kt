package com.multiemu.gbacore

import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Full-state save/load needs a round-trip Promise (the resulting bytes
 * have to come back to JS), which React Native's fire-and-forget
 * `dispatchViewManagerCommand` can't do -- so unlike loadRomBase64/
 * setButtonPressed/setSpeedMultiplier (plain commands on the view
 * manager), this is a regular NativeModule that reaches into whichever
 * GbaView is currently on screen.
 *
 * GB/GBC has no equivalent yet -- gbcore doesn't implement full-state
 * serialization (see docs/roadmap.md), only cartridge battery RAM.
 */
class EmulatorControlModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    companion object {
        /** Set by GbaView.onAttachedToWindow/cleared on detach -- there's at most one on screen at a time. */
        var activeGba: GbaView? = null
    }

    override fun getName() = "EmulatorControl"

    @ReactMethod
    fun saveGbaState(promise: Promise) {
        val bytes = activeGba?.saveState()
        if (bytes == null) {
            promise.reject("SAVE_STATE_FAILED", "No se pudo crear el save state (¿hay un juego de GBA cargado?)")
            return
        }
        promise.resolve(Base64.encodeToString(bytes, Base64.NO_WRAP))
    }

    @ReactMethod
    fun loadGbaState(base64: String, promise: Promise) {
        val view = activeGba
        if (view == null) {
            promise.reject("NO_ACTIVE_GAME", "No hay un juego de GBA cargado")
            return
        }
        val ok = view.loadState(Base64.decode(base64, Base64.DEFAULT))
        if (ok) promise.resolve(null) else promise.reject("LOAD_STATE_FAILED", "El save state no es compatible con esta ROM")
    }

    /** TEMPORARY: see GbaView's totalAudioFramesRead/lastAudioWriteResult. Delete once audio is confirmed working. */
    @ReactMethod
    fun getAudioDebugInfo(promise: Promise) {
        promise.resolve(activeGba?.getAudioDebugInfo() ?: "no active GbaView")
    }
}
