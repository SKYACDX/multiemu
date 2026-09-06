package com.multiemu.gbacore

import android.util.Base64
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext

/**
 * Exposes [GbaView] to React Native as `<GbaView />`. Same command
 * protocol as gbcore's GameBoyView:
 *   - "loadRomBase64" [base64String]
 *   - "setButtonPressed" [buttonName, pressed] -- buttonName must match a
 *     GbaButton enum constant name (e.g. "A", "START", "L")
 */
class GbaViewManager : SimpleViewManager<GbaView>() {
    override fun getName() = "GbaView"

    override fun createViewInstance(reactContext: ThemedReactContext): GbaView =
        GbaView(reactContext)

    override fun receiveCommand(view: GbaView, commandId: String, args: ReadableArray?) {
        when (commandId) {
            "loadRomBase64" -> {
                val base64 = args?.getString(0) ?: return
                view.loadRom(Base64.decode(base64, Base64.DEFAULT))
            }
            "setButtonPressed" -> {
                val buttonName = args?.getString(0) ?: return
                val pressed = args.getBoolean(1)
                val button = runCatching { GbaButton.valueOf(buttonName) }.getOrNull() ?: return
                view.setButtonPressed(button, pressed)
            }
        }
    }
}
