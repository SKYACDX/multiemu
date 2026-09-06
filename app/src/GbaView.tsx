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
  loadRomBase64(base64: string): void;
  setButtonPressed(button: GbaButton, pressed: boolean): void;
}

/**
 * RN wrapper around the native `GbaView` (see
 * android/gbacore/.../GbaViewManager.kt), which runs ROMs through mGBA
 * (third_party/mgba) rather than a core written for this project -- see
 * gba_jni.cpp for why. Mirrors GameBoyView.tsx's shape exactly.
 */
const GbaView = forwardRef<GbaViewHandle, ViewProps>((props, ref) => {
  const nativeRef = useRef(null);

  const dispatchCommand = (name: string, args: (string | boolean)[]) => {
    const node = findNodeHandle(nativeRef.current);
    if (node == null) return;
    UIManager.dispatchViewManagerCommand(node, name as unknown as number, args);
  };

  useImperativeHandle(ref, () => ({
    loadRomBase64(base64: string) {
      dispatchCommand('loadRomBase64', [base64]);
    },
    setButtonPressed(button: GbaButton, pressed: boolean) {
      dispatchCommand('setButtonPressed', [button, pressed]);
    },
  }));

  if (Platform.OS !== 'android') {
    return null;
  }

  return <NativeGbaView ref={nativeRef} {...props} />;
});

export default GbaView;
