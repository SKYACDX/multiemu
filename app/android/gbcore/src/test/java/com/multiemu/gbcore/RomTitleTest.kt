package com.multiemu.gbcore

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.io.File

class RomTitleTest {
    private fun rom(size: Int, fill: (ByteArray) -> Unit): File =
        File.createTempFile("rom", null).apply {
            deleteOnExit()
            writeBytes(ByteArray(size).also(fill))
        }

    private fun ByteArray.u32(at: Int, value: Int) {
        for (i in 0 until 4) this[at + i] = (value shr (8 * i)).toByte()
    }

    private fun ByteArray.text(at: Int, value: String, charset: java.nio.charset.Charset = Charsets.UTF_16LE) =
        value.toByteArray(charset).copyInto(this, at)

    private fun ds(spanish: String, english: String) = rom(0x1000) {
        it.u32(0x68, 0x400)
        it.text(0x400 + 0x240 + 1 * 0x100, english)
        it.text(0x400 + 0x240 + 5 * 0x100, spanish)
    }

    @Test
    fun dsUsesSpanishWithoutThePublisherLine() =
        assertEquals("Pokémon Plata SoulSilver", RomTitle.read(ds("Pokémon Plata\nSoulSilver\nNintendo", "Pokémon SoulSilver\nNintendo"), "nds"))

    @Test
    fun dsFallsBackToEnglish() = assertEquals("Pokémon SoulSilver", RomTitle.read(ds("", "Pokémon SoulSilver\nNintendo"), "nds"))

    private fun n3ds(noCrypto: Boolean) = rom(0x4000) {
        it.text(0x100, "NCSD", Charsets.US_ASCII)
        it.u32(0x120, 1) // partition 0 at 0x200
        it.text(0x200 + 0x100, "NCCH", Charsets.US_ASCII)
        if (noCrypto) it[0x200 + 0x18F] = 0x04
        it.u32(0x200 + 0x1A0, 2) // ExeFS at 0x200 + 2 * 0x200
        it.text(0x600, "icon", Charsets.US_ASCII)
        it.u32(0x600 + 8, 0) // first file right after the ExeFS header
        it.text(0x800, "SMDH", Charsets.US_ASCII)
        it.text(0x800 + 0x8 + 5 * 0x200, "Pokémon Y")
    }

    @Test
    fun n3dsReadsTheSmdhTitle() = assertEquals("Pokémon Y", RomTitle.read(n3ds(noCrypto = true), "3ds"))

    @Test
    fun encrypted3dsHasNone() = assertNull(RomTitle.read(n3ds(noCrypto = false), "3ds"))

    @Test
    fun otherSystemsHaveNone() = assertNull(RomTitle.read(ds("x", "x"), "gba"))
}
