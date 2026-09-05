// Ported from romhack-hub (src/lib/patchers/index.ts).
import {applyIps} from './ips';
import {applyBps} from './bps';
import {applyUps} from './ups';

export type SupportedPatchExt = 'ips' | 'bps' | 'ups';

export function detectPatchExt(format: string): SupportedPatchExt | null {
  const ext = format.toLowerCase();
  if (ext === 'ips' || ext === 'bps' || ext === 'ups') return ext;
  return null;
}

export function applyPatch(
  romBytes: Uint8Array,
  patchBytes: Uint8Array,
  ext: SupportedPatchExt,
): {output: Uint8Array; warning?: string} {
  switch (ext) {
    case 'ips':
      return {output: applyIps(romBytes, patchBytes)};
    case 'ups':
      return {output: applyUps(romBytes, patchBytes)};
    case 'bps': {
      const {output, sourceCrcMismatch} = applyBps(romBytes, patchBytes);
      return {
        output,
        warning: sourceCrcMismatch
          ? 'La suma de verificación de la ROM base no coincide con la esperada por el parche. El resultado podría no ser el correcto.'
          : undefined,
      };
    }
  }
}
