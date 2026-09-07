package com.multiemu.dscore

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
import android.view.MotionEvent
import android.view.View
import java.io.File

/**
 * NDS equivalent of GbaView: owns one [DsNative] instance, drives it via
 * [Choreographer], and paints both screens stacked top (game) / bottom
 * (touch), each letterboxed to its native 256x192 aspect ratio -- same
 * split as GbaLinkView's top/bottom halves, just one console instead of
 * two. The bottom half doubles as the touch screen: this view handles
 * touch input itself (mapping view pixels to the emulated 256x192
 * touch-screen space) rather than routing it through JS, since the
 * exact scaled rect is already computed here for drawing.
 */
class DsView(context: Context) : View(context) {

    private var ds: DsNative? = null
    private var topBitmap: Bitmap? = null
    private var bottomBitmap: Bitmap? = null
    private var audioTrack: AudioTrack? = null
    private var audioFocusRequest: AudioFocusRequest? = null
    private val audioBuffer = ShortArray(4096)
    private val paint = Paint().apply { isFilterBitmap = false }
    private var running = false
    // Used while the manual-save modal reads the cartridge save file --
    // see GbaView's identical pausedByModal, same reasoning: reading the
    // .sav while melonDS could be writing through to it risks catching a
    // torn write.
    private var pausedByModal = false

    private val audioAttributes = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_GAME)
        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
        .build()

    private val frameCallback = object : Choreographer.FrameCallback {
        override fun doFrame(frameTimeNanos: Long) {
            if (!pausedByModal) ds?.let { instance ->
                instance.runFrame()
                instance.readFramebuffers()
                topBitmap?.setPixels(instance.topFramebuffer, 0, DsNative.width, 0, 0, DsNative.width, DsNative.height)
                bottomBitmap?.setPixels(instance.bottomFramebuffer, 0, DsNative.width, 0, 0, DsNative.width, DsNative.height)
                invalidate()

                val frames = instance.readAudioSamples(audioBuffer)
                if (frames > 0) {
                    audioTrack?.write(audioBuffer, 0, frames * 2, AudioTrack.WRITE_NON_BLOCKING)
                }
            }
            if (running) Choreographer.getInstance().postFrameCallback(this)
        }
    }

    private fun buildAudioTrack(): AudioTrack {
        val minBufferSize = AudioTrack.getMinBufferSize(
            DsNative.audioSampleRateHz,
            AudioFormat.CHANNEL_OUT_STEREO,
            AudioFormat.ENCODING_PCM_16BIT,
        )
        return AudioTrack.Builder()
            .setAudioAttributes(audioAttributes)
            .setAudioFormat(
                AudioFormat.Builder()
                    .setSampleRate(DsNative.audioSampleRateHz)
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
        audioTrack?.stop()
        audioTrack?.release()
        audioTrack = null
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

    private fun savePathFor(romId: String?): String? =
        romId?.let { File(File(context.filesDir, "saves").apply { mkdirs() }, "$it.sav").absolutePath }

    private fun afterLoad(instance: DsNative?) {
        ds = instance
        if (instance == null) return
        topBitmap = Bitmap.createBitmap(DsNative.width, DsNative.height, Bitmap.Config.ARGB_8888)
        bottomBitmap = Bitmap.createBitmap(DsNative.width, DsNative.height, Bitmap.Config.ARGB_8888)

        audioTrack = buildAudioTrack()
        requestAudioFocus()
        audioTrack?.play()
    }

    /** romId (e.g. the ROM's CRC32) keys its save file -- pass null to skip persistence. Only for small (e.g. homebrew) ROMs -- see loadRomFromPath. */
    fun loadRom(rom: ByteArray, romId: String?) {
        ds?.close()
        stopAudio()
        afterLoad(DsNative.load(rom, savePathFor(romId)))
    }

    /** Reads the ROM straight off disk -- see DsNative.loadFromPath. This is the path a real (128-512MB) NDS ROM should take. */
    fun loadRomFromPath(romPath: String, romId: String?) {
        ds?.close()
        stopAudio()
        afterLoad(DsNative.loadFromPath(romPath, savePathFor(romId)))
    }

    fun setButtonPressed(button: DsButton, pressed: Boolean) {
        ds?.setButtonPressed(button, pressed)
    }

    fun setPaused(value: Boolean) {
        pausedByModal = value
    }

    /** Full emulator state (not just cartridge save RAM) -- null if nothing's loaded or the save fails. */
    fun saveState(): ByteArray? = ds?.saveState()

    fun loadState(data: ByteArray): Boolean = ds?.loadState(data) ?: false

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        running = true
        Choreographer.getInstance().postFrameCallback(frameCallback)
        DsEmulatorControlModule.activeDs = this
    }

    override fun onDetachedFromWindow() {
        running = false
        Choreographer.getInstance().removeFrameCallback(frameCallback)
        ds?.close()
        ds = null
        stopAudio()
        if (DsEmulatorControlModule.activeDs === this) DsEmulatorControlModule.activeDs = null
        super.onDetachedFromWindow()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val halfHeight = height / 2
        val top = topBitmap
        val bottom = bottomBitmap
        if (top != null && bottom != null) {
            val srcRect = Rect(0, 0, top.width, top.height)
            canvas.drawBitmap(top, srcRect, fitRect(top.width, top.height, width, halfHeight, 0), paint)
            canvas.drawBitmap(bottom, srcRect, fitRect(bottom.width, bottom.height, width, halfHeight, halfHeight), paint)
        }
    }

    /** Centers a srcW*srcH image, aspect-preserved, inside a boxW*boxH row starting at [offsetY] -- see GbaLinkView's identical helper. */
    private fun fitRect(srcW: Int, srcH: Int, boxW: Int, boxH: Int, offsetY: Int): Rect {
        val scale = minOf(boxW.toFloat() / srcW, boxH.toFloat() / srcH)
        val w = (srcW * scale).toInt()
        val h = (srcH * scale).toInt()
        val left = (boxW - w) / 2
        val top = offsetY + (boxH - h) / 2
        return Rect(left, top, left + w, top + h)
    }

    /**
     * The bottom half is the touch screen -- map a touch in view space to
     * the emulated 256x192 touch-screen space using the same fitRect the
     * bottom screen was just drawn with, clamping to its bounds so a
     * finger that strays into the letterbox bars still registers at the
     * nearest edge instead of being dropped.
     */
    override fun onTouchEvent(event: MotionEvent): Boolean {
        val instance = ds ?: return false
        val halfHeight = height / 2
        val rect = fitRect(DsNative.width, DsNative.height, width, halfHeight, halfHeight)
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN, MotionEvent.ACTION_MOVE -> {
                if (event.y < rect.top - 24) {
                    // Well above the touch screen (e.g. a stray touch that
                    // slid up onto the top/game half) -- don't drag a
                    // phantom touch-point onto the DS screen from there.
                    return false
                }
                val clampedX = event.x.coerceIn(rect.left.toFloat(), rect.right.toFloat() - 1)
                val clampedY = event.y.coerceIn(rect.top.toFloat(), rect.bottom.toFloat() - 1)
                val dsX = ((clampedX - rect.left) / rect.width() * DsNative.width).toInt().coerceIn(0, DsNative.width - 1)
                val dsY = ((clampedY - rect.top) / rect.height() * DsNative.height).toInt().coerceIn(0, DsNative.height - 1)
                instance.touchScreen(dsX, dsY)
                return true
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                instance.releaseScreen()
                return true
            }
        }
        return false
    }
}
