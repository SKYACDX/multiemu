package com.multiemu.gbacore

import android.util.Base64
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext

/**
 * Exposes [GbaLinkView] to React Native as `<GbaLinkView />` -- local
 * (same-device) 2-player GBA link cable. Commands:
 *   - "loadRoms" [base64A, romIdA?, base64B, romIdB?]
 *   - "setButtonPressed" [player(0|1), buttonName, pressed] -- buttonName
 *     must match a GbaButton enum constant name (e.g. "A", "UP", "L")
 */
class GbaLinkViewManager : SimpleViewManager<GbaLinkView>() {
    override fun getName() = "GbaLinkView"

    override fun createViewInstance(reactContext: ThemedReactContext): GbaLinkView =
        GbaLinkView(reactContext)

    override fun receiveCommand(view: GbaLinkView, commandId: String, args: ReadableArray?) {
        when (commandId) {
            "loadRoms" -> {
                if (args == null) return
                val base64A = args.getString(0) ?: return
                val romIdA = if (!args.isNull(1)) args.getString(1) else null
                val base64B = args.getString(2) ?: return
                val romIdB = if (args.size() > 3 && !args.isNull(3)) args.getString(3) else null
                view.loadRoms(
                    Base64.decode(base64A, Base64.DEFAULT),
                    romIdA,
                    Base64.decode(base64B, Base64.DEFAULT),
                    romIdB,
                )
            }
            "setButtonPressed" -> {
                if (args == null) return
                val player = args.getDouble(0).toInt()
                val buttonName = args.getString(1) ?: return
                val pressed = args.getBoolean(2)
                val button = runCatching { GbaButton.valueOf(buttonName) }.getOrNull() ?: return
                view.setButtonPressed(player, button, pressed)
            }
        }
    }
}
