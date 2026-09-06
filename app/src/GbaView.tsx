import React, {forwardRef, useImperativeHandle, useRef} from 'react';
import {
  findNodeHandle,
  Platform,
  requireNativeComponent,
  UIManager,
  ViewProps,
} from 'react-native';

const NativeGbaView = requireNativeComponent<ViewProps>('GbaView');

export type GbaButton =
  | 'A'
  | 'B'
  | 'SELECT'
  | 'START'
  | 'RIGHT'
  | 'LEFT'
  | 'UP'
  | 'DOWN'
  | 'R'
  | 'L';

export interface GbaViewHandle {
  /** romId (e.g. the ROM's CRC32) keys its save file -- omit to skip save persistence. */
  loadRomBase64(base64: string, romId?: string): void;
  setButtonPressed(button: GbaButton, pressed: boolean): void;
  /** 1/2/3x fast-forward (audio mutes above 1x). */
  setSpeedMultiplier(multiplier: 1 | 2 | 3): void;
  /** Freezes emulation (used while the manual-save modal is open). */
  setPaused(paused: boolean): void;
}

/**
 * RN wrapper around the native `GbaView` (see
 * android/gbacore/.../GbaViewManager.kt), which runs ROMs through mGBA
 * (third_party/mgba) rather than a core written for this project -- see
 * gba_jni.cpp for why. Mirrors GameBoyView.tsx's shape exactly.
 */
const GbaView = forwardRef<GbaViewHandle, ViewProps>((props, ref) => {
  const nativeRef = useRef(null);

  const dispatchCommand = (name: string, args: (string | number | boolean | null)[]) => {
    const node = findNodeHandle(nativeRef.current);
    if (node == null) return;
    UIManager.dispatchViewManagerCommand(node, name as unknown as number, args);
  };

  useImperativeHandle(ref, () => ({
    loadRomBase64(base64: string, romId?: string) {
      dispatchCommand('loadRomBase64', [base64, romId ?? null]);
    },
    setButtonPressed(button: GbaButton, pressed: boolean) {
      dispatchCommand('setButtonPressed', [button, pressed]);
    },
    setSpeedMultiplier(multiplier: 1 | 2 | 3) {
      dispatchCommand('setSpeedMultiplier', [multiplier]);
    },
    setPaused(paused: boolean) {
      dispatchCommand('setPaused', [paused]);
    },
  }));

  if (Platform.OS !== 'android') {
    return null;
  }

  return <NativeGbaView ref={nativeRef} {...props} />;
});

export default GbaView;
