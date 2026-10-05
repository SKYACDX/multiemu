package com.multiemu.gbcore

import java.io.File
import java.io.RandomAccessFile

/**
 * The name a DS or 3DS game carries inside it, for Recientes -- "Pokémon
 * SoulSilver" rather than "4833 - Pokemon - Edicion Plata SoulSilver
 * (Spain).nds". Same rules as the desktop app (multiemu_exe src/hub.js,
 * dsTitle/n3dsTitle), so both show the same names: Spanish if the game has
 * it, else English. Null when there is none (GB/GBA headers only carry a
 * short uppercase code, an encrypted 3DS ROM hides its icon); the caller
 * then tidies the file name instead.
 */
object RomTitle {
    private const val SPANISH = 5
    private const val ENGLISH = 1

    fun read(file: File, system: String): String? = runCatching {
        RandomAccessFile(file, "r").use { rom ->
            when (system) {
                "nds" -> ds(rom)
                "3ds" -> n3ds(rom)
                else -> null
            }
        }
    }.getOrNull()

    /** The banner (offset at 0x68): six 0x100-byte UTF-16 titles from +0x240, the last line being the publisher. */
    private fun ds(rom: RandomAccessFile): String? {
        val banner = u32(bytes(rom, 0x68, 4), 0)
        if (banner == 0L) return null
        val titles = bytes(rom, banner + 0x240, 6 * 0x100)
        for (language in intArrayOf(SPANISH, ENGLISH)) {
            if (titles.size < (language + 1) * 0x100) continue
            val lines = utf16(titles, language * 0x100, 0x100).split('\n')
            val name = (if (lines.size > 1) lines.dropLast(1) else lines).joinToString(" ").squash()
            if (name.isNotEmpty()) return name
        }
        return null
    }

    /** The SMDH (ExeFS "icon"): short titles at 0x8 + language * 0x200, 0x80 bytes each. */
    private fun n3ds(rom: RandomAccessFile): String? {
        val outer = bytes(rom, 0, 0x200)
        val magic = String(outer, 0x100, 4, Charsets.US_ASCII)
        val ncch = when (magic) {
            "NCSD" -> u32(outer, 0x120) * 0x200
            "NCCH" -> 0L
            else -> return null
        }
        val header = bytes(rom, ncch, 0x200)
        // 0x04 at 0x18F is NoCrypto: an encrypted ExeFS can't be read.
        if (String(header, 0x100, 4, Charsets.US_ASCII) != "NCCH" || header[0x18F].toInt() and 0x04 == 0) return null
        val exefs = ncch + u32(header, 0x1A0) * 0x200
        val files = bytes(rom, exefs, 0x200)
        for (i in 0 until 10) {
            if (String(files, i * 16, 8, Charsets.US_ASCII).trimEnd('\u0000') != "icon") continue
            val smdh = bytes(rom, exefs + 0x200 + u32(files, i * 16 + 8), 0x2040)
            if (String(smdh, 0, 4, Charsets.US_ASCII) != "SMDH") return null
            for (language in intArrayOf(SPANISH, ENGLISH)) {
                val name = utf16(smdh, 0x8 + language * 0x200, 0x80).squash()
                if (name.isNotEmpty()) return name
            }
            return null
        }
        return null
    }

    private fun bytes(rom: RandomAccessFile, offset: Long, length: Int): ByteArray {
        val out = ByteArray(length)
        rom.seek(offset)
        val read = rom.read(out)
        return if (read == length) out else out.copyOf(maxOf(read, 0))
    }

    private fun u32(b: ByteArray, at: Int): Long =
        (b[at].toLong() and 0xFF) or ((b[at + 1].toLong() and 0xFF) shl 8) or
            ((b[at + 2].toLong() and 0xFF) shl 16) or ((b[at + 3].toLong() and 0xFF) shl 24)

    /** UTF-16LE up to the first NUL. */
    private fun utf16(b: ByteArray, at: Int, length: Int): String =
        String(b, at, length, Charsets.UTF_16LE).substringBefore('\u0000').trim()

    private fun String.squash() = replace(Regex("\\s+"), " ").trim()
}
