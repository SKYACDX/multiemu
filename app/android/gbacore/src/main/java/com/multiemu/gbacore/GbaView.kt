package com.multiemu.gbacore

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Rect
import android.util.Log
import android.view.Choreographer
import android.view.View

private const val TAG = "GbaView"

/**
 * GBA equivalent of gbcore's GameBoyView: owns one [GbaNative] instance,
 * drives it via [Choreographer], and paints the resulting framebuffer
 * scaled to fill the view with nearest-neighbor filtering.
 */
class GbaView(context: Context) : View(context) {

    private var gba: GbaNative? = null
    private var bitmap: Bitmap? = null
    private val paint = Paint().apply { isFilterBitmap = false }
    private var running = false

    private val frameCallback = object : Choreographer.FrameCallback {
        override fun doFrame(frameTimeNanos: Long) {
            gba?.let { instance ->
                instance.runFrame()
                bitmap?.setPixels(instance.framebuffer, 0, instance.width, 0, 0, instance.width, instance.height)
                invalidate()
            }
            if (running) Choreographer.getInstance().postFrameCallback(this)
        }
    }

    /** Replaces whatever ROM is currently loaded (if any) with [rom]. */
    fun loadRom(rom: ByteArray) {
        gba?.close()
        val instance = GbaNative.load(rom)
        gba = instance
        bitmap = instance?.let { Bitmap.createBitmap(it.width, it.height, Bitmap.Config.ARGB_8888) }
        if (instance == null) {
            Log.w(TAG, "loadRom: rejected (not a GBA ROM mGBA recognizes), ${rom.size} bytes")
        }
    }

    fun setButtonPressed(button: GbaButton, pressed: Boolean) {
        gba?.setButtonPressed(button, pressed)
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        running = true
        Choreographer.getInstance().postFrameCallback(frameCallback)
    }

    override fun onDetachedFromWindow() {
        running = false
        Choreographer.getInstance().removeFrameCallback(frameCallback)
        gba?.close()
        gba = null
        super.onDetachedFromWindow()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val bmp = bitmap ?: return
        val srcRect = Rect(0, 0, bmp.width, bmp.height)
        val destRect = Rect(0, 0, width, height)
        canvas.drawBitmap(bmp, srcRect, destRect, paint)
    }
}
