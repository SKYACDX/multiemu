package com.multiemu.gbcore

import android.content.Context
import android.content.Intent
import android.net.Uri

/**
 * An import whose file picker outlived the app. Android may kill a
 * backgrounded app while the system picker is in front (it did, on a 4GB
 * phone with a work profile open); the picker's answer then reaches a fresh
 * activity with no JS promise waiting, and the import was lost without a
 * word. So which game the import was for is noted before the picker opens,
 * MainActivity notes the file it returns, and the next start offers to
 * finish it (RomLibraryModule.takePendingSaveImport).
 */
object PendingSaveImport {
    const val REQUEST_CODE = 9003
    private const val PREFS = "pending_save_import"

    class Pending(val romId: String, val target: String, val label: String, val uri: Uri)

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun start(context: Context, romId: String, target: String, label: String) {
        prefs(context).edit().clear().putString("romId", romId).putString("target", target).putString("label", label).apply()
    }

    /** From MainActivity.onActivityResult, before React sees it (it may not be up yet). */
    fun rememberResult(context: Context, uri: Uri) {
        if (prefs(context).getString("romId", null) == null) return
        // Kept readable across the restart; released in clear().
        runCatching { context.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION) }
        prefs(context).edit().putString("uri", uri.toString()).apply()
    }

    fun take(context: Context): Pending? {
        val p = prefs(context)
        val romId = p.getString("romId", null) ?: return null
        val uri = p.getString("uri", null) ?: return null
        return Pending(romId, p.getString("target", "") ?: "", p.getString("label", "") ?: "", Uri.parse(uri))
    }

    fun clear(context: Context) {
        prefs(context).getString("uri", null)?.let { uri ->
            runCatching { context.contentResolver.releasePersistableUriPermission(Uri.parse(uri), Intent.FLAG_GRANT_READ_URI_PERMISSION) }
        }
        prefs(context).edit().clear().apply()
    }
}
