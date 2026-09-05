package com.multiemu.gbcore

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Rect
import android.util.Log
import android.view.Choreographer
import android.view.View

private const val TAG = "GameBoyView"
private const val SCREEN_WIDTH = 160
private const val SCREEN_HEIGHT = 144

/**
 * The actual game screen: owns one [GameBoyNative] instance, drives it at
 * the display's refresh rate via [Choreographer], and paints the
 * resulting framebuffer scaled to fill the view (nearest-neighbor, so
 * pixels stay crisp instead of blurring).
 *
 * All emulation state lives in the native GameBoy instance; this class is
 * just the Android-side render loop and touch-input entry point.
 */
class GameBoyView(context: Context) : View(context) {

    private var gameBoy: GameBoyNative? = null
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
            }
            if (running) Choreographer.getInstance().postFrameCallback(this)
        }
    }

    /** Replaces whatever ROM is currently loaded (if any) with [rom]. */
    fun loadRom(rom: ByteArray) {
        gameBoy?.close()
        gameBoy = GameBoyNative.load(rom)
        if (gameBoy == null) {
            Log.w(TAG, "loadRom: rejected (bad header or unsupported mapper), ${rom.size} bytes")
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
