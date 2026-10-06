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

/**
 * The name inside a DS game's banner -- every line but the last (the
 * publisher), Spanish if the game has it, else English -- like RomTitle.kt
 * and the desktop app. Null without a banner.
 */
export function dsBannerTitle(bytes: Uint8Array): string | null {
  if (bytes.length < 0x6c) return null;
  const banner = (bytes[0x68] | (bytes[0x69] << 8) | (bytes[0x6a] << 16) | (bytes[0x6b] << 24)) >>> 0;
  if (!banner) return null;
  for (const language of [5, 1]) {
    const at = banner + 0x240 + language * 0x100;
    if (bytes.length < at + 0x100) continue;
    let text = '';
    for (let i = 0; i < 0x100; i += 2) {
      const unit = bytes[at + i] | (bytes[at + i + 1] << 8);
      if (!unit) break;
      text += String.fromCharCode(unit);
    }
    const lines = text.trim().split('\n');
    const name = (lines.length > 1 ? lines.slice(0, -1) : lines).join(' ').replace(/\s+/g, ' ').trim();
    if (name) return name;
  }
  return null;
}

/** A ROM file name without its extension, a leading "1234 - " or anything in ( ) / [ ] -- like the desktop app's library. */
export function tidyRomFileName(name: string): string {
  const tidy = name
    .replace(/\.[^.]+$/, '')
    .replace(/^\d+\s+-\s+/, '')
    .replace(/\s*[([][^)\]]*[)\]]/g, '')
    .trim();
  return tidy || name;
}
