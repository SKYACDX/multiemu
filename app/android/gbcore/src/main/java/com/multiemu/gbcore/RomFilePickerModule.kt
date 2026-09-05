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
import com.facebook.react.bridge.ReactMethod

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

    init {
        reactContext.addActivityEventListener(this)
    }

    override fun getName() = "RomFilePicker"

    @ReactMethod
    fun pickRom(promise: Promise) {
        val activity = reactApplicationContext.currentActivity
        if (activity == null) {
            promise.reject("NO_ACTIVITY", "No hay actividad activa")
            return
        }
        pendingPromise = promise
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
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

        val uri = data?.data
        if (resultCode != Activity.RESULT_OK || uri == null) {
            promise.reject("CANCELLED", "El usuario canceló la selección")
            return
        }

        try {
            val bytes = reactApplicationContext.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                ?: throw IllegalStateException("No se pudo abrir el archivo")
            val result = Arguments.createMap().apply {
                putString("base64", Base64.encodeToString(bytes, Base64.NO_WRAP))
                putString("name", queryDisplayName(uri) ?: "rom")
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
