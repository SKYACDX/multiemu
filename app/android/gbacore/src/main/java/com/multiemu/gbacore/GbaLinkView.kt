package com.multiemu.gbacore

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Rect
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.os.Build
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
 * repaints, same cadence as the single-player view. Audio works the same
 * way: each side's own AudioTrack is drained from this same callback,
 * same pattern as GbaView, just doubled.
 */
class GbaLinkView(context: Context) : View(context) {

    private var session: GbaLinkNative? = null
    private var bitmapA: Bitmap? = null
    private var bitmapB: Bitmap? = null
    private var audioTrackA: AudioTrack? = null
    private var audioTrackB: AudioTrack? = null
    private var audioFocusRequest: AudioFocusRequest? = null
    private val audioBufferA = ShortArray(4096)
    private val audioBufferB = ShortArray(4096)
    private val paint = Paint().apply { isFilterBitmap = false }
    private var running = false

    // Visible even with no game content -- see onDraw.
    private val leftTintPaint = Paint().apply { color = android.graphics.Color.rgb(10, 12, 22) }
    private val rightTintPaint = Paint().apply { color = android.graphics.Color.rgb(22, 12, 12) }
    private val dividerPaint = Paint().apply { color = android.graphics.Color.rgb(90, 90, 100) }

    private val frameCallback = object : Choreographer.FrameCallback {
        override fun doFrame(frameTimeNanos: Long) {
            session?.let { s ->
                s.readFramebuffer(0)
                s.readFramebuffer(1)
                bitmapA?.setPixels(s.framebufferA, 0, s.width, 0, 0, s.width, s.height)
                bitmapB?.setPixels(s.framebufferB, 0, s.width, 0, 0, s.width, s.height)
                invalidate()

                val framesA = s.readAudioSamples(0, audioBufferA)
                if (framesA > 0) audioTrackA?.write(audioBufferA, 0, framesA * 2, AudioTrack.WRITE_NON_BLOCKING)
                val framesB = s.readAudioSamples(1, audioBufferB)
                if (framesB > 0) audioTrackB?.write(audioBufferB, 0, framesB * 2, AudioTrack.WRITE_NON_BLOCKING)
            }
            if (running) Choreographer.getInstance().postFrameCallback(this)
        }
    }

    private val audioAttributes = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_GAME)
        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
        .build()

    private fun buildAudioTrack(): AudioTrack {
        val minBufferSize = AudioTrack.getMinBufferSize(
            GbaLinkNative.audioSampleRateHz,
            AudioFormat.CHANNEL_OUT_STEREO,
            AudioFormat.ENCODING_PCM_16BIT,
        )
        return AudioTrack.Builder()
            .setAudioAttributes(audioAttributes)
            .setAudioFormat(
                AudioFormat.Builder()
                    .setSampleRate(GbaLinkNative.audioSampleRateHz)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_STEREO)
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .build(),
            )
            .setBufferSizeInBytes(minBufferSize * 2)
            .setTransferMode(AudioTrack.MODE_STREAM)
            .build()
    }

    private fun requestAudioFocus() {
        val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(audioAttributes)
                .setWillPauseWhenDucked(false)
                .build()
            audioFocusRequest = request
            audioManager.requestAudioFocus(request)
        } else {
            @Suppress("DEPRECATION")
            audioManager.requestAudioFocus(null, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN)
        }
    }

    private fun stopAudio() {
        audioTrackA?.stop()
        audioTrackA?.release()
        audioTrackA = null
        audioTrackB?.stop()
        audioTrackB?.release()
        audioTrackB = null
        val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
        if (audioManager != null) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                audioFocusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
                audioFocusRequest = null
            } else {
                @Suppress("DEPRECATION")
                audioManager.abandonAudioFocus(null)
            }
        }
    }

    /** romIdA/romIdB (e.g. each ROM's CRC32) key their save files -- pass null to skip persistence. */
    fun loadRoms(romA: ByteArray, romIdA: String?, romB: ByteArray, romIdB: String?) {
        session?.close()
        stopAudio()

        val savesDir = File(context.filesDir, "saves").apply { mkdirs() }
        val savePathA = romIdA?.let { File(savesDir, "$it.sav").absolutePath }
        val savePathB = romIdB?.let { File(savesDir, "$it.sav").absolutePath }

        val instance = GbaLinkNative.create(romA, savePathA, romB, savePathB)
        session = instance
        if (instance == null) return
        bitmapA = Bitmap.createBitmap(instance.width, instance.height, Bitmap.Config.ARGB_8888)
        bitmapB = Bitmap.createBitmap(instance.width, instance.height, Bitmap.Config.ARGB_8888)

        audioTrackA = buildAudioTrack()
        audioTrackB = buildAudioTrack()
        requestAudioFocus()
        audioTrackA?.play()
        audioTrackB?.play()
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
        stopAudio()
        super.onDetachedFromWindow()
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
