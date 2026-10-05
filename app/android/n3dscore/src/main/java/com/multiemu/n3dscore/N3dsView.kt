package com.multiemu.n3dscore

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Handler
import android.os.HandlerThread
import android.os.Process
import android.os.SystemClock
import android.util.Log
import android.view.SurfaceHolder
import android.view.SurfaceView
import java.io.File

/**
 * Runs one 3DS game and shows it. Same shape as DsView: a self-paced loop
 * on its own thread (a 3DS frame can easily cost more than a vsync), and
 * the core draws straight onto this view's surface through EGL. Every
 * native call goes through [emu], the thread the EGL context belongs to.
 */
class N3dsView(context: Context) : SurfaceView(context), SurfaceHolder.Callback {

    var onError: ((String) -> Unit)? = null

    private val thread = HandlerThread("n3ds-emu", Process.THREAD_PRIORITY_DISPLAY).apply { start() }
    private val emu = Handler(thread.looper)
    private var started = false
    @Volatile private var running = false
    private var audioTrack: AudioTrack? = null
    private val audioBuffer = ShortArray(8192)
    private var frameIntervalNanos = 1_000_000_000L / 60
    private var nextFrameNanos = 0L

    // Frames per second actually emulated, logged every second -- phase 1
    // is about measuring whether this hardware can run a 3DS at all.
    private var fpsWindowStart = 0L
    private var fpsFrames = 0

    init {
        keepScreenOn = true
        holder.addCallback(this)
    }

    fun start(romPath: String) {
        emu.post {
            if (started) return@post
            val dataDir = File(context.filesDir, "3ds").absolutePath
            val loadStart = SystemClock.elapsedRealtime()
            val error = N3dsNative.nativeStart(romPath, dataDir)
            Log.i(TAG, "start took ${SystemClock.elapsedRealtime() - loadStart} ms, error=$error")
            if (error != null) {
                post { onError?.invoke(error) }
                return@post
            }
            started = true
            frameIntervalNanos = (1_000_000_000.0 / N3dsNative.nativeFps().coerceIn(30.0, 120.0)).toLong()
            if (holder.surface?.isValid == true) N3dsNative.nativeSetSurface(holder.surface)
            startAudio(N3dsNative.nativeSampleRate())
            running = true
            nextFrameNanos = System.nanoTime()
            fpsWindowStart = nextFrameNanos
            emu.post(frame)
        }
    }

    fun stop() {
        running = false
        emu.post {
            audioTrack?.run { stop(); release() }
            audioTrack = null
            if (started) N3dsNative.nativeStop()
            started = false
        }
        thread.quitSafely()
    }

    private val frame = object : Runnable {
        override fun run() {
            if (!running) return
            N3dsNative.nativeRunFrame()
            val frames = N3dsNative.nativeReadAudio(audioBuffer)
            if (frames > 0) audioTrack?.write(audioBuffer, 0, frames * 2, AudioTrack.WRITE_NON_BLOCKING)

            val now = System.nanoTime()
            fpsFrames++
            if (now - fpsWindowStart >= 1_000_000_000L) {
                Log.i(TAG, "fps %.1f".format(fpsFrames * 1e9 / (now - fpsWindowStart)))
                fpsFrames = 0
                fpsWindowStart = now
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

    private fun startAudio(sampleRate: Int) {
        if (sampleRate <= 0) return
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
            .apply { play() }
    }

    override fun surfaceCreated(holder: SurfaceHolder) {
        emu.post { if (started) N3dsNative.nativeSetSurface(holder.surface) }
    }

    override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {}

    override fun surfaceDestroyed(holder: SurfaceHolder) {
        // Must finish before the surface goes: wait for the emu thread.
        val done = java.util.concurrent.CountDownLatch(1)
        emu.post {
            if (started) N3dsNative.nativeSetSurface(null)
            done.countDown()
        }
        done.await(2, java.util.concurrent.TimeUnit.SECONDS)
    }

    companion object {
        private const val TAG = "n3ds"
    }
}
