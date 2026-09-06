import {NativeModules} from 'react-native';

export interface CachedRom {
  id: string;
  name: string;
  system: string;
  label: string;
  size: number;
  savedAt: number;
}

export interface FolderFile {
  uri: string;
  name: string;
  size: number;
}

interface RomLibraryNativeModule {
  saveToCache(base64: string, name: string, system: string, label: string): Promise<CachedRom>;
  listCache(): Promise<CachedRom[]>;
  loadFromCache(id: string): Promise<{base64: string}>;
  deleteFromCache(id: string): Promise<void>;
  pickFolder(): Promise<{uri: string; name: string}>;
  listFolder(folderUri: string, extensions: string[]): Promise<FolderFile[]>;
  readFileFromFolder(fileUri: string, extensions: string[]): Promise<{base64: string; name: string; size: number}>;
}

const {RomLibrary} = NativeModules as {RomLibrary: RomLibraryNativeModule};

export class FolderPickerCancelledError extends Error {}

/** Caches a loaded ROM on-device so it can be reopened instantly next time (see RomLibraryModule.kt). */
export function saveRomToCache(base64: string, name: string, system: string, label: string): Promise<CachedRom> {
  return RomLibrary.saveToCache(base64, name, system, label);
}

export function listCachedRoms(): Promise<CachedRom[]> {
  return RomLibrary.listCache();
}

export async function loadCachedRom(id: string): Promise<string> {
  const {base64} = await RomLibrary.loadFromCache(id);
  return base64;
}

export function deleteCachedRom(id: string): Promise<void> {
  return RomLibrary.deleteFromCache(id);
}

export async function pickRomFolder(): Promise<{uri: string; name: string}> {
  try {
    return await RomLibrary.pickFolder();
  } catch (e) {
    const code = (e as {code?: string} | null)?.code;
    if (code === 'CANCELLED') throw new FolderPickerCancelledError();
    throw e;
  }
}

export function listRomFolder(folderUri: string, extensions: string[]): Promise<FolderFile[]> {
  return RomLibrary.listFolder(folderUri, extensions);
}

export function readRomFromFolder(
  fileUri: string,
  extensions: string[],
): Promise<{base64: string; name: string; size: number}> {
  return RomLibrary.readFileFromFolder(fileUri, extensions);
}
