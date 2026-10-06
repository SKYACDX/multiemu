import {NativeModules} from 'react-native';

export interface CachedRom {
  id: string;
  name: string;
  system: string;
  label: string;
  /** The name inside a DS/3DS game (see RomTitle.kt); '' when it has none. */
  title?: string;
  size: number;
  savedAt: number;
}

export interface FolderFile {
  uri: string;
  name: string;
  size: number;
}

export interface StateSlot {
  slot: number;
  exists: boolean;
  savedAt?: number;
}

interface RomLibraryNativeModule {
  saveToCache(base64: string, name: string, system: string, label: string): Promise<CachedRom>;
  saveToCachePath(path: string, name: string, system: string, label: string): Promise<CachedRom & {path: string}>;
  listCache(): Promise<CachedRom[]>;
  loadFromCache(id: string): Promise<{base64: string}>;
  loadPathFromCache(id: string): Promise<{path: string}>;
  dsSaveId(path: string, legacyId: string): Promise<string>;
  romCrc32(path: string): Promise<string>;
  romTitle(path: string, system: string): Promise<string | null>;
  pickSaveToImport(target: string, romId: string, label: string): Promise<{base64: string; note: string | null}>;
  takePendingSaveImport(): Promise<{label: string; note: string | null} | null>;
  commitPendingSaveImport(confirm: boolean): Promise<void>;
  exportSave(romId: string, suggestedName: string): Promise<void>;
  writeCloudBackup(romId: string, base64: string): Promise<void>;
  deleteFromCache(id: string): Promise<void>;
  pickFolder(): Promise<{uri: string; name: string}>;
  getLastFolder(): Promise<{uri: string; name: string} | null>;
  listFolder(folderUri: string, extensions: string[]): Promise<FolderFile[]>;
  readFileFromFolder(fileUri: string, extensions: string[]): Promise<{base64: string; name: string; size: number}>;
  saveStateSlot(romId: string, slot: number, base64: string): Promise<void>;
  loadStateSlot(romId: string, slot: number): Promise<{base64: string}>;
  listStateSlots(romId: string): Promise<StateSlot[]>;
  deleteStateSlot(romId: string, slot: number): Promise<void>;
  saveAuthSession(token: string, username: string): Promise<void>;
  getAuthSession(): Promise<{token: string; username: string} | null>;
  clearAuthSession(): Promise<void>;
  getPreference(key: string): Promise<string | null>;
  setPreference(key: string, value: string): Promise<void>;
  getAppVersionCode(): Promise<number>;
  getAppVersionName(): Promise<string>;
}

const {RomLibrary} = NativeModules as {RomLibrary: RomLibraryNativeModule};

export class FolderPickerCancelledError extends Error {}

/** Caches a loaded ROM on-device so it can be reopened instantly next time (see RomLibraryModule.kt). */
export function saveRomToCache(base64: string, name: string, system: string, label: string): Promise<CachedRom> {
  return RomLibrary.saveToCache(base64, name, system, label);
}

/** Path-based sibling of saveRomToCache for ROMs too large for base64/JS memory (NDS: 128-512MB) -- moves the file already at `path` into the cache and returns its new path. */
export function saveRomToCachePath(path: string, name: string, system: string, label: string): Promise<CachedRom & {path: string}> {
  return RomLibrary.saveToCachePath(path, name, system, label);
}

export function listCachedRoms(): Promise<CachedRom[]> {
  return RomLibrary.listCache();
}

export async function loadCachedRom(id: string): Promise<string> {
  const {base64} = await RomLibrary.loadFromCache(id);
  return base64;
}

