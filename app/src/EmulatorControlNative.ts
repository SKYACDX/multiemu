import {NativeModules} from 'react-native';

interface EmulatorControlNativeModule {
  saveGbaState(): Promise<string>;
  loadGbaState(base64: string): Promise<void>;
  getAudioDebugInfo(): Promise<string>;
  getLinkDebugInfo(): Promise<string>;
  getGameSaveBytes(romId: string): Promise<string>;
  setGameSaveBytes(romId: string, base64: string): Promise<void>;
}

const {EmulatorControl} = NativeModules as {EmulatorControl: EmulatorControlNativeModule};

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

/** TEMPORARY diagnostic -- see GbaView.kt's totalAudioFramesRead/lastAudioWriteResult. */
export function getAudioDebugInfo(): Promise<string> {
  return EmulatorControl.getAudioDebugInfo();
}

/** TEMPORARY diagnostic -- see GbaLinkView.kt's debugText(). */
export function getLinkDebugInfo(): Promise<string> {
  return EmulatorControl.getLinkDebugInfo();
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
