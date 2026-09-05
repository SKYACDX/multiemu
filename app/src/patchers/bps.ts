// Ported verbatim from romhack-hub (src/lib/patchers/bps.ts).
import {crc32} from './crc32';

class Reader {
  constructor(
    private data: Uint8Array,
    public pos = 0,
  ) {}

  u8(): number {
    return this.data[this.pos++];
  }

  bytes(n: number): Uint8Array {
    const out = this.data.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  // BPS variable-length number (unsigned).
  number(): number {
    let data = 0;
    let shift = 1;
    while (true) {
      const x = this.u8();
      data += (x & 0x7f) * shift;
      if (x & 0x80) break;
      shift <<= 7;
      data += shift;
    }
    return data;
  }

  // Signed relative offset used by SourceCopy/TargetCopy.
  signedNumber(): number {
    const value = this.number();
    const negative = value & 1;
    const magnitude = Math.floor(value / 2);
    return negative ? -magnitude : magnitude;
  }

  u32le(): number {
    const b0 = this.data[this.pos];
    const b1 = this.data[this.pos + 1];
    const b2 = this.data[this.pos + 2];
    const b3 = this.data[this.pos + 3];
    this.pos += 4;
    return (b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)) >>> 0;
  }
}

const ACTION_SOURCE_READ = 0;
const ACTION_TARGET_READ = 1;
const ACTION_SOURCE_COPY = 2;
const ACTION_TARGET_COPY = 3;

export function applyBps(
  source: Uint8Array,
  patch: Uint8Array,
): {output: Uint8Array; sourceCrcMismatch: boolean} {
  if (patch.length < 4 || patch[0] !== 0x42 || patch[1] !== 0x50 || patch[2] !== 0x53 || patch[3] !== 0x31) {
    throw new Error('El archivo no es un parche BPS válido');
  }

  const reader = new Reader(patch, 4);
  const sourceSize = reader.number();
  const targetSize = reader.number();
  const metadataSize = reader.number();
  reader.bytes(metadataSize); // metadata is ignored

  if (sourceSize !== source.length) {
    throw new Error(
      `El tamaño de la ROM base no coincide con el esperado por el parche (esperado ${sourceSize} bytes, se recibieron ${source.length}).`,
    );
  }

  const output = new Uint8Array(targetSize);
  let outputPos = 0;
  let sourceRelativeOffset = 0;
  let targetRelativeOffset = 0;

  const actionsEnd = patch.length - 12; // last 12 bytes are the three CRC32 footers

  while (reader.pos < actionsEnd) {
    const data = reader.number();
    const command = data & 3;
    const length = Math.floor(data / 4) + 1;

    switch (command) {
      case ACTION_SOURCE_READ: {
        output.set(source.subarray(outputPos, outputPos + length), outputPos);
        outputPos += length;
        break;
      }
      case ACTION_TARGET_READ: {
        output.set(reader.bytes(length), outputPos);
        outputPos += length;
        break;
      }
      case ACTION_SOURCE_COPY: {
        sourceRelativeOffset += reader.signedNumber();
        output.set(source.subarray(sourceRelativeOffset, sourceRelativeOffset + length), outputPos);
        outputPos += length;
        sourceRelativeOffset += length;
        break;
      }
      case ACTION_TARGET_COPY: {
        targetRelativeOffset += reader.signedNumber();
        for (let i = 0; i < length; i++) {
          output[outputPos++] = output[targetRelativeOffset++];
        }
        break;
      }
    }
  }

  const footer = new Reader(patch, actionsEnd);
  const sourceCrc = footer.u32le();
  const targetCrc = footer.u32le();

  const sourceCrcMismatch = crc32(source) !== sourceCrc;
  const actualTargetCrc = crc32(output);
  if (actualTargetCrc !== targetCrc) {
    throw new Error('El resultado del parche no coincide con la suma de verificación esperada. El archivo de salida podría estar corrupto.');
  }

  return {output, sourceCrcMismatch};
}
