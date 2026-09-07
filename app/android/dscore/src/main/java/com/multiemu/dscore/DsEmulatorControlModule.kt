package com.multiemu.dscore

import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * NDS equivalent of gbacore's EmulatorControlModule: full-state save/load
 * needs a round-trip Promise, which the view manager's fire-and-forget
 * dispatchViewManagerCommand can't do, so this reaches into whichever
 * DsView is currently on screen -- see DsView.onAttachedToWindow/
 * onDetachedFromWindow, which keep [activeDs] up to date.
 */
class DsEmulatorControlModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        var activeDs: DsView? = null
    }

    override fun getName() = "DsEmulatorControl"

    @ReactMethod
    fun saveDsState(promise: Promise) {
        val bytes = activeDs?.saveState()
        if (bytes == null) {
            promise.reject("SAVE_STATE_FAILED", "No se pudo crear el save state (¿hay un juego de NDS cargado?)")
            return
        }
        promise.resolve(Base64.encodeToString(bytes, Base64.NO_WRAP))
    }

    @ReactMethod
    fun loadDsState(base64: String, promise: Promise) {
        val view = activeDs
        if (view == null) {
            promise.reject("NO_ACTIVE_GAME", "No hay un juego de NDS cargado")
            return
        }
        val ok = view.loadState(Base64.decode(base64, Base64.DEFAULT))
        if (ok) promise.resolve(null) else promise.reject("LOAD_STATE_FAILED", "El save state no es compatible con esta ROM")
    }

    /**
     * Inserts a GBA ROM into the slot-2 for Pal Park-style transfers --
     * see DsView.insertGbaCart. [gbaRomId] should be that ROM's CRC32
     * (same key GbaView uses for its own save file).
     */
    @ReactMethod
    fun insertGbaCart(gbaRomPath: String, gbaRomId: String?, promise: Promise) {
        val view = activeDs
        if (view == null) {
            promise.reject("NO_ACTIVE_GAME", "No hay un juego de NDS cargado")
            return
        }
        val ok = view.insertGbaCart(gbaRomPath, gbaRomId)
        if (ok) promise.resolve(null) else promise.reject("INVALID_GBA_ROM", "Ese archivo no es una ROM de GBA reconocible")
    }

    @ReactMethod
    fun ejectGbaCart(promise: Promise) {
        activeDs?.ejectGbaCart()
        promise.resolve(null)
    }
}
