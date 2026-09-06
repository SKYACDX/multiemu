package com.multiemu.gbcore

import java.io.ByteArrayOutputStream
import java.util.zip.ZipInputStream

/**
 * Shared by RomFilePickerModule and RomLibraryModule: if [name] ends in
 * .zip, returns the bytes and filename of its first entry matching
 * [allowedExtensions]; otherwise returns [bytes]/[name] unchanged. Used
 * so a .zip works the same way whether it came from a single-file pick,
 * a chosen folder, or the app's own ROM cache.
 */
fun extractFromZipIfNeeded(bytes: ByteArray, name: String, allowedExtensions: List<String>): Pair<ByteArray, String>? {
    val extension = name.substringAfterLast('.', "").lowercase()
    if (extension != "zip") {
        if (allowedExtensions.isNotEmpty() && extension !in allowedExtensions) return null
        return bytes to name
    }
    ZipInputStream(bytes.inputStream()).use { zip ->
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
