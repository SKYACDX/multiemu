import {NativeModules} from 'react-native';

interface EmulatorControlNativeModule {
  saveGbaState(): Promise<string>;
  loadGbaState(base64: string): Promise<void>;
  getAudioDebugInfo(): Promise<string>;
  getGameSaveBytes(romId: string): Promise<string>;
  setGameSaveBytes(romId: string, base64: string): Promise<void>;
}

interface DsEmulatorControlNativeModule {
  saveDsState(): Promise<string>;
  loadDsState(base64: string): Promise<void>;
  insertGbaCart(gbaRomPath: string, gbaRomId: string | null): Promise<void>;
  ejectGbaCart(): Promise<void>;
}

const {EmulatorControl} = NativeModules as {EmulatorControl: EmulatorControlNativeModule};
const {DsEmulatorControl} = NativeModules as {DsEmulatorControl: DsEmulatorControlNativeModule};

/**
 * Full emulator state (not just cartridge save RAM) for whichever GBA
 * ROM is currently on screen -- see EmulatorControlModule.kt. GB/GBC has
 * no equivalent yet (gbcore doesn't implement full-state serialization).
 */
export function saveGbaState(): Promise<string> {
  return EmulatorControl.saveGbaState();
}

export function loadGbaState(base64: string): Promise<void> {
  return EmulatorControl.loadGbaState(base64);
}

/** NDS equivalent of saveGbaState/loadGbaState -- see DsEmulatorControlModule.kt. */
export function saveDsState(): Promise<string> {
  return DsEmulatorControl.saveDsState();
}

export function loadDsState(base64: string): Promise<void> {
  return DsEmulatorControl.loadDsState(base64);
}

/**
 * Inserts a GBA ROM into the currently-running NDS game's slot-2 --
 * the same physical mechanism Pal Park (Diamond/Pearl/Platinum) and
 * the GBA-slot transfer (HeartGold/SoulSilver) use to migrate Pokemon
 * from a 3rd-gen game. gbaRomId should be that ROM's CRC32 (see
 * patchers/crc32.ts) so the transfer reuses the exact same save file
 * GbaView already keeps for it, if the user's played it standalone.
 */
export function insertGbaCart(gbaRomPath: string, gbaRomId: string | null): Promise<void> {
  return DsEmulatorControl.insertGbaCart(gbaRomPath, gbaRomId);
}

export function ejectGbaCart(): Promise<void> {
  return DsEmulatorControl.ejectGbaCart();
}

/** TEMPORARY diagnostic -- see GbaView.kt's totalAudioFramesRead/lastAudioWriteResult. */
export function getAudioDebugInfo(): Promise<string> {
  return EmulatorControl.getAudioDebugInfo();
}

/**
 * The game's own in-game save (cartridge SRAM/flash), as opposed to a
 * manual save-state slot -- this is what "continuar" from the game's own
 * menu reads. Only safe to call while the game is paused (see
 * EmulatorControlModule.kt); after setGameSaveBytes, the caller must
 * reload the ROM for mGBA to pick up the new file.
 */
export function getGameSaveBytes(romId: string): Promise<string> {
  return EmulatorControl.getGameSaveBytes(romId);
}

export function setGameSaveBytes(romId: string, base64: string): Promise<void> {
  return EmulatorControl.setGameSaveBytes(romId, base64);
}
