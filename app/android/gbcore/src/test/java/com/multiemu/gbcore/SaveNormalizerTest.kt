package com.multiemu.gbcore

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** One synthetic file per row and error of the spec (docs/save-import.md); the JS version uses the same vectors. */
class SaveNormalizerTest {
    private val k = 1024

    private fun filled(size: Int, value: Int = 0x5A) = ByteArray(size) { value.toByte() }

    private fun ok(input: ByteArray, target: String): SaveNormalizer.Result.Ok {
        val result = SaveNormalizer.normalize(input, target)
        assertTrue("expected Ok, got ${(result as? SaveNormalizer.Result.Error)?.message}", result is SaveNormalizer.Result.Ok)
        return result as SaveNormalizer.Result.Ok
    }

    private fun error(input: ByteArray, target: String): String {
        val result = SaveNormalizer.normalize(input, target)
        assertTrue("expected Error", result is SaveNormalizer.Result.Error)
        return (result as SaveNormalizer.Result.Error).message
    }

    @Test
    fun gbRawAndClockFootersPassThrough() {
        for (size in listOf(8 * k, 32 * k, 32 * k + 48, 8 * k + 44)) {
            val out = ok(filled(size), "gb")
            assertEquals(size, out.bytes.size)
            assertNull(out.note)
        }
        assertTrue(error(filled(10_000), "gb").contains("10000 bytes"))
    }

    @Test
    fun gbaKeepsMgbaClockAndUnpacksVbaSrm() {
        assertEquals(128 * k + 16, ok(filled(128 * k + 16), "gba").bytes.size)
        val withSram = filled(0x22000, 0xFF).also { it[5] = 1 }
        assertEquals(0x20000, ok(withSram, "gba").bytes.size)
        val eepromOnly = filled(0x22000, 0xFF).also { it[0x20000] = 1 }
        val out = ok(eepromOnly, "gba")
        assertEquals(0x2000, out.bytes.size)
        assertEquals("Convertido desde RetroArch (VBA).", out.note)
        error(filled(100 * k), "gba")
    }

    @Test
    fun ndsStripsDesmumeFooter() {
        val raw = filled(512 * k)
        val footer = ByteArray(122).also { "|-DESMUME SAVE-|".toByteArray().copyInto(it, 122 - 16) }
        val out = ok(raw + footer, "nds")
        assertEquals(512 * k, out.bytes.size)
        assertEquals("Convertido desde DeSmuME/DraStic.", out.note)
        assertEquals(8 * 1024 * k, ok(filled(8 * 1024 * k), "nds").bytes.size)
    }

    @Test
    fun ndsReadsUncompressedNocashAndRefusesCompressed() {
        val header = ByteArray(0x4C).also { "NocashGbaBackupMediaSavDataFile".toByteArray().copyInto(it) }
        val out = ok(header + filled(64 * k), "nds")
        assertEquals(64 * k, out.bytes.size)
        assertEquals("Convertido desde NO\$GBA.", out.note)
        val compressed = header.copyOf().also { it[0x44] = 1 }
        assertTrue(error(compressed + filled(100), "nds").contains("comprimido"))
    }

    @Test
    fun slot2DropsTheClockExceptAt128kPlus16() {
        val out = ok(filled(8 * k + 16), "nds-slot2")
        assertEquals(8 * k, out.bytes.size)
        assertEquals("Se quitó el reloj del cartucho (el DS no lo usa).", out.note)
        assertEquals(128 * k + 16, ok(filled(128 * k + 16), "nds-slot2").bytes.size)
    }

    @Test
    fun emptyAndBlankFiles() {
        assertEquals("Ese archivo está vacío.", error(ByteArray(0), "gba"))
        assertEquals("Ojo: el guardado parece vacío.", ok(filled(8 * k, 0xFF), "gb").note)
    }
}
