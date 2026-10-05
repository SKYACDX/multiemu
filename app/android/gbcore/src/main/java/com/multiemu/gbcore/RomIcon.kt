package com.multiemu.gbcore

import android.graphics.Bitmap
import android.util.Base64
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.RandomAccessFile

/**
 * The icon a DS or 3DS game carries inside its own ROM (what the console's
 * menu shows), as a PNG data URL -- the in-game background when RomHack
 * Hub has no cover art for the game. Read with seeks, never the whole
 * file: a 3DS ROM is 1-4GB. Null when there is no readable icon (an
 * encrypted 3DS dump, a homebrew without a banner).
 */
object RomIcon {
    fun dataUrl(path: String): String? {
        val bitmap = runCatching {
            // By content, not extension: the copies Recents keeps have none.
            RandomAccessFile(File(path), "r").use { file ->
                when (magic(file, 0x100)) {
                    "NCSD", "NCCH" -> n3dsIcon(file)
                    else -> ndsIcon(file)
                }
            }
        }.getOrNull() ?: return null
        val png = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, png)
        return "data:image/png;base64," + Base64.encodeToString(png.toByteArray(), Base64.NO_WRAP)
    }

    /** DS banner (GBATEK): 32x32, 4bpp in 8x8 tiles, 16-colour BGR555 palette. */
    private fun ndsIcon(file: RandomAccessFile): Bitmap? {
        val bannerOffset = readU32(file, 0x68)
        if (bannerOffset == 0L || bannerOffset + 0x240 > file.length()) return null
        val tiles = readBytes(file, bannerOffset + 0x20, 0x200)
        val paletteBytes = readBytes(file, bannerOffset + 0x220, 0x20)
        val palette = IntArray(16) { i ->
            val c = (paletteBytes[i * 2].toInt() and 0xFF) or ((paletteBytes[i * 2 + 1].toInt() and 0xFF) shl 8)
            rgb555((c and 0x1F), (c shr 5) and 0x1F, (c shr 10) and 0x1F)
        }
        val pixels = IntArray(32 * 32)
        for (i in 0 until 0x200) {
            val tile = i / 32
            val inTile = i % 32
            val x = (tile % 4) * 8 + (inTile % 4) * 2
            val y = (tile / 4) * 8 + inTile / 4
            val byte = tiles[i].toInt() and 0xFF
            pixels[y * 32 + x] = palette[byte and 0x0F]
            pixels[y * 32 + x + 1] = palette[byte shr 4]
        }
        return Bitmap.createBitmap(pixels, 32, 32, Bitmap.Config.ARGB_8888)
    }

    /**
     * 3DS: NCSD (a .3ds/.cci) -> its first NCCH (a .cxi starts with one)
     * -> ExeFS -> the "icon" file, an SMDH whose large icon is 48x48
     * RGB565 at 0x24C0, in 8x8 tiles with pixels in Morton order.
     */
    private fun n3dsIcon(file: RandomAccessFile): Bitmap? {
        val ncch = when {
            magic(file, 0x100) == "NCSD" -> readU32(file, 0x120) * 0x200
            magic(file, 0x100) == "NCCH" -> 0L
            else -> return null
        }
        if (magic(file, ncch + 0x100) != "NCCH") return null
        val exefs = ncch + readU32(file, ncch + 0x1A0) * 0x200
        val header = readBytes(file, exefs, 0xA0)  // 10 entries: name[8], offset, size
        for (entry in 0 until 10) {
            val name = String(header, entry * 16, 8, Charsets.US_ASCII).trimEnd('\u0000')
            if (name != "icon") continue
            val smdh = exefs + 0x200 + u32(header, entry * 16 + 8)
            if (magic(file, smdh) != "SMDH") return null  // still encrypted
            val data = readBytes(file, smdh + 0x24C0, 48 * 48 * 2)
            val pixels = IntArray(48 * 48)
            for (i in 0 until 48 * 48) {
                val tile = i / 64
                val m = i % 64
                // Morton order: x from the even bits, y from the odd ones.
                val x = (tile % 6) * 8 + ((m and 1) or ((m shr 1) and 2) or ((m shr 2) and 4))
                val y = (tile / 6) * 8 + (((m shr 1) and 1) or ((m shr 2) and 2) or ((m shr 3) and 4))
                val c = (data[i * 2].toInt() and 0xFF) or ((data[i * 2 + 1].toInt() and 0xFF) shl 8)
                val r = (c shr 11) and 0x1F
                val g = (c shr 5) and 0x3F
                val b = c and 0x1F
                pixels[y * 48 + x] = (0xFF shl 24) or (((r shl 3) or (r shr 2)) shl 16) or
                    (((g shl 2) or (g shr 4)) shl 8) or ((b shl 3) or (b shr 2))
            }
            return Bitmap.createBitmap(pixels, 48, 48, Bitmap.Config.ARGB_8888)
        }
        return null
    }

    private fun rgb555(r: Int, g: Int, b: Int) =
        (0xFF shl 24) or (((r shl 3) or (r shr 2)) shl 16) or (((g shl 3) or (g shr 2)) shl 8) or ((b shl 3) or (b shr 2))

    private fun readBytes(file: RandomAccessFile, offset: Long, length: Int): ByteArray {
        val bytes = ByteArray(length)
        file.seek(offset)
        file.readFully(bytes)
        return bytes
    }

    private fun u32(bytes: ByteArray, at: Int): Long =
        (0 until 4).fold(0L) { acc, i -> acc or ((bytes[at + i].toLong() and 0xFF) shl (8 * i)) }

    private fun readU32(file: RandomAccessFile, offset: Long): Long = u32(readBytes(file, offset, 4), 0)

    private fun magic(file: RandomAccessFile, offset: Long): String =
        String(readBytes(file, offset, 4), Charsets.US_ASCII)
}
