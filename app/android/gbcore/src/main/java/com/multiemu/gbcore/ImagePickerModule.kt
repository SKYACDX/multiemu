package com.multiemu.gbcore

import android.app.Activity
import android.content.Intent
import android.provider.OpenableColumns
import android.util.Base64
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

private const val REQUEST_CODE_PICK_IMAGE = 9002
private const val MAX_IMAGE_BYTES = 8 * 1024 * 1024 // matches docs/feedback-api.md's upload-url limit

/**
 * Lets JS ask the user to attach a screenshot to a feedback report, via
 * Android's Storage Access Framework -- same no-third-party-dependency
 * approach as RomFilePickerModule, just for images instead of ROMs.
 */
class ImagePickerModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), ActivityEventListener {

    private var pendingPromise: Promise? = null

    init {
        reactContext.addActivityEventListener(this)
    }

    override fun getName() = "ImagePicker"

    @ReactMethod
    fun pickImage(promise: Promise) {
        val activity = reactApplicationContext.currentActivity
        if (activity == null) {
            promise.reject("NO_ACTIVITY", "No hay actividad activa")
            return
        }
        pendingPromise = promise

        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "image/*"
        }
        try {
            activity.startActivityForResult(intent, REQUEST_CODE_PICK_IMAGE)
        } catch (e: Exception) {
            pendingPromise = null
            promise.reject("NO_PICKER", "No se encontró un selector de imágenes", e)
        }
    }

    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != REQUEST_CODE_PICK_IMAGE) return
        val promise = pendingPromise ?: return
        pendingPromise = null

        val uri = data?.data
        if (resultCode != Activity.RESULT_OK || uri == null) {
            promise.reject("CANCELLED", "El usuario canceló la selección")
            return
        }

        try {
            val resolver = reactApplicationContext.contentResolver
            val bytes = resolver.openInputStream(uri)?.use { it.readBytes() }
                ?: throw IllegalStateException("No se pudo abrir la imagen")
            if (bytes.size > MAX_IMAGE_BYTES) {
                promise.reject("TOO_LARGE", "La imagen pesa más de 8MB")
                return
            }

            var name = "captura.jpg"
            resolver.query(uri, null, null, null, null)?.use { cursor ->
                val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (nameIndex >= 0 && cursor.moveToFirst()) cursor.getString(nameIndex)?.let { name = it }
            }
            val mimeType = resolver.getType(uri) ?: "image/jpeg"

            val result = Arguments.createMap().apply {
                putString("base64", Base64.encodeToString(bytes, Base64.NO_WRAP))
                putString("name", name)
                putString("mimeType", mimeType)
                putInt("size", bytes.size)
            }
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("READ_ERROR", e.message, e)
        }
    }

    override fun onNewIntent(intent: Intent) {}
}
