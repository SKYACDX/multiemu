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
import java.io.ByteArrayOutputStream
import java.util.zip.ZipInputStream

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
        val fileExtension = fileName.substringAfterLast('.', "").lowercase()

        try {
            val rawBytes = reactApplicationContext.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                ?: throw IllegalStateException("No se pudo abrir el archivo")

            val (bytes, name) = if (fileExtension == "zip") {
                extractFromZip(rawBytes, allowedExtensions)
                    ?: run {
                        promise.reject(
                            "NO_MATCH_IN_ZIP",
                            "El .zip no contiene ningún archivo ${allowedExtensions.joinToString(" o ") { ".$it" }}",
                        )
                        return
                    }
            } else {
                if (allowedExtensions.isNotEmpty() && fileExtension !in allowedExtensions) {
                    promise.reject(
                        "INVALID_EXTENSION",
                        "\"$fileName\" no es un archivo ${allowedExtensions.joinToString(" o ") { ".$it" }}" +
                            if (allowedExtensions.isNotEmpty()) " (también se aceptan .zip que los contengan)" else "",
                    )
                    return
                }
                rawBytes to fileName
            }

            val result = Arguments.createMap().apply {
                putString("base64", Base64.encodeToString(bytes, Base64.NO_WRAP))
                putString("name", name)
                putInt("size", bytes.size)
            }
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("READ_ERROR", e.message, e)
        }
    }

    /** Returns the bytes and filename of the first zip entry matching [allowedExtensions], or null if none does. */
    private fun extractFromZip(zipBytes: ByteArray, allowedExtensions: List<String>): Pair<ByteArray, String>? {
        ZipInputStream(zipBytes.inputStream()).use { zip ->
            while (true) {
                val entry = zip.nextEntry ?: return null
                val entryName = entry.name.substringAfterLast('/')
                val entryExtension = entryName.substringAfterLast('.', "").lowercase()
                if (entry.isDirectory || (allowedExtensions.isNotEmpty() && entryExtension !in allowedExtensions)) {
                    continue
                }
                val output = ByteArrayOutputStream()
                zip.copyTo(output)
                return output.toByteArray() to entryName
            }
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
