package com.multiemu.gbcore

/**
 * Turns a save file from another emulator into the bytes our cores read,
 * or explains why it can't. The spec, shared with the desktop app's JS
 * version, is "Especificación del normalizador (v1)" in docs/save-import.md
 * -- keep the two in step, test vectors included.
 *
 * Only wrappers are removed (a DeSmuME footer, a NO$GBA header, a RetroArch
 * combined .srm, a GBA clock the DS doesn't use); the save data itself is
 * never interpreted. Every size outside the valid set for the target is
 * refused rather than guessed at.
 */
object SaveNormalizer {
    sealed class Result {
        class Ok(val bytes: ByteArray, val note: String?) : Result()
        class Error(val message: String) : Result()
    }

    private const val K = 1024
    private val GB_SIZES = setOf(512, 2 * K, 8 * K, 32 * K, 64 * K, 128 * K)
    private val GBA_SIZES = setOf(512, 8 * K, 32 * K, 64 * K, 128 * K)
    private val NDS_SIZES = setOf(512, 8 * K, 32 * K) + (6..15).map { (64 * K) shl (it - 6) }.toSet()
    private const val GBA_CLOCK = 16
    private const val VBA_COMBINED = 0x22000
    private const val DESMUME_FOOTER = 122
    private val DESMUME_MAGIC = "|-DESMUME SAVE-|".toByteArray(Charsets.US_ASCII)
    private val NOCASH_MAGIC = "NocashGbaBackupMediaSavDataFile".toByteArray(Charsets.US_ASCII)
    private const val NOCASH_DATA = 0x4C

    private val NAMES = mapOf(
        "gb" to "Game Boy",
        "gba" to "Game Boy Advance",
        "nds" to "Nintendo DS",
        "nds-slot2" to "Game Boy Advance (ranura del DS)",
    )

    fun normalize(input: ByteArray, target: String): Result {
        if (input.isEmpty()) return Result.Error("Ese archivo está vacío.")
        val badSize = Result.Error(
            "Ese archivo no tiene el tamaño de un guardado de ${NAMES[target] ?: target} (${input.size} bytes).",
        )
        var data = input
        var note: String? = null
        when (target) {
            "gb" -> {
                if (data.size !in GB_SIZES && data.size - 44 !in GB_SIZES && data.size - 48 !in GB_SIZES) return badSize
            }
            "gba" -> {
                if (data.size == VBA_COMBINED) {
                    val sram = data.copyOfRange(0, 0x20000)
                    data = if (sram.any { it != 0xFF.toByte() }) sram else data.copyOfRange(0x20000, VBA_COMBINED)
                    note = "Convertido desde RetroArch (VBA)."
                }
                if (data.size !in GBA_SIZES && data.size - GBA_CLOCK !in GBA_SIZES) return badSize
            }
            "nds" -> {
                if (data.size >= DESMUME_FOOTER && endsWith(data, DESMUME_MAGIC)) {
                    data = data.copyOf(data.size - DESMUME_FOOTER)
                    note = "Convertido desde DeSmuME/DraStic."
                } else if (startsWith(data, NOCASH_MAGIC)) {
                    if (data.size < NOCASH_DATA) return badSize
                    if (u32(data, 0x44) != 0L) {
                        return Result.Error("Es un guardado comprimido de NO\$GBA. En NO\$GBA, guárdalo sin compresión e inténtalo de nuevo.")
                    }
                    data = data.copyOfRange(NOCASH_DATA, data.size)
                    note = "Convertido desde NO\$GBA."
                }
                if (data.size !in NDS_SIZES) return badSize
            }
            "nds-slot2" -> {
                if (data.size != 128 * K + GBA_CLOCK && data.size - GBA_CLOCK in GBA_SIZES) {
                    data = data.copyOf(data.size - GBA_CLOCK)
                    note = "Se quitó el reloj del cartucho (el DS no lo usa)."
                }
                if (data.size !in GBA_SIZES && data.size != 128 * K + GBA_CLOCK) return badSize
            }
            else -> return Result.Error("Sistema desconocido: $target")
        }
        if (data.all { it == 0xFF.toByte() } || data.all { it == 0.toByte() }) {
            note = listOfNotNull(note, "Ojo: el guardado parece vacío.").joinToString(" ")
        }
        return Result.Ok(data, note)
    }

    private fun startsWith(data: ByteArray, prefix: ByteArray) =
        data.size >= prefix.size && prefix.indices.all { data[it] == prefix[it] }

    private fun endsWith(data: ByteArray, suffix: ByteArray) =
        data.size >= suffix.size && suffix.indices.all { data[data.size - suffix.size + it] == suffix[it] }

    private fun u32(b: ByteArray, at: Int): Long =
        (b[at].toLong() and 0xFF) or ((b[at + 1].toLong() and 0xFF) shl 8) or
            ((b[at + 2].toLong() and 0xFF) shl 16) or ((b[at + 3].toLong() and 0xFF) shl 24)
}
