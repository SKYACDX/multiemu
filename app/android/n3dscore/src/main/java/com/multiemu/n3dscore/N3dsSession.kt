package com.multiemu.n3dscore

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.media.PlaybackParams
import android.os.Handler
import android.os.HandlerThread
import android.os.Process
import android.os.SystemClock
import android.util.Log
import android.view.Surface
import kotlin.math.abs

/**
 * The running 3DS game: the emulation thread, its frame loop and its sound.
 * Process-level rather than per view, like DsView's shared session: React
 * Native remounts the view on every rotation, and a game tied to the view
 * restarted each time. A view only lends its surface ([attach]) and the
 * game keeps going underneath.
 *
 * Every native call happens on [emu], the thread the EGL context is
 * current on (see n3ds_jni.cpp).
 */
object N3dsSession {
    private const val TAG = "n3ds"

    private val thread = HandlerThread("n3ds-emu", Process.THREAD_PRIORITY_DISPLAY).apply { start() }
    private val emu = Handler(thread.looper)

    private var romPath: String? = null
    private var surface: Surface? = null
    @Volatile private var paused = false
    private var looping = false

    private var audioTrack: AudioTrack? = null
    private val audioBuffer = ShortArray(8192)
    private var sampleRateHz = 0
    private var audioSpeed = 1.0

    private var frameIntervalNanos = 1_000_000_000L / 60
    private var nextFrameNanos = 0L
    // Logged every second: frames emulated, and how fast the sound plays.
    private var windowStart = 0L
    private var windowFrames = 0
    private var windowAudioFrames = 0

    /** Starts [path], or keeps it running if it already is. onError gets a message for the user. */
    fun load(path: String, onError: (String) -> Unit, dataDir: String) {
        emu.post {
            if (romPath == path) return@post
            if (romPath != null) stopNow()
            val start = SystemClock.elapsedRealtime()
            val error = N3dsNative.nativeStart(path, dataDir)
            Log.i(TAG, "start took ${SystemClock.elapsedRealtime() - start} ms, error=$error")
            if (error != null) {
                onError(error)
                return@post
            }
            romPath = path
            frameIntervalNanos = (1_000_000_000.0 / N3dsNative.nativeFps().coerceIn(30.0, 120.0)).toLong()
            surface?.let { N3dsNative.nativeSetSurface(it) }
            startAudio(N3dsNative.nativeSampleRate())
            ensureLooping()
        }
    }

    /** The view's surface is ready (or changed). */
    fun attach(newSurface: Surface) {
        emu.post {
            surface = newSurface
            if (romPath != null) N3dsNative.nativeSetSurface(newSurface)
        }
    }

    /** The view's surface is going away: returns once the core has let go of it. */
    fun detach() {
        val done = java.util.concurrent.CountDownLatch(1)
        emu.post {
            surface = null
            if (romPath != null) N3dsNative.nativeSetSurface(null)
            done.countDown()
        }
        done.await(2, java.util.concurrent.TimeUnit.SECONDS)
    }

    /** Paused while the app is in the background or a modal is open. */
    fun setPaused(value: Boolean) {
        paused = value
        emu.post {
            if (value) audioTrack?.pause() else audioTrack?.play()
            if (!value) ensureLooping()
        }
    }

    fun stop() = emu.post { stopNow() }

    private fun stopNow() {
        audioTrack?.run { stop(); release() }
        audioTrack = null
        if (romPath != null) N3dsNative.nativeStop()
        romPath = null
    }

    private fun ensureLooping() {
        if (looping) return
        looping = true
        nextFrameNanos = System.nanoTime()
        windowStart = nextFrameNanos
        emu.post(frame)
    }

    private val frame = object : Runnable {
        override fun run() {
            // No game or paused: stop scheduling; setPaused/load restart it.
            if (romPath == null || paused) {
                looping = false
                return
            }
            N3dsNative.nativeRunFrame()
            val audioFrames = N3dsNative.nativeReadAudio(audioBuffer)
            if (audioFrames > 0) audioTrack?.write(audioBuffer, 0, audioFrames * 2, AudioTrack.WRITE_NON_BLOCKING)

            val now = System.nanoTime()
            windowFrames++
            windowAudioFrames += audioFrames
            if (now - windowStart >= 1_000_000_000L) {
                val seconds = (now - windowStart) / 1e9
                matchAudioSpeed(windowAudioFrames / seconds)
                Log.i(TAG, "fps %.1f, audio x%.2f".format(windowFrames / seconds, audioSpeed))
                windowFrames = 0
                windowAudioFrames = 0
                windowStart = now
            }
            // Behind (the usual case on slow phones): re-anchor rather than
            // bursting through catch-up frames later.
            nextFrameNanos += frameIntervalNanos
            if (nextFrameNanos < now) {
                nextFrameNanos = now
                emu.post(this)
            } else {
                emu.postDelayed(this, (nextFrameNanos - now) / 1_000_000L)
            }
        }
    }

    /**
     * A phone that can't keep a 3DS at full speed also makes its sound
     * slower than real time, and a track played at full rate then runs dry
     * over and over -- constant crackling. Instead, play it as fast as it
     * actually arrives: PlaybackParams time-stretches without changing the
     * pitch, so a game at 75% sounds slowed down, not broken.
     */
    private fun matchAudioSpeed(producedPerSecond: Double) {
        val track = audioTrack ?: return
        if (sampleRateHz <= 0 || producedPerSecond <= 0) return
        val measured = (producedPerSecond / sampleRateHz).coerceIn(0.5, 1.0)
        val smoothed = audioSpeed * 0.5 + measured * 0.5
        // Small wobbles aren't worth a resampler reconfiguration each second.
        if (abs(smoothed - audioSpeed) < 0.03) return
        audioSpeed = smoothed
        runCatching { track.playbackParams = PlaybackParams().setSpeed(audioSpeed.toFloat()).setPitch(1f) }
    }

    private fun startAudio(sampleRate: Int) {
        if (sampleRate <= 0) return
        sampleRateHz = sampleRate
        audioSpeed = 1.0
        val minBuffer = AudioTrack.getMinBufferSize(sampleRate, AudioFormat.CHANNEL_OUT_STEREO, AudioFormat.ENCODING_PCM_16BIT)
        audioTrack = AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_GAME)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build(),
            )
            .setAudioFormat(
                AudioFormat.Builder()
                    .setSampleRate(sampleRate)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_STEREO)
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .build(),
            )
            .setBufferSizeInBytes(minBuffer * 2)
            .setTransferMode(AudioTrack.MODE_STREAM)
            .build()
            .apply { if (!paused) play() }
    }
}
