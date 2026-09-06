package com.multiemu.gbacore

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Rect
import android.view.Choreographer
import android.view.View
import java.io.File

/**
 * Local (same-device) 2-player GBA link: hosts one [GbaLinkNative]
 * session and paints both players' framebuffers stacked vertically.
 *
 * Unlike [GbaView], this does NOT call runFrame() from the Choreographer
 * callback -- LinkedGbaSession (native) already drives each side on its
 * own background thread, since the link protocol can block a side for a
 * real, unpredictable duration mid-frame (see gba_link.h). This view's
 * frame callback just re-reads whatever frame is currently ready and
 * repaints, same cadence as the single-player view.
 *
 * No audio yet -- two simultaneous AudioTracks/mixing is a separate
 * problem, deferred until the link protocol itself is confirmed working.
 */
class GbaLinkView(context: Context) : View(context) {

    private var session: GbaLinkNative? = null
    private var bitmapA: Bitmap? = null
    private var bitmapB: Bitmap? = null
    private val paint = Paint().apply { isFilterBitmap = false }
    private var running = false

    private val frameCallback = object : Choreographer.FrameCallback {
        override fun doFrame(frameTimeNanos: Long) {
            session?.let { s ->
                s.readFramebuffer(0)
                s.readFramebuffer(1)
                bitmapA?.setPixels(s.framebufferA, 0, s.width, 0, 0, s.width, s.height)
                bitmapB?.setPixels(s.framebufferB, 0, s.width, 0, 0, s.width, s.height)
                invalidate()
            }
            if (running) Choreographer.getInstance().postFrameCallback(this)
        }
    }

    /** romIdA/romIdB (e.g. each ROM's CRC32) key their save files -- pass null to skip persistence. */
    fun loadRoms(romA: ByteArray, romIdA: String?, romB: ByteArray, romIdB: String?) {
        session?.close()

        val savesDir = File(context.filesDir, "saves").apply { mkdirs() }
        val savePathA = romIdA?.let { File(savesDir, "$it.sav").absolutePath }
        val savePathB = romIdB?.let { File(savesDir, "$it.sav").absolutePath }

        val instance = GbaLinkNative.create(romA, savePathA, romB, savePathB)
        session = instance
        bitmapA = instance?.let { Bitmap.createBitmap(it.width, it.height, Bitmap.Config.ARGB_8888) }
        bitmapB = instance?.let { Bitmap.createBitmap(it.width, it.height, Bitmap.Config.ARGB_8888) }
    }

    fun setButtonPressed(player: Int, button: GbaButton, pressed: Boolean) {
        session?.setButtonPressed(player, button, pressed)
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        running = true
        Choreographer.getInstance().postFrameCallback(frameCallback)
    }

    override fun onDetachedFromWindow() {
        running = false
        Choreographer.getInstance().removeFrameCallback(frameCallback)
        session?.close()
        session = null
        super.onDetachedFromWindow()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val a = bitmapA ?: return
        val b = bitmapB ?: return
        val srcRect = Rect(0, 0, a.width, a.height)
        val half = height / 2
        canvas.drawBitmap(a, srcRect, Rect(0, 0, width, half), paint)
        canvas.drawBitmap(b, srcRect, Rect(0, half, width, height), paint)
    }
}
