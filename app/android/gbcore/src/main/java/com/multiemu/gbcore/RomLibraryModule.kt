package com.multiemu.gbcore

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import androidx.documentfile.provider.DocumentFile
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

private const val REQUEST_CODE_PICK_FOLDER = 9002
private const val CACHE_INDEX_FILE = "rom_cache_index.json"
private const val CACHE_DIR = "rom_cache"
private const val MAX_CACHE_ENTRIES = 12

/**
 * Two related pieces of "make loading ROMs less painful" that don't fit
 * RomFilePickerModule's single-pick job:
 *
 * - A small on-disk cache (app-private files dir, indexed by a plain
 *   JSON file -- no SQLite/AsyncStorage dependency needed for a dozen
 *   entries) of the last few ROMs the user actually loaded, so reopening
 *   one is instant instead of re-running the whole SAF-pick round trip.
 * - A folder picker (SAF's ACTION_OPEN_DOCUMENT_TREE) that lists ROM
 *   files inside a chosen folder, for people who keep their dumps
 *   together in one place instead of picking them one at a time.
 */
class RomLibraryModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), ActivityEventListener {

    private var pendingFolderPromise: Promise? = null

    init {
        reactContext.addActivityEventListener(this)
    }

    override fun getName() = "RomLibrary"

    // ---- Cache ----------------------------------------------------------

