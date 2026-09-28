package com.multiemu.gbcore

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

private const val TAG = "GameBoyView"
private const val SCREEN_WIDTH = 160
private const val SCREEN_HEIGHT = 144

// How often to flush battery-backed cartridge RAM to disk while playing,
// in frames (~every 2s at 59.7fps) -- frequent enough that a crash or a
// killed app doesn't lose much progress, infrequent enough that it's not
// doing file I/O every frame.
private const val SAVE_INTERVAL_FRAMES = 120

/**
 * The actual game screen: owns one [GameBoyNative] instance, drives it at
 * the display's refresh rate via [Choreographer], and paints the
 * resulting framebuffer scaled to fill the view (nearest-neighbor, so
 * pixels stay crisp instead of blurring).
 *
 * All emulation state lives in the native GameBoy instance; this class is
 * just the Android-side render loop, touch-input entry point, and
 * battery-save persistence (for cartridges that have one -- see
 * cartridge.h's hasBattery()).
 */
class GameBoyView(context: Context) : View(context) {

    init {
        // Emulators are held like a game, not read like a page: without
        // this the screen dims and locks mid-play whenever the user goes a
        // while without touching the controls. Scoped to this view, so it
        // stops applying the moment it goes away.
        keepScreenOn = true
    }

    private var gameBoy: GameBoyNative? = null
    private var saveFile: File? = null
    private var framesSinceSave = 0
    private val bitmap = Bitmap.createBitmap(SCREEN_WIDTH, SCREEN_HEIGHT, Bitmap.Config.ARGB_8888)
    private val srcRect = Rect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT)
    private val paint = Paint().apply { isFilterBitmap = false }
    private var running = false
    private var speedMultiplier = 1

    private var audioTrack: AudioTrack? = null
    private var audioFocusRequest: AudioFocusRequest? = null
    // The APU queues up to 4096 stereo frames; draining once per frame
    // takes ~800, or ~2400 at 3x, so this never has to leave any behind.
    private val audioBuffer = ShortArray(4096 * 2)

    private val frameCallback = object : Choreographer.FrameCallback {
        override fun doFrame(frameTimeNanos: Long) {
            gameBoy?.let {
                it.runFrame(speedMultiplier)
                bitmap.setPixels(it.framebuffer, 0, SCREEN_WIDTH, 0, 0, SCREEN_WIDTH, SCREEN_HEIGHT)
                invalidate()

                // Always drain, so the APU's queue never fills and starts
                // dropping; only play it at 1x. Fast-forwarded audio would
                // have to be pitched up or chopped, and every mainstream
                // emulator mutes it instead (GbaView does the same).
                val frames = it.readAudioSamples(audioBuffer)
                if (frames > 0 && speedMultiplier == 1) {
                    audioTrack?.write(audioBuffer, 0, frames * 2, AudioTrack.WRITE_NON_BLOCKING)
                }

                if (it.hasBattery && ++framesSinceSave >= SAVE_INTERVAL_FRAMES) {
                    framesSinceSave = 0
                    writeSaveFile()
                }
            }
            if (running) Choreographer.getInstance().postFrameCallback(this)
        }
    }

    fun setSpeedMultiplier(multiplier: Int) {
        speedMultiplier = multiplier.coerceIn(1, 3)
    }

    /**
     * Replaces whatever ROM is currently loaded (if any) with [rom].
     * [romId] identifies the save file (a stable per-ROM key, e.g. its
     * CRC32) -- pass null to skip save persistence entirely (used for the
     * built-in test ROM, which has no battery RAM anyway).
     */
    fun loadRom(rom: ByteArray, romId: String?) {
        writeSaveFile()
        gameBoy?.close()
        releaseAudio()
        framesSinceSave = 0

        val instance = GameBoyNative.load(rom)
        gameBoy = instance
        if (instance == null) {
            Log.w(TAG, "loadRom: rejected (bad header or unsupported mapper), ${rom.size} bytes")
            saveFile = null
            return
        }

        saveFile = romId?.let { File(File(context.filesDir, "saves").apply { mkdirs() }, "$it.sav") }
        val file = saveFile
        if (instance.hasBattery && file != null && file.exists()) {
            try {
                instance.loadSaveData(file.readBytes())
            } catch (e: Exception) {
                Log.w(TAG, "loadRom: failed to read save file $file", e)
            }
        }
        startAudio()
    }

    private fun startAudio() {
        val attributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_GAME)
            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
            .build()
        val rate = GameBoyNative.audioSampleRateHz
        val minBufferSize = AudioTrack.getMinBufferSize(rate, AudioFormat.CHANNEL_OUT_STEREO, AudioFormat.ENCODING_PCM_16BIT)
        audioTrack = AudioTrack.Builder()
            .setAudioAttributes(attributes)
            .setAudioFormat(
                AudioFormat.Builder()
                    .setSampleRate(rate)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_STEREO)
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .build(),
            )
            .setBufferSizeInBytes(minBufferSize * 2)
            .setTransferMode(AudioTrack.MODE_STREAM)
            .build()

        // Without audio focus some OEM audio policies drop a game's sound
        // at the mixer even though the AudioTrack itself reports playing --
        // found the hard way on GBA (see GbaView).
        val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
        if (audioManager != null) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                    .setAudioAttributes(attributes)
                    .setWillPauseWhenDucked(false)
                    .build()
                audioFocusRequest = request
                audioManager.requestAudioFocus(request)
            } else {
                @Suppress("DEPRECATION")
                audioManager.requestAudioFocus(null, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN)
            }
        }
        if (windowVisibility == VISIBLE) audioTrack?.play()
    }

    private fun releaseAudio() {
        audioTrack?.stop()
        audioTrack?.release()
        audioTrack = null
        val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            audioFocusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
            audioFocusRequest = null
        } else {
            @Suppress("DEPRECATION")
            audioManager.abandonAudioFocus(null)
        }
    }

    // Choreographer stops delivering frames to an invisible window, so the
    // emulation already pauses in the background on its own -- but an
    // AudioTrack left playing would still run out its buffer and then sit
    // underrunning. Pause it with the window, resume it with the window.
    override fun onWindowVisibilityChanged(visibility: Int) {
        super.onWindowVisibilityChanged(visibility)
        if (visibility == VISIBLE) audioTrack?.play() else audioTrack?.pause()
    }

    private fun writeSaveFile() {
        val instance = gameBoy ?: return
        val file = saveFile ?: return
        if (!instance.hasBattery) return
        try {
            file.writeBytes(instance.getSaveData())
        } catch (e: Exception) {
            Log.w(TAG, "writeSaveFile: failed to write $file", e)
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
        writeSaveFile()
        gameBoy?.close()
        gameBoy = null
        releaseAudio()
        super.onDetachedFromWindow()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val destRect = Rect(0, 0, width, height)
        canvas.drawBitmap(bitmap, srcRect, destRect, paint)
    }
}
