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
 * session and paints both players' framebuffers stacked top/bottom.
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

    companion object {
        /** Set on attach/cleared on detach -- lets EmulatorControlModule reach whichever GbaLinkView is on screen. */
        var activeGbaLink: GbaLinkView? = null
    }

    private var session: GbaLinkNative? = null
    private var bitmapA: Bitmap? = null
    private var bitmapB: Bitmap? = null
    private val paint = Paint().apply { isFilterBitmap = false }
    private var running = false

    // Visible even with no game content -- see onDraw.
    private val leftTintPaint = Paint().apply { color = android.graphics.Color.rgb(10, 12, 22) }
    private val rightTintPaint = Paint().apply { color = android.graphics.Color.rgb(22, 12, 12) }
    private val dividerPaint = Paint().apply { color = android.graphics.Color.rgb(90, 90, 100) }

    // TEMPORARY diagnostics -- local link is a brand-new, unverified
    // feature. See debugText() below, read from JS as selectable/
    // copyable text instead of a screenshot. Delete once confirmed working.
    private var loadFailed = false

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
        loadFailed = instance == null
    }

    fun setButtonPressed(player: Int, button: GbaButton, pressed: Boolean) {
        session?.setButtonPressed(player, button, pressed)
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        running = true
        activeGbaLink = this
        Choreographer.getInstance().postFrameCallback(frameCallback)
    }

    override fun onDetachedFromWindow() {
        running = false
        Choreographer.getInstance().removeFrameCallback(frameCallback)
        session?.close()
        session = null
        if (activeGbaLink === this) activeGbaLink = null
        super.onDetachedFromWindow()
    }

    /** TEMPORARY diagnostic, read from JS as selectable/copyable text instead of a screenshot -- see EmulatorControlModule.getLinkDebugInfo. */
    fun debugText(): String {
        val s = session ?: return if (loadFailed) "Sesión de link: no se pudo crear (¿ROMs de GBA válidas?)" else "Cargando…"
        return "A:${s.framesRun(0)} B:${s.framesRun(1)} ${s.debugState()}"
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val halfHeight = height / 2
        // Tinted halves + a divider so the top/bottom arrangement is
        // visible even while both sides are still rendering an actual
        // black GBA boot screen -- otherwise two black rectangles look
        // the same no matter how they're arranged.
        canvas.drawRect(0f, 0f, width.toFloat(), halfHeight.toFloat(), leftTintPaint)
        canvas.drawRect(0f, halfHeight.toFloat(), width.toFloat(), height.toFloat(), rightTintPaint)

        val a = bitmapA
        val b = bitmapB
        if (a != null && b != null) {
            val srcRect = Rect(0, 0, a.width, a.height)
            canvas.drawBitmap(a, srcRect, fitRect(a.width, a.height, width, halfHeight, 0), paint)
            canvas.drawBitmap(b, srcRect, fitRect(b.width, b.height, width, halfHeight, halfHeight), paint)
        }
        canvas.drawRect(0f, halfHeight - 1f, width.toFloat(), halfHeight + 1f, dividerPaint)
    }

    /**
     * Centers a srcW*srcH image, aspect-preserved, inside a boxW*boxH
     * row starting at [offsetY] -- top/bottom stacked, letterboxed
     * instead of stretched, so each (landscape-shaped) GBA screen keeps
     * its real proportions instead of being smeared across the full
     * (portrait) width.
     */
    private fun fitRect(srcW: Int, srcH: Int, boxW: Int, boxH: Int, offsetY: Int): Rect {
        val scale = minOf(boxW.toFloat() / srcW, boxH.toFloat() / srcH)
        val w = (srcW * scale).toInt()
        val h = (srcH * scale).toInt()
        val left = (boxW - w) / 2
        val top = offsetY + (boxH - h) / 2
        return Rect(left, top, left + w, top + h)
    }
}