    @ReactMethod
    fun saveToCache(base64: String, name: String, system: String, label: String, promise: Promise) {
        try {
            val bytes = Base64.decode(base64, Base64.DEFAULT)
            val cacheDir = File(reactContext.filesDir, CACHE_DIR).apply { mkdirs() }
            val id = "${System.currentTimeMillis()}_${name.hashCode()}"
            File(cacheDir, id).writeBytes(bytes)

            val index = readIndex()
            // Replace an existing entry for the same file name instead of duplicating it.
            for (i in index.length() - 1 downTo 0) {
                if (index.getJSONObject(i).getString("name") == name) {
                    File(cacheDir, index.getJSONObject(i).getString("id")).delete()
                    index.remove(i)
                }
            }
            val entry = JSONObject().apply {
                put("id", id)
                put("name", name)
                put("system", system)
                put("label", label)
                put("size", bytes.size)
                put("savedAt", System.currentTimeMillis())
            }
            index.put(entry)
            while (index.length() > MAX_CACHE_ENTRIES) {
                File(cacheDir, index.getJSONObject(0).getString("id")).delete()
                index.remove(0)
            }
            writeIndex(index)

            promise.resolve(entry.toWritableMap())
        } catch (e: Exception) {
            promise.reject("CACHE_WRITE_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun listCache(promise: Promise) {
        try {
            val index = readIndex()
            val result: WritableArray = Arguments.createArray()
            for (i in index.length() - 1 downTo 0) {
                result.pushMap(index.getJSONObject(i).toWritableMap())
            }
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("CACHE_READ_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun loadFromCache(id: String, promise: Promise) {
        try {
            val file = File(File(reactContext.filesDir, CACHE_DIR), id)
            if (!file.exists()) {
                promise.reject("NOT_FOUND", "Esa ROM ya no está en la caché")
                return
            }
            val result = Arguments.createMap()
            result.putString("base64", Base64.encodeToString(file.readBytes(), Base64.NO_WRAP))
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("CACHE_READ_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun deleteFromCache(id: String, promise: Promise) {
        try {
            File(File(reactContext.filesDir, CACHE_DIR), id).delete()
            val index = readIndex()
            for (i in index.length() - 1 downTo 0) {
                if (index.getJSONObject(i).getString("id") == id) index.remove(i)
            }
            writeIndex(index)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("CACHE_WRITE_ERROR", e.message, e)
        }
    }

    private fun readIndex(): JSONArray {
        val file = File(reactContext.filesDir, CACHE_INDEX_FILE)
        if (!file.exists()) return JSONArray()
        return try {
            JSONArray(file.readText())
        } catch (e: Exception) {
            JSONArray()
        }
    }

    private fun writeIndex(index: JSONArray) {
        File(reactContext.filesDir, CACHE_INDEX_FILE).writeText(index.toString())
    }

    private fun JSONObject.toWritableMap(): WritableMap {
        val map = Arguments.createMap()
        map.putString("id", getString("id"))
        map.putString("name", getString("name"))
        map.putString("system", getString("system"))
        map.putString("label", getString("label"))
        map.putInt("size", getInt("size"))
        map.putDouble("savedAt", getLong("savedAt").toDouble())
        return map
    }

    // ---- Folder picking ---------------------------------------------------

    @ReactMethod
    fun pickFolder(promise: Promise) {
        val activity = reactContext.currentActivity
        if (activity == null) {
            promise.reject("NO_ACTIVITY", "No hay actividad activa")
            return
        }
        pendingFolderPromise = promise
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
        try {
            activity.startActivityForResult(intent, REQUEST_CODE_PICK_FOLDER)
        } catch (e: Exception) {
            pendingFolderPromise = null
            promise.reject("NO_PICKER", "No se encontró un selector de carpetas", e)
        }
    }

    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != REQUEST_CODE_PICK_FOLDER) return
        val promise = pendingFolderPromise ?: return
        pendingFolderPromise = null

        val treeUri = data?.data
        if (resultCode != Activity.RESULT_OK || treeUri == null) {
            promise.reject("CANCELLED", "El usuario canceló la selección")
            return
        }

        try {
            reactContext.contentResolver.takePersistableUriPermission(
                treeUri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION,
            )
            val folder = DocumentFile.fromTreeUri(reactContext, treeUri)
                ?: throw IllegalStateException("No se pudo abrir la carpeta")

            val result = Arguments.createMap()
            result.putString("uri", treeUri.toString())
            result.putString("name", folder.name ?: "Carpeta")
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("FOLDER_ERROR", e.message, e)
        }
    }

    override fun onNewIntent(intent: Intent) {}

    /** Lists files directly inside [folderUri] whose extension is in [extensions] (.zip always included). */
    @ReactMethod
    fun listFolder(folderUri: String, extensions: ReadableArray, promise: Promise) {
        try {
            val allowed = (0 until extensions.size()).mapNotNull { extensions.getString(it)?.lowercase() }
            val folder = DocumentFile.fromTreeUri(reactContext, Uri.parse(folderUri))
                ?: throw IllegalStateException("No se pudo abrir la carpeta")

            val result: WritableArray = Arguments.createArray()
            for (file in folder.listFiles()) {
                if (!file.isFile) continue
                val name = file.name ?: continue
                val ext = name.substringAfterLast('.', "").lowercase()
                if (ext != "zip" && ext !in allowed) continue
                val entry = Arguments.createMap()
                entry.putString("uri", file.uri.toString())
                entry.putString("name", name)
                entry.putDouble("size", file.length().toDouble())
                result.pushMap(entry)
            }
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("FOLDER_ERROR", e.message, e)
        }
    }

    /** Reads a single file previously returned by listFolder, unzipping it if needed. */
    @ReactMethod
    fun readFileFromFolder(fileUri: String, extensions: ReadableArray, promise: Promise) {
        try {
            val uri = Uri.parse(fileUri)
            val allowed = (0 until extensions.size()).mapNotNull { extensions.getString(it)?.lowercase() }
            val name = queryDisplayName(uri) ?: uri.lastPathSegment ?: "rom"
            val rawBytes = reactContext.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                ?: throw IllegalStateException("No se pudo abrir el archivo")

            val extracted = extractFromZipIfNeeded(rawBytes, name, allowed)
            if (extracted == null) {
                promise.reject("INVALID_EXTENSION", "\"$name\" no es un archivo compatible")
                return
            }
            val (bytes, resolvedName) = extracted
            val result = Arguments.createMap()
            result.putString("base64", Base64.encodeToString(bytes, Base64.NO_WRAP))
            result.putString("name", resolvedName)
            result.putInt("size", bytes.size)
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("READ_ERROR", e.message, e)
        }
    }

    private fun queryDisplayName(uri: Uri): String? {
        reactContext.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
            val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (nameIndex >= 0 && cursor.moveToFirst()) return cursor.getString(nameIndex)
        }
        return null
    }
}
