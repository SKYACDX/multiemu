package com.multiemu.n3dscore

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewManager

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

class N3dsPackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> = emptyList()

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
        if (N3dsNative.available) listOf(N3dsViewManager()) else emptyList()
}
