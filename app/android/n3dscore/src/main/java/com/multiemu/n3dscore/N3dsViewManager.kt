package com.multiemu.n3dscore

import android.util.Base64
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewManager
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * Exposes [N3dsView] to React Native as `<N3dsView />`. Commands, same
 * shape as DsViewManager:
 *   - "loadRomPath" [path] -- the core reads the ROM straight off disk
 *   - "setButtonPressed" [buttonName, pressed] -- an [N3dsButton] name
 *   - "setPaused" [true|false]
 * Touch is handled natively by the view, like DsView's bottom screen.
 */
class N3dsViewManager : SimpleViewManager<N3dsView>() {
    override fun getName() = "N3dsView"

    override fun createViewInstance(reactContext: ThemedReactContext) = N3dsView(reactContext)

    override fun receiveCommand(view: N3dsView, commandId: String, args: ReadableArray?) {
        if (args == null) return
        when (commandId) {
            "loadRomPath" -> view.loadRomPath(args.getString(0) ?: return)
            "setButtonPressed" -> {
                val button = runCatching { N3dsButton.valueOf(args.getString(0) ?: return) }.getOrNull() ?: return
                view.setButtonPressed(button, args.getBoolean(1))
            }
            "setPaused" -> view.setPaused(args.getBoolean(0))
        }
    }
}

/**
 * 3DS state slots for JS. The file is the same one RomLibraryModule keeps
 * for GBA/DS slots (filesDir/states/<romId>_slot<N>.state), so listing and
 * deleting slots works unchanged -- only writing and reading differ: the
 * core does it straight to disk, since a 3DS state is far too big to pass
 * through JS as base64 the way the others do.
 */
class N3dsStateModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    override fun getName() = "N3dsState"

    // Block bodies on purpose: React Native's module system treats any
    // @ReactMethod that returns a value as synchronous, and rejects a
    // synchronous one taking a Promise -- an expression body returning
    // Handler.post's Boolean took the whole app down at startup.
    @ReactMethod
    fun saveSlot(romId: String, slot: Int, promise: Promise) {
        N3dsSession.saveState(slotFile(romId, slot).path) { error -> settle(promise, error) }
    }

    @ReactMethod
    fun loadSlot(romId: String, slot: Int, promise: Promise) {
        N3dsSession.loadState(slotFile(romId, slot).path) { error -> settle(promise, error) }
    }

    // ---- Slots in the cloud --------------------------------------------------
    // A state is ~11-13MB: these move it between the slot file and a presigned
    // URL themselves (JS only gets the URLs from the API), rather than as a
    // base64 string through the bridge. Off the main thread; never on the
    // emulation thread, which keeps running the game meanwhile.

    /** The slot file's size in bytes (0 if empty) -- the presign request needs it up front. */
    @ReactMethod
    fun slotSize(romId: String, slot: Int, promise: Promise) {
        promise.resolve(slotFile(romId, slot).length().toDouble())
    }

    /** PUTs the slot's file to [uploadUrl]; resolves its size in bytes. */
    @ReactMethod
    fun uploadSlot(romId: String, slot: Int, uploadUrl: String, contentType: String, promise: Promise) {
        Thread {
            try {
                val file = slotFile(romId, slot)
                require(file.exists()) { "Ese slot está vacío" }
                val connection = (URL(uploadUrl).openConnection() as HttpURLConnection).apply {
                    requestMethod = "PUT"
                    doOutput = true
                    setRequestProperty("Content-Type", contentType)
                    setFixedLengthStreamingMode(file.length())
                }
                file.inputStream().use { input -> connection.outputStream.use { input.copyTo(it) } }
                val status = connection.responseCode
                connection.disconnect()
                check(status in 200..299) { "No se pudo subir el estado (HTTP $status)" }
                promise.resolve(file.length().toDouble())
            } catch (e: Exception) {
                promise.reject("N3DS_STATE", e.message, e)
            }
        }.start()
    }

    /**
     * Downloads a state from [downloadUrl] and loads it into the running game.
     * Only once it has loaded does it replace the slot's file: a state the
     * core can't load -- one from the desktop port, say, whose format differs
     * ("incompatible native format - size of long") -- leaves the local slot
     * as it was.
     */
    @ReactMethod
    fun downloadSlot(romId: String, slot: Int, downloadUrl: String, promise: Promise) {
        Thread {
            val target = slotFile(romId, slot)
            val incoming = File(target.path + ".cloud")
            try {
                val connection = URL(downloadUrl).openConnection() as HttpURLConnection
                val status = connection.responseCode
                check(status in 200..299) { "No se pudo descargar el estado (HTTP $status)" }
                connection.inputStream.use { input -> incoming.outputStream().use { input.copyTo(it) } }
                connection.disconnect()
            } catch (e: Exception) {
                incoming.delete()
                promise.reject("N3DS_STATE", e.message, e)
                return@Thread
            }
            N3dsSession.loadState(incoming.path) { error ->
                if (error != null) {
                    incoming.delete()
                    promise.reject(
                        "N3DS_STATE_INCOMPATIBLE",
                        "Este estado no se pudo cargar en este teléfono (los estados de 3DS de la app " +
                            "de Windows no son compatibles con Android). Tu slot no se ha tocado.",
                    )
                } else {
                    incoming.renameTo(target.also { it.delete() })
                    promise.resolve(null)
                }
            }
        }.start()
    }

    private fun settle(promise: Promise, error: String?) {
        if (error == null) promise.resolve(null) else promise.reject("N3DS_STATE", error)
    }

    private fun slotFile(romId: String, slot: Int) =
        File(File(context.filesDir, "states").apply { mkdirs() }, "${romId}_slot$slot.state")
}

