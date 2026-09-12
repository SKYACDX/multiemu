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
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.Process
import android.view.MotionEvent
import android.view.SurfaceHolder
import android.view.SurfaceView
import java.io.File

/**
 * NDS equivalent of GbaView: owns one [DsNative] instance, drives it from
 * a self-paced loop on its own thread (see frameRunnable -- deliberately
 * not vsync/Choreographer-driven, unlike GbaView, because a single NDS
 * frame can cost more than one vsync interval), and paints both screens
 * stacked top (game) / bottom
 * (touch), each letterboxed to its native 256x192 aspect ratio -- same
 * split as GbaLinkView's top/bottom halves, just one console instead of
 * two. The bottom half doubles as the touch screen: this view handles
 * touch input itself (mapping view pixels to the emulated 256x192
 * touch-screen space) rather than routing it through JS, since the
 * exact scaled rect is already computed here for drawing.
 */
class DsView(context: Context) : SurfaceView(context), SurfaceHolder.Callback {

    // Surface dimensions, written from the surface callbacks (UI thread)
    // and read by the emu thread each frame -- volatile so the emu thread
    // isn't reading a stale or half-updated pair.
    @Volatile private var surfaceWidth = 0
    @Volatile private var surfaceHeight = 0
    @Volatile private var hasSurface = false

    // Cleared for this session the first time presentFrame reports it
    // can't draw (no GL compositor -- i.e. the GL renderer failed to come
    // up and melonDS is on its software renderer), which switches the
    // display over to the Canvas fallback below for good. The two can't
    // share a Surface: EGL owns it, or lockCanvas does.
    @Volatile private var useGlPresent = true

    @Volatile private var ds: DsNative? = null

    companion object {
        // The emulated console, kept at process level rather than per
        // view -- see adoptOrLoad for why. Only ever touched under
        // dsLock, and only from the emu thread.
        private var sharedDs: DsNative? = null
        private var sharedKey: String? = null
    }
    private var topBitmap: Bitmap? = null
    private var bottomBitmap: Bitmap? = null
    private var audioTrack: AudioTrack? = null
    private var audioFocusRequest: AudioFocusRequest? = null
    private val audioBuffer = ShortArray(4096)
    private val paint = Paint().apply { isFilterBitmap = false }
    @Volatile private var running = false
    // Used while the manual-save modal reads the cartridge save file --
    // see GbaView's identical pausedByModal, same reasoning: reading the
    // .sav while melonDS could be writing through to it risks catching a
    // torn write.
    @Volatile private var pausedByModal = false

    // The emulation loop runs on its own thread (below), off the UI thread
    // it used to share via Choreographer -- outdoor 3D-heavy NDS scenes can
    // take longer than one vsync period to interpret, and running that
    // directly on the UI thread meant it competed with (and got starved by)
    // ordinary view traversal/input work, visible as extra slowdown on top
    // of the interpreter's own cost. Every other method here still runs on
    // whatever thread RN calls it from (the UI thread, for view commands) --
    // dsLock guards every access to [ds] and the two bitmaps so the two
    // threads never touch melonDS's native handle or read/write a bitmap
    // at the same time. Sections under the lock are all short (no I/O), so
    // the worst case is a touch/button event blocking for a fraction of a
    // frame while the emu thread finishes the frame it's mid-way through.
    private val dsLock = Any()
    private var emuThread: HandlerThread? = null
    private var emuHandler: Handler? = null

    init {
        holder.addCallback(this)
        // The on-screen controls (and the title bar) are React Native
        // views laid out *over* this one, and a z-ordered-on-top surface
        // would bury them. Media overlay keeps this layer below the
        // window, which shows through the transparent hole SurfaceView
        // punches in it -- which is also why App.tsx's screenDs style
        // must stay backgroundColor:'transparent'. An opaque background
        // there is repainted over that hole by View.draw() and hides the
        // frames completely (they still reach the window's back buffer,
        // so nothing errors -- it just goes black).
        setZOrderMediaOverlay(true)
    }

