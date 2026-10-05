package com.multiemu.n3dscore

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class N3dsCloudSaveTest {
    private val save = sortedMapOf(
        "00000001/00000001.sav" to byteArrayOf(1, 2, 3, 4),
        "empty/" to ByteArray(0),
    )

    // The reference value multiemu_exe's save3ds.js gives for this same tree:
    // if this drifts, the two devices stop recognising each other's saves.
    @Test
    fun fingerprintMatchesTheDesktopPort() {
        assertEquals(2018605636L, N3dsCloudSave.fingerprint(save))
    }

    @Test
    fun foldersWithFilesInsideDoNotCount() {
        val withParent = save + ("00000001/" to ByteArray(0))
        assertEquals(N3dsCloudSave.fingerprint(save), N3dsCloudSave.fingerprint(withParent))
    }

    @Test
    fun packAndUnpackKeepTheSave() {
        val packed = N3dsCloudSave.pack(save)
        assertEquals(N3dsCloudSave.fingerprint(save), N3dsCloudSave.fingerprint(N3dsCloudSave.unpack(packed)))
        // Deterministic: the same save gives the same bytes.
        assertTrue(packed.contentEquals(N3dsCloudSave.pack(save)))
    }

    @Test
    fun onlyMetadataIsNoSave() {
        assertFalse(N3dsCloudSave.hasSaveData(mapOf("00000001.metadata" to ByteArray(1024))))
        assertTrue(N3dsCloudSave.hasSaveData(save))
    }

    @Test(expected = IllegalArgumentException::class)
    fun pathsOutsideTheFolderAreRefused() {
        val bytes = ByteArrayOutputStream()
        ZipOutputStream(bytes).use { zip ->
            zip.putNextEntry(ZipEntry("../escape.sav"))
            zip.write(1)
            zip.closeEntry()
        }
        N3dsCloudSave.unpack(bytes.toByteArray())
    }
}
