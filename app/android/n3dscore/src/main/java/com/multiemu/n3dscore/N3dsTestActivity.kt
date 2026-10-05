package com.multiemu.n3dscore

import android.app.Activity
import android.os.Bundle
import android.view.KeyEvent
import android.widget.Toast

/**
 * Phase 1 test bench, not part of the app's UI yet: opens the 3DS game at
 * the "rom" extra and shows it full screen, so the core can be measured on
 * real hardware before any controls or screens are built for it.
 *
 *   adb shell am start -n com.multiemuapp/com.multiemu.n3dscore.N3dsTestActivity --es rom /path/game.3ds
 *
 * Hardware/adb key events map to 3DS buttons (adb shell input keyevent
 * BUTTON_A, DPAD_UP, BUTTON_START, ...).
 */
class N3dsTestActivity : Activity() {
    private var view: N3dsView? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val rom = intent.getStringExtra("rom")
        if (rom == null || !N3dsNative.available) {
            Toast.makeText(this, if (rom == null) "Falta el extra 'rom'" else "3DS no disponible en este teléfono", Toast.LENGTH_LONG).show()
            finish()
            return
        }
        // Any "citra_*" string extra is passed to the core as an option,
        // for trying settings from adb (--es citra_cpu_clock_percentage 50).
        intent.extras?.keySet()?.filter { it.startsWith("citra_") }?.forEach { key ->
            intent.getStringExtra(key)?.let { N3dsNative.nativeSetOption(key, it) }
        }
        N3dsSession.stop()  // a fresh start, so the options above apply
        view = N3dsView(this).apply { loadRomPath(rom) }
        setContentView(view)
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val id = KEYS[event.keyCode] ?: return super.dispatchKeyEvent(event)
        when (event.action) {
            KeyEvent.ACTION_DOWN -> N3dsNative.nativeSetButton(id, true)
            KeyEvent.ACTION_UP -> N3dsNative.nativeSetButton(id, false)
        }
        return true
    }

    companion object {
        // libretro RETRO_DEVICE_ID_JOYPAD_* ids.
        private val KEYS = mapOf(
            KeyEvent.KEYCODE_BUTTON_B to 0, KeyEvent.KEYCODE_BUTTON_Y to 1,
            KeyEvent.KEYCODE_BUTTON_SELECT to 2, KeyEvent.KEYCODE_BUTTON_START to 3,
            KeyEvent.KEYCODE_DPAD_UP to 4, KeyEvent.KEYCODE_DPAD_DOWN to 5,
            KeyEvent.KEYCODE_DPAD_LEFT to 6, KeyEvent.KEYCODE_DPAD_RIGHT to 7,
            KeyEvent.KEYCODE_BUTTON_A to 8, KeyEvent.KEYCODE_BUTTON_X to 9,
            KeyEvent.KEYCODE_BUTTON_L1 to 10, KeyEvent.KEYCODE_BUTTON_R1 to 11,
            KeyEvent.KEYCODE_BUTTON_L2 to 12, KeyEvent.KEYCODE_BUTTON_R2 to 13,
        )
    }
}
