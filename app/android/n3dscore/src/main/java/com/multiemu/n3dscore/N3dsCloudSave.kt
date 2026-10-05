package com.multiemu.n3dscore

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.RandomAccessFile
import java.util.Calendar
import java.util.zip.CRC32
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream

/**
 * Cloud saves for the 3DS -- a contract with the desktop port, which does the
 * same in multiemu_exe's src/save3ds.js (see docs/3ds-cloud-save.md). Both
 * devices must agree byte for byte on the key and the fingerprint, or each
 * one sees the other's save as different (or as someone else's game).
 *
 * Azahar has no save RAM: a 3DS game writes ordinary files into the emulated
 * SD card, under
 *
 *   <dataDir>/Azahar/sdmc/Nintendo 3DS/<id0>/<id1>/title/<high>/<low>/data
 *
 * so the save that goes to the cloud is that folder, as a zip, paths relative
 * to it. Key "3ds:<program ID>", slot 99.
 */
object N3dsCloudSave {
    /** A save is a few hundred KB; this only stops a hostile zip from inflating into all of memory. */
    private const val MAX_UNPACKED_BYTES = 256L * 1024 * 1024
    private val ID_PATTERN = Regex("^[0-9a-fA-F]{32}$")
    private val ZERO_ID = "0".repeat(32)

    /**
     * The game's program ID as 16 lowercase hex digits, or null if [rom] isn't
     * a 3DS game this can read. The NCCH header is never encrypted: the ID is
     * at 0x118 of it. A .3ds/.cci is an NCSD whose first partition (the game)
     * starts at the offset in its header; a .cxi is that NCCH on its own.
     * Read by content, not extension -- the copies Recents keeps have none.
     */
    fun programId(rom: File): String? = runCatching {
        RandomAccessFile(rom, "r").use { file ->
            val outer = read(file, 0, 0x200)
            val ncch = when (ascii(outer, 0x100)) {
                "NCSD" -> u32(outer, 0x120) * 0x200
                "NCCH" -> 0L
                else -> return null
            }
            val header = if (ncch == 0L) outer else read(file, ncch, 0x200)
            if (ascii(header, 0x100) != "NCCH") return null
            "%08x%08x".format(u32(header, 0x11C), u32(header, 0x118))
        }
    }.getOrNull()

    fun gameKey(programId: String) = "3ds:$programId"

    /** The game's `data` folder on this device's emulated SD card. */
    fun dataDir(coreDataDir: File, programId: String): File {
        val sd = File(coreDataDir, "Azahar/sdmc/Nintendo 3DS")
        val id0 = onlyId(sd)
        val id1 = onlyId(File(sd, id0))
        return File(sd, "$id0/$id1/title/${programId.substring(0, 8)}/${programId.substring(8)}/data")
    }

    // ponytail: Azahar names its SD folders after the console's ID, always the
    // all-zero pair here, so there is one of each; with several, the first.
    private fun onlyId(dir: File): String =
        dir.list()?.filter { ID_PATTERN.matches(it) }?.minOrNull() ?: ZERO_ID

    // ---- A folder as a sorted "relative/path" -> bytes map ----------------------

    fun readTree(dir: File): Map<String, ByteArray> {
        val tree = sortedMapOf<String, ByteArray>()
        fun walk(folder: File, relative: String) {
            val children = folder.listFiles() ?: return
            if (children.isEmpty() && relative.isNotEmpty()) tree["$relative/"] = ByteArray(0)
            for (child in children) {
                val name = if (relative.isEmpty()) child.name else "$relative/${child.name}"
                if (child.isDirectory) walk(child, name) else if (child.isFile) tree[name] = child.readBytes()
            }
        }
        walk(dir, "")
        return tree
    }

    /**
     * Folders only count when empty (other zip tools list every folder, and the
     * same save must come out the same), sorted by name as UTF-8 bytes.
     */
    fun canonical(tree: Map<String, ByteArray>): List<Pair<String, ByteArray>> =
        tree.filterKeys { name -> !name.endsWith("/") || tree.keys.none { it != name && it.startsWith(name) } }
            .toList()
            .sortedWith { a, b -> compareUtf8(a.first, b.first) }