/**
 * The 3DS in-game save for the cloud (see [N3dsCloudSave] and
 * docs/3ds-cloud-save.md): its key, the local save as a zip plus the
 * fingerprint it's compared by, and restoring a cloud zip in its place.
 */
class N3dsCloudModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    override fun getName() = "N3dsCloud"

    private val coreDataDir get() = File(context.filesDir, "3ds")

    @ReactMethod
    fun gameKey(romPath: String, promise: Promise) {
        val id = N3dsCloudSave.programId(File(romPath))
        if (id == null) promise.reject("N3DS_CLOUD", "No se pudo identificar este juego de 3DS") else promise.resolve(N3dsCloudSave.gameKey(id))
    }

    /** {base64, fingerprint, newestModified}, or null while the game has saved nothing. */
    @ReactMethod
    fun localSave(romPath: String, promise: Promise) {
        try {
            val dir = dataDir(romPath)
            val tree = N3dsCloudSave.readTree(dir)
            if (!N3dsCloudSave.hasSaveData(tree)) {
                promise.resolve(null)
                return
            }
            promise.resolve(Arguments.createMap().apply {
                putString("base64", Base64.encodeToString(N3dsCloudSave.pack(tree), Base64.NO_WRAP))
                putDouble("fingerprint", N3dsCloudSave.fingerprint(tree).toDouble())
                putDouble("newestModified", N3dsCloudSave.newestModified(dir).toDouble())
            })
        } catch (e: Exception) {
            promise.reject("N3DS_CLOUD", e.message, e)
        }
    }

    /** The fingerprint of a cloud zip, to compare with the local one; -1 if it holds no progress. */
    @ReactMethod
    fun zipFingerprint(base64: String, promise: Promise) {
        try {
            val tree = N3dsCloudSave.unpack(Base64.decode(base64, Base64.DEFAULT))
            promise.resolve(if (N3dsCloudSave.hasSaveData(tree)) N3dsCloudSave.fingerprint(tree).toDouble() else -1.0)
        } catch (e: Exception) {
            promise.reject("N3DS_CLOUD", e.message, e)
        }
    }

    /**
     * Puts a cloud zip in place of the game's save. Closes the game first; the
     * save it replaces goes to filesDir/3ds/save-backups/3ds-<id>.zip.
     */
    @ReactMethod
    fun restoreSave(romPath: String, base64: String, promise: Promise) {
        N3dsSession.stopThen {
            try {
                val id = N3dsCloudSave.programId(File(romPath)) ?: error("No se pudo identificar este juego de 3DS")
                val dir = N3dsCloudSave.dataDir(coreDataDir, id)
                val incoming = N3dsCloudSave.unpack(Base64.decode(base64, Base64.DEFAULT))
                val current = N3dsCloudSave.readTree(dir)
                if (N3dsCloudSave.hasSaveData(current)) {
                    File(coreDataDir, "save-backups").apply { mkdirs() }
                        .resolve("3ds-$id.zip").writeBytes(N3dsCloudSave.pack(current))
                }
                N3dsCloudSave.writeTree(dir, incoming)
                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("N3DS_CLOUD", e.message, e)
            }
        }
    }

    private fun dataDir(romPath: String): File {
        val id = N3dsCloudSave.programId(File(romPath)) ?: error("No se pudo identificar este juego de 3DS")
        return N3dsCloudSave.dataDir(coreDataDir, id)
    }
}

/**
 * The running game's local wireless over the internet: joining a room on
 * the room server (same server and room numbering as the desktop app, see
 * N3dsView.tsx) and polling how that went.
 */
class N3dsRoomModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    override fun getName() = "N3dsRoom"

    @ReactMethod
    fun join(host: String, port: Int, nickname: String) {
        N3dsSession.joinRoom(host, port, nickname)
    }

    @ReactMethod
    fun leave() {
        N3dsSession.leaveRoom()
    }

    /** {state, error, members}; see nativeRoomStatus in n3ds_jni.cpp. */
    @ReactMethod
    fun status(promise: Promise) {
        N3dsSession.roomStatus { (state, error, members) ->
            promise.resolve(Arguments.createMap().apply {
                putInt("state", state)
                putInt("error", error)
                putInt("members", members)
            })
        }
    }
}

class N3dsPackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
        if (N3dsNative.available) {
            listOf(N3dsStateModule(reactContext), N3dsCloudModule(reactContext), N3dsRoomModule(reactContext))
        } else {
            emptyList()
        }

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
        if (N3dsNative.available) listOf(N3dsViewManager()) else emptyList()
}
