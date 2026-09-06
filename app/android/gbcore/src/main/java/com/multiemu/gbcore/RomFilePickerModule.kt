package com.multiemu.gbcore

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.io.FileOutputStream

private const val REQUEST_CODE_PICK_ROM = 9001

/**
 * Lets JS ask the user to pick an arbitrary file (their own legally-dumped
 * ROM) via Android's Storage Access Framework, and hands the bytes back
 * base64-encoded -- ready to feed straight into GameBoyView.loadRomBase64,
 * or to decode client-side first if a patch needs to be applied to it.
 *
 * No third-party file-picker dependency: SAF's ACTION_OPEN_DOCUMENT is
 * built into Android, which keeps this module self-contained.
 */
class RomFilePickerModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), ActivityEventListener {

    private var pendingPromise: Promise? = null
    private var pendingExtensions: List<String> = emptyList()
    // See pickRomPath -- true when this pick should resolve a cache file
    // path instead of a base64 string.
    private var pendingWantsPath: Boolean = false

    init {
        reactContext.addActivityEventListener(this)
    }

    override fun getName() = "RomFilePicker"

    /**
     * [extensions]: lowercase, no dot (e.g. ["gb", "gbc"]). SAF can only
     * filter by MIME type, and ROM extensions have no registered MIME type
     * -- most storage providers just report them as
     * "application/octet-stream" alongside every other unrecognized binary
     * file, so this can't narrow the picker's list to just ROMs. What it
     * *can* do reliably is validate the extension of whatever the user
     * picked and reject with a clear error if it doesn't match, which is
     * what onActivityResult does below.
     */
    @ReactMethod
    fun pickRom(extensions: ReadableArray, promise: Promise) {
        pendingWantsPath = false
        launchPicker(extensions, promise)
    }

    /**
     * Same picker as [pickRom], but resolves `{path, name, size}` -- a
     * path to a copy of the file in this app's private cache, not a
     * base64 string. Needed for large ROMs (NDS runs 128-512MB): base64
     * inflates size by a third and the result still has to survive a
     * trip across the JS bridge as one giant string, which reliably OOMs
     * for a file that size. See DsView.loadRomFromPath.
     */
    @ReactMethod
    fun pickRomPath(extensions: ReadableArray, promise: Promise) {
        pendingWantsPath = true
        launchPicker(extensions, promise)
    }

    /**
     * Reads back a small file at a plain filesystem path (e.g. one
     * returned by [pickRomPath]) as base64 -- for a GB/GBA ROM picked
     * through the same "Cargar un archivo" flow as NDS, which still
     * needs bytes in JS (CRC32 for its save-file key, patch application,
     * cover art lookup). Only sane for a small file; an NDS-sized one
     * should stay on the loadRomFromPath path instead.
     */
    @ReactMethod
    fun readFileAsBase64(path: String, promise: Promise) {
        try {
            val bytes = File(path).readBytes()
            promise.resolve(Base64.encodeToString(bytes, Base64.NO_WRAP))
        } catch (e: Exception) {
            promise.reject("READ_ERROR", e.message, e)
        }
    }

    private fun launchPicker(extensions: ReadableArray, promise: Promise) {
        val activity = reactApplicationContext.currentActivity
        if (activity == null) {
            promise.reject("NO_ACTIVITY", "No hay actividad activa")
            return
        }
        pendingPromise = promise
        pendingExtensions = (0 until extensions.size()).mapNotNull { extensions.getString(it)?.lowercase() }

        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
            // Best-effort hint -- narrows the list on providers that do
            // recognize these MIME types (mainly helps for .zip), but most
            // ROM extensions fall back to octet-stream regardless.
            putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("application/octet-stream", "application/zip", "application/x-zip-compressed"))
        }
        try {
            activity.startActivityForResult(intent, REQUEST_CODE_PICK_ROM)
        } catch (e: Exception) {
            pendingPromise = null
            promise.reject("NO_PICKER", "No se encontró un selector de archivos", e)
        }
    }

    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != REQUEST_CODE_PICK_ROM) return
        val promise = pendingPromise ?: return
        pendingPromise = null
        val allowedExtensions = pendingExtensions

        val uri = data?.data
        if (resultCode != Activity.RESULT_OK || uri == null) {
            promise.reject("CANCELLED", "El usuario canceló la selección")
            return
        }

        val fileName = queryDisplayName(uri) ?: "rom"

        try {
            val rawBytes = reactApplicationContext.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                ?: throw IllegalStateException("No se pudo abrir el archivo")

            val extracted = extractFromZipIfNeeded(rawBytes, fileName, allowedExtensions)
            if (extracted == null) {
                val isZip = fileName.substringAfterLast('.', "").lowercase() == "zip"
                promise.reject(
                    if (isZip) "NO_MATCH_IN_ZIP" else "INVALID_EXTENSION",
                    if (isZip) {
                        "El .zip no contiene ningún archivo ${allowedExtensions.joinToString(" o ") { ".$it" }}"
                    } else {
                        "\"$fileName\" no es un archivo ${allowedExtensions.joinToString(" o ") { ".$it" }}" +
                            " (también se aceptan .zip que los contengan)"
                    },
                )
                return
            }
            val (bytes, name) = extracted

            val result = Arguments.createMap().apply {
                if (pendingWantsPath) {
                    val cacheFile = File(reactApplicationContext.cacheDir, "picked_rom_${System.currentTimeMillis()}_$name")
                    FileOutputStream(cacheFile).use { it.write(bytes) }
                    putString("path", cacheFile.absolutePath)
                } else {
                    putString("base64", Base64.encodeToString(bytes, Base64.NO_WRAP))
                }
                putString("name", name)
                putInt("size", bytes.size)
            }
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("READ_ERROR", e.message, e)
        }
    }

    override fun onNewIntent(intent: Intent) {}

    private fun queryDisplayName(uri: Uri): String? {
        reactApplicationContext.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
            val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (nameIndex >= 0 && cursor.moveToFirst()) return cursor.getString(nameIndex)
        }
        return null
    }
}
