// Ported verbatim from romhack-hub (src/lib/patchers/ips.ts).
const HEADER = [0x50, 0x41, 0x54, 0x43, 0x48]; // "PATCH"
const EOF = [0x45, 0x4f, 0x46]; // "EOF"

export function applyIps(rom: Uint8Array, patch: Uint8Array): Uint8Array {
  if (patch.length < 8 || !HEADER.every((b, i) => patch[i] === b)) {
    throw new Error('El archivo no es un parche IPS válido');
  }

  // Grow-as-needed output buffer, starting as a copy of the source ROM.
  let output = new Uint8Array(rom.length);
  output.set(rom);

  function ensureSize(size: number) {
    if (size <= output.length) return;
    const grown = new Uint8Array(size);
    grown.set(output);
    output = grown;
  }

  let pos = 5;
  while (true) {
    if (pos + 3 > patch.length) {
      throw new Error('Parche IPS corrupto: falta el marcador EOF');
    }
    if (EOF.every((b, i) => patch[pos + i] === b)) {
      pos += 3;
      break;
    }

    const offset = (patch[pos] << 16) | (patch[pos + 1] << 8) | patch[pos + 2];
    pos += 3;
    const size = (patch[pos] << 8) | patch[pos + 1];
    pos += 2;

    if (size === 0) {
      // RLE record
      const rleSize = (patch[pos] << 8) | patch[pos + 1];
      pos += 2;
      const value = patch[pos];
      pos += 1;
      ensureSize(offset + rleSize);
      output.fill(value, offset, offset + rleSize);
    } else {
      ensureSize(offset + size);
      output.set(patch.subarray(pos, pos + size), offset);
      pos += size;
    }
  }

  // Optional truncation extension: 3 trailing bytes = new file length.
  if (pos + 3 === patch.length) {
    const truncatedLength = (patch[pos] << 16) | (patch[pos + 1] << 8) | patch[pos + 2];
    if (truncatedLength <= output.length) {
      output = output.slice(0, truncatedLength);
    }
  }

  return output;
}