    private val audioAttributes = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_GAME)
        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
        .build()

    // The DS runs at ~59.8237Hz, not the display's 60 -- this is that
    // period, which is what the emulation is paced against below.
    private val frameIntervalNanos = (1_000_000_000.0 / 59.8237).toLong()
    private var nextFrameTargetNanos = 0L

    // Self-paced, NOT Choreographer/vsync-driven. Emulating one frame of
    // a 3D-heavy NDS scene costs well over one 16.6ms vsync interval on
    // this class of device (measured ~36ms), and a vsync-driven callback
    // can only ever start work on a vsync boundary -- so 36ms of work
    // waits out a *third* interval (50ms) and ~14ms per frame is spent
    // idle, pinning the emulator to exactly 60/3 = 20fps. Pacing against
    // the DS's own frame period instead runs those same 36ms back to
    // back for ~28fps, and makes every future millisecond saved show up
    // as fps instead of being rounded away by vsync quantization.
    private val frameRunnable = object : Runnable {
        override fun run() {
            if (!running) return
            if (!pausedByModal) {
                synchronized(dsLock) {
                    ds?.let { instance ->
                        instance.runFrame()

                        // Straight GPU->screen when there's a window
                        // surface and a GL compositor behind it: no
                        // readback, no int[] copy across JNI, no Bitmap,
                        // no Canvas, and no work handed to the UI thread.
                        val presented = if (hasSurface && useGlPresent) {
                            instance.presentFrame(topScreenRect(), bottomScreenRect(), surfaceWidth, surfaceHeight)
                        } else {
                            DsNative.PRESENT_NO_SURFACE
                        }
                        // Only the software renderer is a permanent
                        // reason to give up on the GL path -- and only
                        // then does the Surface have to go back, since
                        // EGL and lockCanvas cannot both own one.
                        // PRESENT_NO_SURFACE just means the handover is
                        // still queued on this thread (it lands behind a
                        // multi-second ROM load). Latching *that* off
                        // stranded the whole session on the CPU path:
                        // surfaceCreated re-checks useGlPresent before
                        // posting, so once off it never got another
                        // chance -- the "first launch is slow, reopen the
                        // ROM and it's fine" bug.
                        if (presented == DsNative.PRESENT_NOT_ACCELERATED) {
                            useGlPresent = false
                            DsNative.setSurface(null)
                        }
                        // ...and while that handover is merely pending,
                        // display nothing rather than reaching for
                        // lockCanvas. Locking the Surface's Canvas
                        // connects it to the CPU rendering API, after
                        // which eglCreateWindowSurface on the same
                        // Surface fails with EGL_BAD_ALLOC (0x3003) for
                        // good -- so a few undisplayed frames here is the
                        // cheap outcome, and drawing them is the one that
                        // costs the GL path entirely.
                        if (presented != DsNative.PRESENT_OK && !useGlPresent) {
                            instance.readFramebuffers()
                            topBitmap?.setPixels(instance.topFramebuffer, 0, DsNative.width, 0, 0, DsNative.width, DsNative.height)
                            bottomBitmap?.setPixels(instance.bottomFramebuffer, 0, DsNative.width, 0, 0, DsNative.width, DsNative.height)
                            drawBitmapsToSurface()
                        }

                        val frames = instance.readAudioSamples(audioBuffer)
                        if (frames > 0) {
                            audioTrack?.write(audioBuffer, 0, frames * 2, AudioTrack.WRITE_NON_BLOCKING)
                        }
                    }
                }
            }

            val now = System.nanoTime()
            nextFrameTargetNanos += frameIntervalNanos
            // Running behind (the normal case on a 3D-heavy scene): give
            // up on catching up -- re-anchoring to now instead of letting
            // the deficit accumulate keeps this from spinning through a
            // burst of catch-up frames the moment the scene gets cheap
            // again, which would play back as a speed-up glitch.
            if (nextFrameTargetNanos < now) {
                nextFrameTargetNanos = now
                emuHandler?.post(this)
            } else {
                emuHandler?.postDelayed(this, (nextFrameTargetNanos - now) / 1_000_000L)
            }
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

    /**
     * Runs [block] on the emu thread. Every GL call in this class has to
     * go through here: an EGL context is bound to exactly one thread, and
     * the one that matters is the thread running frames. Creating the
     * emulator elsewhere (RN delivers loadRom* on the UI thread) makes
     * ds_jni.cpp's EnsureGLContext bind the context *there*, leaving the
     * emu thread with no current context -- every subsequent GL call,
     * including nativeSetSurface's eglMakeCurrent, then silently does
     * nothing. Falls back to running inline before the thread exists.
     */
    private fun onEmuThread(block: () -> Unit) {
        val handler = emuHandler
        if (handler == null || Looper.myLooper() === handler.looper) block() else handler.post(block)
    }

    /**
     * Adopts the session already running for [key], or builds a new one
     * with [create] if that's a different ROM.
     *
     * React Native unmounts and remounts this view on every rotation, and
     * App.tsx re-pushes the current ROM whenever it remounts. Tying the
     * emulator to the view's lifetime therefore meant rotating the phone
     * rebooted the game and threw away everything since the last in-game
     * save. A DS session is an emulated console, so it outlives any one
     * View: the re-push becomes "make sure this ROM is loaded" instead of
     * "load it again", and the only thing the new view rebuilds is its
     * own bitmaps and AudioTrack.
     */
    private fun adoptOrLoad(key: String, create: () -> DsNative?) {
        synchronized(dsLock) {
            stopAudio()
            val existing = if (sharedKey == key) sharedDs else null
            if (existing == null) {
                sharedDs?.close()
                sharedDs = null
                sharedKey = null
                val created = create() ?: return afterLoad(null)
                sharedDs = created
                sharedKey = key
                afterLoad(created)
            } else {
                afterLoad(existing)
            }
        }
    }

    /** romId (e.g. the ROM's CRC32) keys its save file -- pass null to skip persistence. Only for small (e.g. homebrew) ROMs -- see loadRomFromPath. */
    fun loadRom(rom: ByteArray, romId: String?) = onEmuThread {
        adoptOrLoad("bytes:${rom.size}:$romId") { DsNative.load(rom, savePathFor(romId)) }
    }

    /** Reads the ROM straight off disk -- see DsNative.loadFromPath. This is the path a real (128-512MB) NDS ROM should take. */
    fun loadRomFromPath(romPath: String, romId: String?) = onEmuThread {
        adoptOrLoad("path:$romPath:$romId") { DsNative.loadFromPath(romPath, savePathFor(romId)) }
    }

    fun setButtonPressed(button: DsButton, pressed: Boolean) = synchronized(dsLock) {
        ds?.setButtonPressed(button, pressed)
    }

    fun setPaused(value: Boolean) {
        pausedByModal = value
    }

    /**
     * Inserts a GBA ROM into the slot-2 for Pal Park-style Pokemon
     * transfers -- see DsNative.insertGbaCart. [gbaRomId] reuses the
     * exact save path GbaView would use for this same ROM (its CRC32),
     * so a transfer sees whatever was already caught playing it as a
     * regular GBA game. Returns false if nothing's loaded or the file
     * isn't a GBA ROM melonDS recognizes.
     */
    fun insertGbaCart(gbaRomPath: String, gbaRomId: String?): Boolean = synchronized(dsLock) {
        ds?.insertGbaCart(gbaRomPath, savePathFor(gbaRomId)) ?: false
    }

    fun ejectGbaCart() = synchronized(dsLock) {
        ds?.ejectGbaCart()
    }

    /** Full emulator state (not just cartridge save RAM) -- null if nothing's loaded or the save fails. */
    fun saveState(): ByteArray? = synchronized(dsLock) { ds?.saveState() }

    fun loadState(data: ByteArray): Boolean = synchronized(dsLock) { ds?.loadState(data) ?: false }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        running = true
        val thread = HandlerThread("DsEmuThread", Process.THREAD_PRIORITY_URGENT_DISPLAY)
        thread.start()
        emuThread = thread
        val handler = Handler(thread.looper)
        emuHandler = handler
        // First thing this thread does: take the GL context the previous
        // emulation thread released on its way out (see
        // onDetachedFromWindow). A remounted view adopts a session whose
        // renderer already exists, so the context has to be current here
        // before any frame runs -- nativeSetSurface would otherwise be
        // the first to bind it, and the frames before it would render
        // into nothing.
        handler.post { DsNative.bindContext() }
        nextFrameTargetNanos = System.nanoTime()
        // The Surface can already exist by the time the emu thread does
        // (surfaceCreated fires on attach, and it had no handler to post
        // to then) -- hand it over now if so.
        if (hasSurface && useGlPresent) {
            val surface = holder.surface
            handler.post { DsNative.setSurface(surface) }
        }
        handler.post(frameRunnable)
        DsEmulatorControlModule.activeDs = this
    }

    override fun onDetachedFromWindow() {
        running = false
        // Tear the emulator down *on the emu thread*: ~NDS destroys the
        // GLRenderer, whose glDelete* calls only do anything on the thread
        // the context is current on (see onEmuThread). quitSafely (not
        // quit) so this already-due message still gets dispatched -- the
        // frame callback, if one is due too, sees running == false and
        // returns immediately.
        emuHandler?.post {
            synchronized(dsLock) {
                // Deliberately NOT ds.close(): the session is shared and
                // survives this view (see adoptOrLoad). Releasing the EGL
                // context here is what lets the *next* view's emu thread
                // bind it -- a context stays current on whichever thread
                // last bound it, and this one is about to exit.
                ds = null
            }
            stopAudio()
            DsNative.releaseContext()
        }
        emuThread?.quitSafely()
        emuThread?.join()
        emuThread = null
        emuHandler = null
        stopAudio()
        if (DsEmulatorControlModule.activeDs === this) DsEmulatorControlModule.activeDs = null
        super.onDetachedFromWindow()
    }

    // Landscape-shaped bounds (App.tsx gives this view a wide box when the
    // phone is rotated) lay the two screens out left/right instead of
    // stacked top/bottom -- stacking two tall-narrow screens inside a wide
    // box otherwise leaves most of the width empty and squeezes both
    // screens down to a sliver.
    private fun isSideBySide(): Boolean = width > height

    // Fallback display path, only used when there's no GL compositor to
    // present from (see useGlPresent). A SurfaceView's content doesn't go
    // through View.onDraw at all -- it's a separate layer -- so this locks
    // the Surface's own Canvas instead. Called on the emu thread, already
    // holding dsLock.
    private fun drawBitmapsToSurface() {
        if (!hasSurface) return
        val top = topBitmap ?: return
        val bottom = bottomBitmap ?: return
        val canvas = try {
            holder.lockCanvas()
        } catch (e: IllegalStateException) {
            null
        } ?: return
        try {
            canvas.drawColor(android.graphics.Color.BLACK)
            val srcRect = Rect(0, 0, top.width, top.height)
            canvas.drawBitmap(top, srcRect, topScreenRect(), paint)
            canvas.drawBitmap(bottom, srcRect, bottomScreenRect(), paint)
        } finally {
            holder.unlockCanvasAndPost(canvas)
        }
    }

    override fun surfaceCreated(holder: SurfaceHolder) {
        // The EGL window surface has to be created on the emu thread (EGL
        // is thread-bound), so hand it over there rather than here.
        val surface = holder.surface
        hasSurface = true
        emuHandler?.post { if (useGlPresent) DsNative.setSurface(surface) }
    }

    override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
        surfaceWidth = width
        surfaceHeight = height
        val surface = holder.surface
        // Re-wrap: a resize hands out a new buffer geometry, and the old
        // EGLSurface is stale.
        emuHandler?.post { if (useGlPresent) DsNative.setSurface(surface) }
    }

    override fun surfaceDestroyed(holder: SurfaceHolder) {
        hasSurface = false
        // Block until the emu thread has actually let go of the Surface:
        // returning from here while it still holds an EGLSurface on a
        // destroyed window is a crash.
        val handler = emuHandler
        if (handler != null) {
            val done = java.util.concurrent.CountDownLatch(1)
            handler.post {
                DsNative.setSurface(null)
                done.countDown()
            }
            done.await(1, java.util.concurrent.TimeUnit.SECONDS)
        }
    }

    private fun topScreenRect(): Rect =
        if (isSideBySide()) fitRect(DsNative.width, DsNative.height, width / 2, height, 0, 0)
        else fitRect(DsNative.width, DsNative.height, width, height / 2, 0, 0)

    private fun bottomScreenRect(): Rect =
        if (isSideBySide()) fitRect(DsNative.width, DsNative.height, width / 2, height, width / 2, 0)
        else fitRect(DsNative.width, DsNative.height, width, height / 2, 0, height / 2)

    /** Centers a srcW*srcH image, aspect-preserved, inside a boxW*boxH cell starting at ([offsetX], [offsetY]) -- see GbaLinkView's identical helper. */
    private fun fitRect(srcW: Int, srcH: Int, boxW: Int, boxH: Int, offsetX: Int, offsetY: Int): Rect {
        val scale = minOf(boxW.toFloat() / srcW, boxH.toFloat() / srcH)
        val w = (srcW * scale).toInt()
        val h = (srcH * scale).toInt()
        val left = offsetX + (boxW - w) / 2
        val top = offsetY + (boxH - h) / 2
        return Rect(left, top, left + w, top + h)
    }

    /**
     * The bottom screen is the touch screen -- map a touch in view space to
     * the emulated 256x192 touch-screen space using the same rect the
     * bottom screen was just drawn with, clamping to its bounds so a
     * finger that strays into the letterbox bars still registers at the
     * nearest edge instead of being dropped.
     */
    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (ds == null) return false
        val rect = bottomScreenRect()
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN, MotionEvent.ACTION_MOVE -> {
                val sideBySide = isSideBySide()
                val strayOntoTopScreen = if (sideBySide) event.x < rect.left - 24 else event.y < rect.top - 24
                if (strayOntoTopScreen) {
                    // Well outside the touch screen on the top/game screen's
                    // side (e.g. a stray touch that slid over from it) --
                    // don't drag a phantom touch-point onto the DS screen
                    // from there.
                    return false
                }
                val clampedX = event.x.coerceIn(rect.left.toFloat(), rect.right.toFloat() - 1)
                val clampedY = event.y.coerceIn(rect.top.toFloat(), rect.bottom.toFloat() - 1)
                val dsX = ((clampedX - rect.left) / rect.width() * DsNative.width).toInt().coerceIn(0, DsNative.width - 1)
                val dsY = ((clampedY - rect.top) / rect.height() * DsNative.height).toInt().coerceIn(0, DsNative.height - 1)
                synchronized(dsLock) { ds?.touchScreen(dsX, dsY) }
                return true
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                synchronized(dsLock) { ds?.releaseScreen() }
                return true
            }
        }
        return false
    }
}
