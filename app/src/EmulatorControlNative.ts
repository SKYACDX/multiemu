import {NativeModules} from 'react-native';

interface EmulatorControlNativeModule {
  saveGbaState(): Promise<string>;
  loadGbaState(base64: string): Promise<void>;
  getAudioDebugInfo(): Promise<string>;
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
