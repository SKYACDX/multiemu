package com.multiemu.gbcore

import android.util.Base64
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext

/**
 * Exposes [GameBoyView] to React Native as `<GameBoyView />`. No props --
 * everything happens through two commands, dispatched from JS via
 * `UIManager.dispatchViewManagerCommand`:
 *   - "loadRomBase64" [base64String, romId?] -- romId is a stable
 *     per-ROM key (e.g. its CRC32) used to key its save file; omit it
 *     (or pass null) to skip save persistence.
 *   - "setButtonPressed" [buttonName, pressed] -- buttonName must match a
 *     GameBoyButton enum constant name (e.g. "A", "START", "RIGHT")
 */
class GameBoyViewManager : SimpleViewManager<GameBoyView>() {
    override fun getName() = "GameBoyView"

    override fun createViewInstance(reactContext: ThemedReactContext): GameBoyView =
        GameBoyView(reactContext)

    override fun receiveCommand(view: GameBoyView, commandId: String, args: ReadableArray?) {
        when (commandId) {
            "loadRomBase64" -> {
                val base64 = args?.getString(0) ?: return
                val romId = if (args.size() > 1 && !args.isNull(1)) args.getString(1) else null
                view.loadRom(Base64.decode(base64, Base64.DEFAULT), romId)
            }
            "setButtonPressed" -> {
                val buttonName = args?.getString(0) ?: return
                val pressed = args.getBoolean(1)
                val button = runCatching { GameBoyButton.valueOf(buttonName) }.getOrNull() ?: return
                view.setButtonPressed(button, pressed)
            }
        }
    }
}