export async function loadCachedRomPath(id: string): Promise<string> {
  const {path} = await RomLibrary.loadPathFromCache(id);
  return path;
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

/** The folder from the last pickRomFolder() call, or null if none yet (or its permission was revoked). */
export function getLastFolder(): Promise<{uri: string; name: string} | null> {
  return RomLibrary.getLastFolder();
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

/** 3 manual save-state slots per ROM (romId = its CRC32), independent of where in the game you are. */
export function saveStateSlot(romId: string, slot: number, base64: string): Promise<void> {
  return RomLibrary.saveStateSlot(romId, slot, base64);
}

export async function loadStateSlot(romId: string, slot: number): Promise<string> {
  const {base64} = await RomLibrary.loadStateSlot(romId, slot);
  return base64;
}

export function listStateSlots(romId: string): Promise<StateSlot[]> {
  return RomLibrary.listStateSlots(romId);
}

export function deleteStateSlot(romId: string, slot: number): Promise<void> {
  return RomLibrary.deleteStateSlot(romId, slot);
}

/** RomHack Hub account session (bearer token), persisted so login survives a restart. */
export function saveAuthSession(token: string, username: string): Promise<void> {
  return RomLibrary.saveAuthSession(token, username);
}

export function getAuthSession(): Promise<{token: string; username: string} | null> {
  return RomLibrary.getAuthSession();
}

export function clearAuthSession(): Promise<void> {
  return RomLibrary.clearAuthSession();
}

/** Small persisted string, e.g. App.tsx's per-system custom control layout (JSON). Returns null if never set. */
export function getPreference(key: string): Promise<string | null> {
  return RomLibrary.getPreference(key);
}

export function setPreference(key: string, value: string): Promise<void> {
  return RomLibrary.setPreference(key, value);
}

/** android.defaultConfig.versionCode of the running build -- see docs/update-check.md. */
export function getAppVersionCode(): Promise<number> {
  return RomLibrary.getAppVersionCode();
}

export function getAppVersionName(): Promise<string> {
  return RomLibrary.getAppVersionName();
}

/** The id Android used for a DS game's save before 1.17: "<name>-<size>". */
export const legacyDsSaveId = (name: string, size: number) => `${name}-${size}`.replace(/[^a-zA-Z0-9_.-]/g, '_');

/**
 * A DS game's save id, the ROM's CRC32 (the desktop app's key -- see
 * RomLibraryModule.dsSaveId); moves a save kept under the old id over.
 */
export function dsSaveId(path: string, legacyId: string): Promise<string> {
  return RomLibrary.dsSaveId(path, legacyId);
}

/** A ROM file's CRC32, unpadded hex -- a GB/GBA/DS game's cloud key, computed natively. */
export function romCrc32(path: string): Promise<string> {
  return RomLibrary.romCrc32(path);
}

/** The game's name for its cloud saves, read from the ROM (never the file name); null if none. */
export function romTitle(path: string, system: string): Promise<string | null> {
  return RomLibrary.romTitle(path, system);
}

/**
 * Lets the user pick a save file from another emulator (system picker) and
 * converts it for target ("gb" | "gba" | "nds") -- see SaveNormalizer.kt.
 * Rejects with a message for the user; code "CANCELLED" if they backed out.
 */
export function pickSaveToImport(target: string, romId: string, label: string): Promise<{base64: string; note: string | null}> {
  return RomLibrary.pickSaveToImport(target, romId, label);
}

/** An import a restart interrupted (see PendingSaveImport.kt), read and converted natively; null if none. */
export function takePendingSaveImport(): Promise<{label: string; note: string | null} | null> {
  return RomLibrary.takePendingSaveImport();
}

/** The user's answer to a recovered import: true writes it as the game's save (only while no game is running). */
export function commitPendingSaveImport(confirm: boolean): Promise<void> {
  return RomLibrary.commitPendingSaveImport(confirm);
}

/** Copies the game's save to a file the user creates (system picker). */
export function exportSave(romId: string, suggestedName: string): Promise<void> {
  return RomLibrary.exportSave(romId, suggestedName);
}

/** Keeps the cloud's copy of a game save locally before an import replaces it there. */
export function writeCloudBackup(romId: string, base64: string): Promise<void> {
  return RomLibrary.writeCloudBackup(romId, base64);
}
