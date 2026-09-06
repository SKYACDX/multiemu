package com.multiemu.gbacore

import android.util.Base64
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext

/**
 * Exposes [GbaView] to React Native as `<GbaView />`. Same command
 * protocol as gbcore's GameBoyView:
 *   - "loadRomBase64" [base64String, romId?] -- romId is a stable
 *     per-ROM key (e.g. its CRC32) used to key its save file; omit it
 *     (or pass null) to skip save persistence.
 *   - "setButtonPressed" [buttonName, pressed] -- buttonName must match a
 *     GbaButton enum constant name (e.g. "A", "START", "L")
 *   - "setSpeedMultiplier" [1|2|3] -- fast-forward (mutes audio above 1x)
 *   - "setPaused" [true|false] -- freezes emulation (used while the
 *     manual-save modal is open)
 */
class GbaViewManager : SimpleViewManager<GbaView>() {
    override fun getName() = "GbaView"

    override fun createViewInstance(reactContext: ThemedReactContext): GbaView =
        GbaView(reactContext)

    override fun receiveCommand(view: GbaView, commandId: String, args: ReadableArray?) {
        when (commandId) {
            "loadRomBase64" -> {
                val base64 = args?.getString(0) ?: return
                val romId = if (args.size() > 1 && !args.isNull(1)) args.getString(1) else null
                view.loadRom(Base64.decode(base64, Base64.DEFAULT), romId)
            }
            "setButtonPressed" -> {
                val buttonName = args?.getString(0) ?: return
                val pressed = args.getBoolean(1)
                val button = runCatching { GbaButton.valueOf(buttonName) }.getOrNull() ?: return
                view.setButtonPressed(button, pressed)
            }
            "setSpeedMultiplier" -> {
                val multiplier = args?.getDouble(0)?.toInt() ?: return
                view.setSpeedMultiplier(multiplier)
            }
            "setPaused" -> {
                val paused = args?.getBoolean(0) ?: return
                view.setPaused(paused)
            }
        }
    }
}
