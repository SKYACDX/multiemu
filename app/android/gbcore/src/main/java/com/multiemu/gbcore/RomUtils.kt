package com.multiemu.gbcore

import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
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

/**
 * Streaming counterpart of [extractFromZipIfNeeded], for the
 * load-by-path flow: copies the ROM straight from [input] into [dest]
 * without ever holding it in the heap, unzipping on the way if [name] is
 * a .zip. Returns the ROM's own filename, or null if nothing inside
 * matched [allowedExtensions] (in which case [dest] is removed).
 *
 * The byte[] version above is fine for a Game Boy or GBA ROM but not for
 * a DS one: it needs the whole file in memory, and for a .zip a second
 * buffer that doubles as it grows. A 233MB Pokemon ROM inside a .zip
 * asked for a 466MB array and took the app down with an OutOfMemoryError
 * -- the ROM was being read, decompressed and only then written to the
 * very cache file it was headed for anyway.
 */
fun extractToFile(input: InputStream, name: String, allowedExtensions: List<String>, dest: File): String? {
    val extension = name.substringAfterLast('.', "").lowercase()
    if (extension != "zip") {
        if (allowedExtensions.isNotEmpty() && extension !in allowedExtensions) return null
        FileOutputStream(dest).use { input.copyTo(it) }
        return name
    }
    ZipInputStream(input).use { zip ->
        while (true) {
            val entry = zip.nextEntry ?: break
            val entryName = entry.name.substringAfterLast('/')
            val entryExtension = entryName.substringAfterLast('.', "").lowercase()
            if (entry.isDirectory || (allowedExtensions.isNotEmpty() && entryExtension !in allowedExtensions)) {
                continue
            }
            FileOutputStream(dest).use { zip.copyTo(it) }
            return entryName
        }
    }
    dest.delete()
    return null
}
