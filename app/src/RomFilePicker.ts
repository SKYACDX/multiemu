import {NativeModules} from 'react-native';

export interface PickedRom {
  base64: string;
  name: string;
  size: number;
}

interface RomFilePickerNativeModule {
  pickRom(): Promise<PickedRom>;
}

const {RomFilePicker} = NativeModules as {RomFilePicker: RomFilePickerNativeModule};

/**
 * Opens Android's document picker (Storage Access Framework) so the user
 * can pick their own legally-dumped ROM file. Rejects if they cancel.
 */
export function pickRomFile(): Promise<PickedRom> {
  return RomFilePicker.pickRom();
}
