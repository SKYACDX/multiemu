package com.multiemu.n3dscore

import android.content.Context
import android.view.MotionEvent
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.widget.Toast
import java.io.File

/**
 * Shows the running 3DS game (see [N3dsSession], which owns it) and takes
 * touches for its bottom screen. The core draws straight onto this view's
 * surface, laid out like DsView's: stacked in portrait, side by side in
 * landscape (see ScreenRects in n3ds_jni.cpp).
 */
class N3dsView(context: Context) : SurfaceView(context), SurfaceHolder.Callback {

    /** Paused from JS (e.g. while a modal is open); the background pauses it too. */
    private var pausedByCaller = false
    private var inBackground = false

    init {
        keepScreenOn = true
        holder.addCallback(this)
        // The controls are React Native views laid over this one -- same
        // z-order arrangement as DsView, see the note there.
        setZOrderMediaOverlay(true)
    }

    fun loadRomPath(path: String) {
        val dataDir = File(context.filesDir, "3ds").absolutePath
        N3dsSession.load(path, { error -> post { Toast.makeText(context, error, Toast.LENGTH_LONG).show() } }, dataDir)
        updatePaused()
    }

    fun setPaused(paused: Boolean) {
        pausedByCaller = paused
        updatePaused()
    }

    fun setButtonPressed(button: N3dsButton, pressed: Boolean) = N3dsNative.nativeSetButton(button.retroId, pressed)

    private fun updatePaused() = N3dsSession.setPaused(pausedByCaller || inBackground)

    override fun onWindowVisibilityChanged(visibility: Int) {
        super.onWindowVisibilityChanged(visibility)
        inBackground = visibility != VISIBLE
        updatePaused()
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        val pressed = when (event.actionMasked) {
            MotionEvent.ACTION_DOWN, MotionEvent.ACTION_MOVE -> true
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> false
            else -> return true
        }
        N3dsNative.nativeTouch(event.x, event.y, width, height, pressed)
        return true
    }

    override fun surfaceCreated(holder: SurfaceHolder) =
        N3dsSession.attach(holder.surface, holder.surfaceFrame.width(), holder.surfaceFrame.height())

    override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) =
        N3dsSession.attach(holder.surface, width, height)

    override fun surfaceDestroyed(holder: SurfaceHolder) = N3dsSession.detach()
}

/** The 3DS buttons, with their libretro joypad ids. */
enum class N3dsButton(val retroId: Int) {
    B(0), Y(1), SELECT(2), START(3), UP(4), DOWN(5), LEFT(6), RIGHT(7),
    A(8), X(9), L(10), R(11), ZL(12), ZR(13),
}
