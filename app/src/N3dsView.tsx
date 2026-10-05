import React, {forwardRef, useImperativeHandle, useRef} from 'react';
import {findNodeHandle, NativeModules, requireNativeComponent, UIManager, ViewProps} from 'react-native';

const NativeN3dsView = requireNativeComponent<ViewProps>('N3dsView');

export type N3dsButton =
  | 'A' | 'B' | 'X' | 'Y' | 'L' | 'R' | 'ZL' | 'ZR'
  | 'SELECT' | 'START' | 'RIGHT' | 'LEFT' | 'UP' | 'DOWN';

export interface N3dsViewHandle {
  /** The core reads the ROM straight off disk (a 3DS game is 1-4GB). */
  loadRomPath(path: string): void;
  setButtonPressed(button: N3dsButton, pressed: boolean): void;
  setPaused(paused: boolean): void;
}

/**
 * RN wrapper around the native `N3dsView` (android/n3dscore), which runs
 * 3DS games through Azahar -- see n3ds_jni.cpp. Same shape as DsView.tsx;
 * touch on the bottom screen is handled natively, like the DS. The game
 * itself outlives the view (N3dsSession), so a remount on rotation only
 * re-attaches it.
 */
const N3dsView = forwardRef<N3dsViewHandle, ViewProps>((props, ref) => {
  const nativeRef = useRef(null);

  const dispatchCommand = (name: string, args: (string | boolean)[]) => {
    const node = findNodeHandle(nativeRef.current);
    if (node == null) return;
    UIManager.dispatchViewManagerCommand(node, name as unknown as number, args);
  };

  useImperativeHandle(ref, () => ({
    loadRomPath(path: string) {
      dispatchCommand('loadRomPath', [path]);
    },
    setButtonPressed(button: N3dsButton, pressed: boolean) {
      dispatchCommand('setButtonPressed', [button, pressed]);
    },
    setPaused(paused: boolean) {
      dispatchCommand('setPaused', [paused]);
    },
  }));

  return <NativeN3dsView ref={nativeRef} {...props} />;
});

export default N3dsView;

const {N3dsState} = NativeModules as {
  N3dsState: {
    saveSlot(romId: string, slot: number): Promise<void>;
    loadSlot(romId: string, slot: number): Promise<void>;
    slotSize(romId: string, slot: number): Promise<number>;
    uploadSlot(romId: string, slot: number, uploadUrl: string, contentType: string): Promise<number>;
    downloadSlot(romId: string, slot: number, downloadUrl: string): Promise<void>;
  };
};

/**
 * 3DS state slots. The core writes/reads the slot file itself (the same
 * file listStateSlots/deleteStateSlot see for GBA/DS): a 3DS state is tens
 * of MB, too big to pass through JS as base64 like the others.
 */
export function save3dsSlot(romId: string, slot: number): Promise<void> {
  return N3dsState.saveSlot(romId, slot);
}

export function load3dsSlot(romId: string, slot: number): Promise<void> {
  return N3dsState.loadSlot(romId, slot);
}

const {N3dsCloud} = NativeModules as {
  N3dsCloud: {
    gameKey(romPath: string): Promise<string>;
    localSave(romPath: string): Promise<{base64: string; fingerprint: number; newestModified: number} | null>;
    zipFingerprint(base64: string): Promise<number>;
    restoreSave(romPath: string, base64: string): Promise<void>;
  };
};

/**
 * The 3DS in-game save for the cloud -- the same contract as the desktop port
 * (docs/3ds-cloud-save.md): key "3ds:<program ID>", the save folder as a zip,
 * compared by a fingerprint of its contents rather than the zip's bytes.
 */
export function n3dsGameKey(romPath: string): Promise<string> {
  return N3dsCloud.gameKey(romPath);
}

/** The local save as a zip plus its fingerprint, or null while the game has saved nothing. */
export function n3dsLocalSave(romPath: string) {
  return N3dsCloud.localSave(romPath);
}

/** A cloud zip's fingerprint; -1 if it holds no progress. */
export function n3dsZipFingerprint(base64: string): Promise<number> {
  return N3dsCloud.zipFingerprint(base64);
}

/** Closes the game and puts the cloud zip in place of its save (the old one is backed up). */
export function n3dsRestoreSave(romPath: string, base64: string): Promise<void> {
  return N3dsCloud.restoreSave(romPath, base64);
}

/** A 3DS slot file's size in bytes (0 when empty). */
export function n3dsSlotSize(romId: string, slot: number): Promise<number> {
  return N3dsState.slotSize(romId, slot);
}

/** PUTs a 3DS slot file to a presigned URL, natively (a state is ~12MB). */
export function n3dsUploadSlot(romId: string, slot: number, uploadUrl: string, contentType: string): Promise<number> {
  return N3dsState.uploadSlot(romId, slot, uploadUrl, contentType);
}

/**
 * Downloads a cloud state and loads it into the running game; the local slot
 * is only replaced once it has loaded (one from a New 3DS may not).
 */
export function n3dsDownloadSlot(romId: string, slot: number, downloadUrl: string): Promise<void> {
  return N3dsState.downloadSlot(romId, slot, downloadUrl);
}
