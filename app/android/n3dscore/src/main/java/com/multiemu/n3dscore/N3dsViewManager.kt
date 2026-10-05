package com.multiemu.n3dscore

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewManager
import java.io.File

/**
 * Exposes [N3dsView] to React Native as `<N3dsView />`. Commands, same
 * shape as DsViewManager:
 *   - "loadRomPath" [path] -- the core reads the ROM straight off disk
 *   - "setButtonPressed" [buttonName, pressed] -- an [N3dsButton] name
 *   - "setPaused" [true|false]
 * Touch is handled natively by the view, like DsView's bottom screen.
 */
class N3dsViewManager : SimpleViewManager<N3dsView>() {
    override fun getName() = "N3dsView"

    override fun createViewInstance(reactContext: ThemedReactContext) = N3dsView(reactContext)

    override fun receiveCommand(view: N3dsView, commandId: String, args: ReadableArray?) {
        if (args == null) return
        when (commandId) {
            "loadRomPath" -> view.loadRomPath(args.getString(0) ?: return)
            "setButtonPressed" -> {
                val button = runCatching { N3dsButton.valueOf(args.getString(0) ?: return) }.getOrNull() ?: return
                view.setButtonPressed(button, args.getBoolean(1))
            }
            "setPaused" -> view.setPaused(args.getBoolean(0))
        }
    }
}

/**
 * 3DS state slots for JS. The file is the same one RomLibraryModule keeps
 * for GBA/DS slots (filesDir/states/<romId>_slot<N>.state), so listing and
 * deleting slots works unchanged -- only writing and reading differ: the
 * core does it straight to disk, since a 3DS state is far too big to pass
 * through JS as base64 the way the others do.
 */
class N3dsStateModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    override fun getName() = "N3dsState"

    // Block bodies on purpose: React Native's module system treats any
    // @ReactMethod that returns a value as synchronous, and rejects a
    // synchronous one taking a Promise -- an expression body returning
    // Handler.post's Boolean took the whole app down at startup.
    @ReactMethod
    fun saveSlot(romId: String, slot: Int, promise: Promise) {
        N3dsSession.saveState(slotFile(romId, slot).path) { error -> settle(promise, error) }
    }

    @ReactMethod
    fun loadSlot(romId: String, slot: Int, promise: Promise) {
        N3dsSession.loadState(slotFile(romId, slot).path) { error -> settle(promise, error) }
    }

    private fun settle(promise: Promise, error: String?) {
        if (error == null) promise.resolve(null) else promise.reject("N3DS_STATE", error)
    }

    private fun slotFile(romId: String, slot: Int) =
        File(File(context.filesDir, "states").apply { mkdirs() }, "${romId}_slot$slot.state")
}

class N3dsPackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
        if (N3dsNative.available) listOf(N3dsStateModule(reactContext)) else emptyList()

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
        if (N3dsNative.available) listOf(N3dsViewManager()) else emptyList()
}
