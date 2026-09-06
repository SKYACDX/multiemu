import React, {forwardRef, useImperativeHandle, useRef} from 'react';
import {findNodeHandle, requireNativeComponent, UIManager, ViewProps} from 'react-native';
import {GbaButton} from './GbaView';

const NativeGbaLinkView = requireNativeComponent<ViewProps>('GbaLinkView');

export interface GbaLinkViewHandle {
  /** romIdA/romIdB (e.g. each ROM's CRC32) key their save files -- omit to skip persistence. */
  loadRoms(base64A: string, romIdA: string | undefined, base64B: string, romIdB: string | undefined): void;
  setButtonPressed(player: 0 | 1, button: GbaButton, pressed: boolean): void;
}

/**
 * RN wrapper around the native `GbaLinkView` (see
 * android/gbacore/.../GbaLinkViewManager.kt) -- local (same-device)
 * 2-player GBA link cable. Mirrors GbaView.tsx's shape, doubled for two
 * ROMs/players. Android-only, same as the rest of the emulator screens.
 */
const GbaLinkView = forwardRef<GbaLinkViewHandle, ViewProps>((props, ref) => {
  const nativeRef = useRef(null);

  const dispatchCommand = (name: string, args: (string | number | boolean | null)[]) => {
    const node = findNodeHandle(nativeRef.current);
    if (node == null) return;
    UIManager.dispatchViewManagerCommand(node, name as unknown as number, args);
  };

  useImperativeHandle(ref, () => ({
    loadRoms(base64A, romIdA, base64B, romIdB) {
      dispatchCommand('loadRoms', [base64A, romIdA ?? null, base64B, romIdB ?? null]);
    },
    setButtonPressed(player, button, pressed) {
      dispatchCommand('setButtonPressed', [player, button, pressed]);
    },
  }));

  return <NativeGbaLinkView ref={nativeRef} {...props} />;
});

export default GbaLinkView;
