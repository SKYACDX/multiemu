package com.multiemu.gbacore

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Rect
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.media.ToneGenerator
import android.util.Log
import android.view.Choreographer
import android.view.View
import java.io.File

private const val TAG = "GbaView"

/**
 * GBA equivalent of gbcore's GameBoyView: owns one [GbaNative] instance,
 * drives it via [Choreographer], and paints the resulting framebuffer
 * scaled to fill the view with nearest-neighbor filtering. Also streams
 * mGBA's own audio synthesis to an AudioTrack -- gbcore's GameBoy has no
 * APU yet (see docs/roadmap.md), so this is GBA-only for now.
 */
class GbaView(context: Context) : View(context) {

    private var gba: GbaNative? = null
    private var bitmap: Bitmap? = null
    private var audioTrack: AudioTrack? = null
    private val audioBuffer = ShortArray(4096)
    private val paint = Paint().apply { isFilterBitmap = false }
    private var running = false

    // 1/2/3x. Audio is muted (but still drained, so mGBA's internal ring
    // buffer doesn't back up) above 1x -- playing it back would mean
    // either pitching it up or choppily dropping samples, and every
    // mainstream emulator just mutes during fast-forward instead.
    private var speedMultiplier = 1

    private val frameCallback = object : Choreographer.FrameCallback {
        override fun doFrame(frameTimeNanos: Long) {
            gba?.let { instance ->
                instance.runFrame(speedMultiplier)
                bitmap?.setPixels(instance.framebuffer, 0, instance.width, 0, 0, instance.width, instance.height)
                invalidate()

                val frames = instance.readAudioSamples(audioBuffer)
                if (frames > 0 && speedMultiplier == 1) {
                    audioTrack?.write(audioBuffer, 0, frames * 2, AudioTrack.WRITE_NON_BLOCKING)
                }
            }
            if (running) Choreographer.getInstance().postFrameCallback(this)
        }
    }

    fun setSpeedMultiplier(multiplier: Int) {
        speedMultiplier = multiplier.coerceIn(1, 3)
    }

    /** Full emulator state (not just cartridge save RAM) -- null if nothing's loaded or the save fails. */
    fun saveState(): ByteArray? = gba?.saveState()

    fun loadState(data: ByteArray): Boolean = gba?.loadState(data) ?: false

    /**
     * Replaces whatever ROM is currently loaded (if any) with [rom].
     * [romId] (a stable per-ROM key, e.g. its CRC32) is where mGBA reads
     * and writes this game's save data -- pass null to skip persistence.
     */
    fun loadRom(rom: ByteArray, romId: String?) {
        gba?.close()
        audioTrack?.stop()
        audioTrack?.release()
        audioTrack = null

        val savePath = romId?.let {
            File(File(context.filesDir, "saves").apply { mkdirs() }, "$it.sav").absolutePath
        }
        val instance = GbaNative.load(rom, savePath)
        gba = instance
        bitmap = instance?.let { Bitmap.createBitmap(it.width, it.height, Bitmap.Config.ARGB_8888) }
        if (instance == null) {
            Log.w(TAG, "loadRom: rejected (not a GBA ROM mGBA recognizes), ${rom.size} bytes")
            return
        }

        val minBufferSize = AudioTrack.getMinBufferSize(
            GbaNative.audioSampleRateHz,
            AudioFormat.CHANNEL_OUT_STEREO,
            AudioFormat.ENCODING_PCM_16BIT,
        )
        audioTrack = AudioTrack.Builder()
            .setAudioAttributes(
                // CONTENT_TYPE_SONIFICATION is for short UI feedback
                // sounds and can get treated very differently by the
                // audio HAL (ducked, routed to a notification-adjacent
                // stream, or effectively muted on some OEM skins) --
                // CONTENT_TYPE_MUSIC is what continuous game audio
                // actually needs to play reliably.
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_GAME)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build(),
            )
            .setAudioFormat(
                AudioFormat.Builder()
                    .setSampleRate(GbaNative.audioSampleRateHz)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_STEREO)
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .build(),
            )
            .setBufferSizeInBytes(minBufferSize * 2)
            .setTransferMode(AudioTrack.MODE_STREAM)
            .build()
        audioTrack?.setVolume(1f)
        audioTrack?.play()

        // TEMPORARY diagnostic: a short beep on the exact same stream
        // (STREAM_MUSIC) our AudioTrack uses, completely independent of
        // mGBA's sample pipeline. If this isn't audible either, the
        // device's media volume/output is the actual problem, not this
        // code -- see docs/roadmap.md or the conversation that added this
        // for context. Safe to delete once audio is confirmed working.
        try {
            val toneGen = ToneGenerator(AudioManager.STREAM_MUSIC, 100)
            toneGen.startTone(ToneGenerator.TONE_CDMA_PIP, 400)
            android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({ toneGen.release() }, 500)
        } catch (e: Exception) {
            Log.w(TAG, "diagnostic tone failed", e)
        }
    }

    fun setButtonPressed(button: GbaButton, pressed: Boolean) {
        gba?.setButtonPressed(button, pressed)
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        running = true
        Choreographer.getInstance().postFrameCallback(frameCallback)
        EmulatorControlModule.activeGba = this
    }

    override fun onDetachedFromWindow() {
        running = false
        Choreographer.getInstance().removeFrameCallback(frameCallback)
        gba?.close()
        gba = null
        audioTrack?.stop()
        audioTrack?.release()
        audioTrack = null
        if (EmulatorControlModule.activeGba === this) EmulatorControlModule.activeGba = null
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
