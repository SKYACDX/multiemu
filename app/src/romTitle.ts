/**
 * Reads the internal game title from a ROM's own header -- plain ASCII
 * metadata baked into every cartridge dump, not copyrighted content
 * itself, and used only as a search query against RomHack Hub's public
 * files API to find cover art (see api/romHackHub.ts's findCoverArt).
 */
export function readRomTitle(bytes: Uint8Array, extension: string): string {
  if (extension.toLowerCase() === 'gba') {
    // GBA header: 12-byte ASCII title at offset 0xA0.
    return decodeAscii(bytes, 0xa0, 12);
  }
  if (extension.toLowerCase() === 'nds') {
    // NDS header: 12-byte ASCII title at offset 0x00 (GBATEK).
    return decodeAscii(bytes, 0x00, 12);
  }
  // GB/GBC header: 16-byte title field (last byte or two get reused for
  // the CGB flag/manufacturer code on newer carts, but trimming trailing
  // non-printable/null bytes handles that fine either way) at 0x134.
  return decodeAscii(bytes, 0x134, 16);
}

function decodeAscii(bytes: Uint8Array, offset: number, length: number): string {
  if (bytes.length < offset + length) return '';
  let result = '';
  for (let i = offset; i < offset + length; i++) {
    const byte = bytes[i];
    if (byte >= 0x20 && byte <= 0x7e) {
      result += String.fromCharCode(byte);
    } else if (byte === 0) {
      break;
    }
  }
  return result.trim();
}
