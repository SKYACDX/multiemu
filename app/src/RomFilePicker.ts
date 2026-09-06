import {NativeModules} from 'react-native';

export interface PickedRom {
  base64: string;
  name: string;
  size: number;
}

export interface PickedRomPath {
  path: string;
  name: string;
  size: number;
}

interface RomFilePickerNativeModule {
  pickRom(extensions: string[]): Promise<PickedRom>;
  pickRomPath(extensions: string[]): Promise<PickedRomPath>;
  readFileAsBase64(path: string): Promise<string>;
}

const {RomFilePicker} = NativeModules as {RomFilePicker: RomFilePickerNativeModule};

export class RomPickerCancelledError extends Error {}
export class InvalidRomExtensionError extends Error {}

/**
 * Opens Android's document picker (Storage Access Framework) so the user
 * can pick their own legally-dumped ROM file, restricted to the given
 * extensions (lowercase, no dot -- e.g. ["gb", "gbc"]).
 *
 * SAF can only filter by MIME type, and ROM extensions don't have a
 * registered one, so the picker itself can't be narrowed to show only
 * matching files -- the native side instead validates the extension of
 * whatever gets picked and rejects with a distinguishable error so the
 * caller can show a helpful message instead of a generic failure.
 */
export async function pickRomFile(extensions: string[]): Promise<PickedRom> {
  try {
    return await RomFilePicker.pickRom(extensions);
  } catch (e) {
    const code = (e as {code?: string} | null)?.code;
    if (code === 'CANCELLED') throw new RomPickerCancelledError();
    if (code === 'INVALID_EXTENSION') {
      throw new InvalidRomExtensionError(e instanceof Error ? e.message : String(e));
    }
    throw e;
  }
}

/**
 * Same picker as [pickRomFile], but resolves a path to a cache-file copy
 * instead of a base64 string -- use this for large ROMs (NDS runs
 * 128-512MB) where base64-encoding the whole thing and passing it across
 * the JS bridge as one giant string reliably runs out of memory.
 */
export async function pickRomFilePath(extensions: string[]): Promise<PickedRomPath> {
  try {
    return await RomFilePicker.pickRomPath(extensions);
  } catch (e) {
    const code = (e as {code?: string} | null)?.code;
    if (code === 'CANCELLED') throw new RomPickerCancelledError();
    if (code === 'INVALID_EXTENSION') {
      throw new InvalidRomExtensionError(e instanceof Error ? e.message : String(e));
    }
    throw e;
  }
}

/** Reads back a small file at a plain filesystem path (e.g. from pickRomFilePath) as base64 -- see readFileAsBase64's Kotlin doc comment. */
export function readFileAsBase64(path: string): Promise<string> {
  return RomFilePicker.readFileAsBase64(path);
}
