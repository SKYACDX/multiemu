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

    // TEMPORARY diagnostics -- local link is a brand-new, unverified
    // feature and a black screen with no error was reported with no way
    // to tell "session never even got created" apart from "it's running
    // but stuck/deadlocked". Delete once it's confirmed working.
    private var loadAttempted = false
    private var loadFailed = false
    private val debugPaint = Paint().apply { color = android.graphics.Color.RED; textSize = 32f; isAntiAlias = true }

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
        loadAttempted = true
        loadFailed = instance == null
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
        val a = bitmapA
        val b = bitmapB
        if (a == null || b == null) {
            if (loadFailed) {
                canvas.drawText("No se pudo crear la sesión de link.", 24f, height / 2f - 20f, debugPaint)
                canvas.drawText("¿Son ambos archivos ROMs de GBA válidas?", 24f, height / 2f + 20f, debugPaint)
            } else if (loadAttempted) {
                canvas.drawText("Cargando…", 24f, height / 2f, debugPaint)
            }
            return
        }
        val srcRect = Rect(0, 0, a.width, a.height)
        val halfWidth = width / 2
        canvas.drawBitmap(a, srcRect, fitRect(a.width, a.height, halfWidth, height, 0), paint)
        canvas.drawBitmap(b, srcRect, fitRect(b.width, b.height, halfWidth, height, halfWidth), paint)

        // TEMPORARY diagnostic -- see the field comments above.
        session?.let { s ->
            canvas.drawText("A:${s.framesRun(0)} B:${s.framesRun(1)}", 16f, 40f, debugPaint)
        }
    }

    /**
     * Centers a srcW*srcH image, aspect-preserved, inside a boxW*boxH
     * column starting at [offsetX] -- side-by-side instead of the
     * original top/bottom stack, which stretched each (landscape-shaped)
     * GBA screen across the full (portrait) width and squashed it
     * vertically. Letterboxing here instead looks like two actual GBA
     * screens rather than two smeared strips.
     */
    private fun fitRect(srcW: Int, srcH: Int, boxW: Int, boxH: Int, offsetX: Int): Rect {
        val scale = minOf(boxW.toFloat() / srcW, boxH.toFloat() / srcH)
        val w = (srcW * scale).toInt()
        val h = (srcH * scale).toInt()
        val left = offsetX + (boxW - w) / 2
        val top = (boxH - h) / 2
        return Rect(left, top, left + w, top + h)
    }
}
