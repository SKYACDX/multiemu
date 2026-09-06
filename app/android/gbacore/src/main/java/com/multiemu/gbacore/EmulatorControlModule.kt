package com.multiemu.gbacore

import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File

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

    // ---- Cartridge save RAM (the game's own in-game saves, not a manual
    // save state) -- lives at the same path GbaView.loadRom() points
    // mGBA's persistent VFile at, so this is plain file I/O rather than
    // anything routed through the native core. Both methods are only
    // meant to be called while the game is paused (see App.tsx's save
    // modal, which pauses before offering these): overwriting the file
    // while mGBA has it open and writing through live would race with the
    // emulator's own writes.
    @ReactMethod
    fun getGameSaveBytes(romId: String, promise: Promise) {
        val file = File(File(reactApplicationContext.filesDir, "saves"), "$romId.sav")
        if (!file.exists()) {
            promise.reject("NO_SAVE_DATA", "Este juego todavía no tiene una partida guardada.")
            return
        }
        promise.resolve(Base64.encodeToString(file.readBytes(), Base64.NO_WRAP))
    }

    /** After this, the caller must reload the ROM (loadRomBase64) so mGBA picks up the new file. */
    @ReactMethod
    fun setGameSaveBytes(romId: String, base64: String, promise: Promise) {
        val dir = File(reactApplicationContext.filesDir, "saves").apply { mkdirs() }
        File(dir, "$romId.sav").writeBytes(Base64.decode(base64, Base64.DEFAULT))
        promise.resolve(null)
    }
}
