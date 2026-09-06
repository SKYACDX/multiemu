package com.multiemu.gbcore

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Rect
import android.util.Log
import android.view.Choreographer
import android.view.View
import java.io.File

private const val TAG = "GameBoyView"
private const val SCREEN_WIDTH = 160
private const val SCREEN_HEIGHT = 144

// How often to flush battery-backed cartridge RAM to disk while playing,
// in frames (~every 2s at 59.7fps) -- frequent enough that a crash or a
// killed app doesn't lose much progress, infrequent enough that it's not
// doing file I/O every frame.
private const val SAVE_INTERVAL_FRAMES = 120

/**
 * The actual game screen: owns one [GameBoyNative] instance, drives it at
 * the display's refresh rate via [Choreographer], and paints the
 * resulting framebuffer scaled to fill the view (nearest-neighbor, so
 * pixels stay crisp instead of blurring).
 *
 * All emulation state lives in the native GameBoy instance; this class is
 * just the Android-side render loop, touch-input entry point, and
 * battery-save persistence (for cartridges that have one -- see
 * cartridge.h's hasBattery()).
 */
class GameBoyView(context: Context) : View(context) {

    private var gameBoy: GameBoyNative? = null
    private var saveFile: File? = null
    private var framesSinceSave = 0
    private val bitmap = Bitmap.createBitmap(SCREEN_WIDTH, SCREEN_HEIGHT, Bitmap.Config.ARGB_8888)
    private val srcRect = Rect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT)
    private val paint = Paint().apply { isFilterBitmap = false }
    private var running = false

    private val frameCallback = object : Choreographer.FrameCallback {
        override fun doFrame(frameTimeNanos: Long) {
            gameBoy?.let {
                it.runFrame()
                bitmap.setPixels(it.framebuffer, 0, SCREEN_WIDTH, 0, 0, SCREEN_WIDTH, SCREEN_HEIGHT)
                invalidate()

                if (it.hasBattery && ++framesSinceSave >= SAVE_INTERVAL_FRAMES) {
                    framesSinceSave = 0
                    writeSaveFile()
                }
            }
            if (running) Choreographer.getInstance().postFrameCallback(this)
        }
    }

    /**
     * Replaces whatever ROM is currently loaded (if any) with [rom].
     * [romId] identifies the save file (a stable per-ROM key, e.g. its
     * CRC32) -- pass null to skip save persistence entirely (used for the
     * built-in test ROM, which has no battery RAM anyway).
     */
    fun loadRom(rom: ByteArray, romId: String?) {
        writeSaveFile()
        gameBoy?.close()
        framesSinceSave = 0

        val instance = GameBoyNative.load(rom)
        gameBoy = instance
        if (instance == null) {
            Log.w(TAG, "loadRom: rejected (bad header or unsupported mapper), ${rom.size} bytes")
            saveFile = null
            return
        }

        saveFile = romId?.let { File(File(context.filesDir, "saves").apply { mkdirs() }, "$it.sav") }
        val file = saveFile
        if (instance.hasBattery && file != null && file.exists()) {
            try {
                instance.loadSaveData(file.readBytes())
            } catch (e: Exception) {
                Log.w(TAG, "loadRom: failed to read save file $file", e)
            }
        }
    }

    private fun writeSaveFile() {
        val instance = gameBoy ?: return
        val file = saveFile ?: return
        if (!instance.hasBattery) return
        try {
            file.writeBytes(instance.getSaveData())
        } catch (e: Exception) {
            Log.w(TAG, "writeSaveFile: failed to write $file", e)
        }
    }

    fun setButtonPressed(button: GameBoyButton, pressed: Boolean) {
        gameBoy?.setButtonPressed(button, pressed)
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        running = true
        Choreographer.getInstance().postFrameCallback(frameCallback)
    }

    override fun onDetachedFromWindow() {
        running = false
        Choreographer.getInstance().removeFrameCallback(frameCallback)
        writeSaveFile()
        gameBoy?.close()
        gameBoy = null
        super.onDetachedFromWindow()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val destRect = Rect(0, 0, width, height)
        canvas.drawBitmap(bitmap, srcRect, destRect, paint)
    }
}
