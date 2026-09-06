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
    private var audioFocusRequest: AudioFocusRequest? = null
    private val audioBuffer = ShortArray(4096)
    private val paint = Paint().apply { isFilterBitmap = false }
    private var running = false

    // 1/2/3x. Audio is muted (but still drained, so mGBA's internal ring
    // buffer doesn't back up) above 1x -- playing it back would mean
    // either pitching it up or choppily dropping samples, and every
    // mainstream emulator just mutes during fast-forward instead.
    private var speedMultiplier = 1

    // Set while the manual-save modal is open (see EmulatorControlModule /
    // App.tsx) so the game visibly freezes instead of continuing to run
    // (and generate audio/save-RAM writes) behind the picker.
    private var paused = false

    // TEMPORARY audio diagnostics, exposed via EmulatorControlModule so
    // App.tsx can show real numbers instead of guessing blind -- delete
    // once audio is confirmed working.
    var totalAudioFramesRead: Long = 0
        private set
    var lastAudioWriteResult: Int = Int.MIN_VALUE
        private set

    private val frameCallback = object : Choreographer.FrameCallback {
        override fun doFrame(frameTimeNanos: Long) {
            if (!paused) {
                gba?.let { instance ->
                    instance.runFrame(speedMultiplier)
                    bitmap?.setPixels(instance.framebuffer, 0, instance.width, 0, 0, instance.width, instance.height)
                    invalidate()

                    val frames = instance.readAudioSamples(audioBuffer)
                    if (frames > 0) {
                        totalAudioFramesRead += frames
                        if (speedMultiplier == 1) {
                            lastAudioWriteResult = audioTrack?.write(audioBuffer, 0, frames * 2, AudioTrack.WRITE_NON_BLOCKING) ?: Int.MIN_VALUE
                        }
                    }
                }
            }
            if (running) Choreographer.getInstance().postFrameCallback(this)
        }
    }

    fun setSpeedMultiplier(multiplier: Int) {
        speedMultiplier = multiplier.coerceIn(1, 3)
    }

    fun setPaused(value: Boolean) {
        paused = value
    }

    /** e.g. "frames=48213 lastWrite=1024 trackState=3" -- see the fields above. */
    fun getAudioDebugInfo(): String =
        "frames=$totalAudioFramesRead lastWrite=$lastAudioWriteResult trackState=${audioTrack?.state} playState=${audioTrack?.playState}"

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
        paused = false
        totalAudioFramesRead = 0
        lastAudioWriteResult = Int.MIN_VALUE

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

        val audioAttributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_GAME)
            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
            .build()

        val minBufferSize = AudioTrack.getMinBufferSize(
            GbaNative.audioSampleRateHz,
            AudioFormat.CHANNEL_OUT_STEREO,
            AudioFormat.ENCODING_PCM_16BIT,
        )
        audioTrack = AudioTrack.Builder()
            .setAudioAttributes(audioAttributes)
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

        // Diagnostics (a beep on the same track/attributes, plus a running
        // frame counter -- see getAudioDebugInfo) confirmed the AudioTrack
        // itself was healthy the whole time: initialized, playing, writes
        // succeeding. What was missing is this -- without ever requesting
        // audio focus, some OEM audio policies silently drop a game's
        // sound at the mixer even though the AudioTrack's own state looks
        // perfectly fine to the app. Request it right before play().
        abandonAudioFocus()
        val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
        if (audioManager != null) {
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

        audioTrack?.play()
    }

    private fun abandonAudioFocus() {
        val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            audioFocusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
            audioFocusRequest = null
        } else {
            @Suppress("DEPRECATION")
            audioManager.abandonAudioFocus(null)
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
        abandonAudioFocus()
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
