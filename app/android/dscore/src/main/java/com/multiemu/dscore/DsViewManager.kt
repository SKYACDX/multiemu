package com.multiemu.dscore

import android.util.Base64
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext

/**
 * Exposes [DsView] to React Native as `<DsView />`. Same command
 * protocol shape as gbacore's GbaViewManager -- see that file:
 *   - "loadRomBase64" [base64String, romId?] -- only for small ROMs,
 *     see loadRomPath below for why this isn't the normal path for NDS.
 *   - "loadRomPath" [path, romId?] -- reads the ROM directly off disk on
 *     the native side (see ds_jni.cpp's nativeCreateFromPath) instead of
 *     round-tripping a 128-512MB ROM through a base64 JS-bridge string,
 *     which reliably OOMs. path comes from RomFilePickerModule.pickRomPath.
 *   - "setButtonPressed" [buttonName, pressed] -- buttonName must match
 *     a DsButton enum constant name (e.g. "A", "X", "L")
 *   - "setPaused" [true|false] -- freezes emulation (used while the
 *     manual-save modal is open)
 * Touch-screen input is NOT a command here -- DsView handles it
 * directly via onTouchEvent, since it already computes the bottom
 * screen's exact scaled rect for drawing.
 */
class DsViewManager : SimpleViewManager<DsView>() {
    override fun getName() = "DsView"

    override fun createViewInstance(reactContext: ThemedReactContext): DsView = DsView(reactContext)

    override fun receiveCommand(view: DsView, commandId: String, args: ReadableArray?) {
        when (commandId) {
            "loadRomBase64" -> {
                val base64 = args?.getString(0) ?: return
                val romId = if (args.size() > 1 && !args.isNull(1)) args.getString(1) else null
                view.loadRom(Base64.decode(base64, Base64.DEFAULT), romId)
            }
            "loadRomPath" -> {
                val path = args?.getString(0) ?: return
                val romId = if (args.size() > 1 && !args.isNull(1)) args.getString(1) else null
                view.loadRomFromPath(path, romId)
            }
            "replaceSave" -> {
                val romId = args?.getString(0) ?: return
                try {
                    view.replaceSave(romId, Base64.decode(args.getString(1) ?: return, Base64.DEFAULT))
                } catch (e: IllegalArgumentException) {
                    android.util.Log.e("DsViewManager", "replaceSave refused: ${e.message}")
                }
            }
            "setButtonPressed" -> {
                val buttonName = args?.getString(0) ?: return
                val pressed = args.getBoolean(1)
                val button = runCatching { DsButton.valueOf(buttonName) }.getOrNull() ?: return
                view.setButtonPressed(button, pressed)
            }
            "setPaused" -> {
                val paused = args?.getBoolean(0) ?: return
                view.setPaused(paused)
            }
        }
    }
}
