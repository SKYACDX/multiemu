// Ported verbatim from romhack-hub (src/lib/patchers/ups.ts).
class Reader {
  constructor(
    private data: Uint8Array,
    public pos = 0,
  ) {}

  u8(): number {
    return this.data[this.pos++];
  }

  number(): number {
    let result = 0;
    let shift = 1;
    while (true) {
      const x = this.u8();
      result += (x & 0x7f) * shift;
      if (x & 0x80) break;
      shift <<= 7;
      result += shift;
    }
    return result;
  }
}

export function applyUps(source: Uint8Array, patch: Uint8Array): Uint8Array {
  if (patch.length < 4 || patch[0] !== 0x55 || patch[1] !== 0x50 || patch[2] !== 0x53 || patch[3] !== 0x31) {
    throw new Error('El archivo no es un parche UPS válido');
  }

  const reader = new Reader(patch, 4);
  const inputSize = reader.number();
  const outputSize = reader.number();

  if (source.length !== inputSize) {
    throw new Error(
      `El tamaño de la ROM base no coincide con el esperado por el parche (esperado ${inputSize} bytes, se recibieron ${source.length}).`,
    );
  }

  const maxSize = Math.max(inputSize, outputSize);
  const output = new Uint8Array(maxSize);
  output.set(source);

  const actionsEnd = patch.length - 12; // trailing: input crc32, output crc32, patch crc32
  let pos = 0;

  while (reader.pos < actionsEnd) {
    pos += reader.number();
    while (true) {
      const byte = reader.u8();
      if (byte === 0) {
        pos += 1;
        break;
      }
      output[pos] ^= byte;
      pos += 1;
    }
  }

  return output.slice(0, outputSize);
}