    /**
     * Whether the game has written anything: Azahar creates a 1KB
     * `00000001.metadata` the moment a game first boots, so a folder holding
     * nothing else has no progress -- never to be uploaded over the cloud's.
     */
    fun hasSaveData(tree: Map<String, ByteArray>) =
        tree.keys.any { !it.endsWith("/") && !it.endsWith(".metadata") }

    /** CRC32 over each entry, in canonical order: name, 0x00, size in decimal, 0x00, bytes. */
    fun fingerprint(tree: Map<String, ByteArray>): Long {
        val crc = CRC32()
        for ((name, data) in canonical(tree)) {
            crc.update("$name\u0000${data.size}\u0000".toByteArray(Charsets.UTF_8))
            crc.update(data)
        }
        return crc.value
    }

    /** Sorted, one compression level, one fixed date: the same save gives the same bytes. */
    fun pack(tree: Map<String, ByteArray>): ByteArray {
        val fixedTime = Calendar.getInstance().apply { clear(); set(1980, Calendar.JANUARY, 1) }.timeInMillis
        val bytes = ByteArrayOutputStream()
        ZipOutputStream(bytes).use { zip ->
            zip.setLevel(6)
            for ((name, data) in canonical(tree)) {
                zip.putNextEntry(ZipEntry(name).apply { time = fixedTime })
                zip.write(data)
                zip.closeEntry()
            }
        }
        return bytes.toByteArray()
    }

    fun unpack(zipBytes: ByteArray): Map<String, ByteArray> {
        val tree = sortedMapOf<String, ByteArray>()
        var total = 0L
        ZipInputStream(ByteArrayInputStream(zipBytes)).use { zip ->
            while (true) {
                val entry = zip.nextEntry ?: break
                val name = entry.name.replace('\\', '/')
                require(!Regex("^([a-zA-Z]:|/)").containsMatchIn(name) && ".." !in name.split('/')) {
                    "El guardado de la nube trae una ruta no permitida"
                }
                val data = zip.readBytes()
                total += data.size
                require(total <= MAX_UNPACKED_BYTES) { "El guardado de la nube es demasiado grande" }
                tree[name] = data
            }
        }
        return tree
    }

    /**
     * Replaces [dir] with [tree], written beside it first and swapped in with a
     * rename, so a failure halfway leaves the old save where it was.
     */
    fun writeTree(dir: File, tree: Map<String, ByteArray>) {
        val staging = File(dir.path + ".incoming").apply { deleteRecursively(); mkdirs() }
        for ((name, data) in tree) {
            val target = File(staging, name)
            if (name.endsWith("/")) {
                target.mkdirs()
            } else {
                target.parentFile?.mkdirs()
                target.writeBytes(data)
            }
        }
        val replaced = File(dir.path + ".replaced").apply { deleteRecursively() }
        if (dir.exists()) check(dir.renameTo(replaced)) { "No se pudo apartar el guardado actual" }
        dir.parentFile?.mkdirs()
        check(staging.renameTo(dir)) { "No se pudo colocar el guardado de la nube" }
        replaced.deleteRecursively()
    }

    /**
     * The newest change anywhere under [dir], in ms since the epoch (0 if
     * none). The core writes straight into these files while the game runs, so
     * one touched a moment ago may be half written.
     */
    fun newestModified(dir: File): Long =
        if (!dir.exists()) 0L else dir.walkTopDown().maxOf { it.lastModified() }

    private fun compareUtf8(a: String, b: String): Int {
        val x = a.toByteArray(Charsets.UTF_8)
        val y = b.toByteArray(Charsets.UTF_8)
        for (i in 0 until minOf(x.size, y.size)) {
            val diff = (x[i].toInt() and 0xFF) - (y[i].toInt() and 0xFF)
            if (diff != 0) return diff
        }
        return x.size - y.size
    }

    private fun read(file: RandomAccessFile, offset: Long, length: Int): ByteArray {
        file.seek(offset)
        return ByteArray(length).also { file.readFully(it) }
    }

    private fun u32(bytes: ByteArray, at: Int): Long =
        (0 until 4).fold(0L) { acc, i -> acc or ((bytes[at + i].toLong() and 0xFF) shl (8 * i)) }

    private fun ascii(bytes: ByteArray, at: Int) = String(bytes, at, 4, Charsets.US_ASCII)
}
