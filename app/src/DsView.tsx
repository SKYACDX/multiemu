import React, {forwardRef, useImperativeHandle, useRef} from 'react';
import {findNodeHandle, requireNativeComponent, UIManager, ViewProps} from 'react-native';

const NativeDsView = requireNativeComponent<ViewProps>('DsView');

export type DsButton = 'A' | 'B' | 'SELECT' | 'START' | 'RIGHT' | 'LEFT' | 'UP' | 'DOWN' | 'R' | 'L' | 'X' | 'Y';

export interface DsViewHandle {
  /** romId keys its save file -- omit to skip persistence. Only for small (e.g. homebrew) ROMs -- see loadRomPath. */
  loadRomBase64(base64: string, romId?: string): void;
  /** Reads the ROM straight off disk on the native side -- the path a real (128-512MB) NDS ROM should take. */
  loadRomPath(path: string, romId?: string): void;
  setButtonPressed(button: DsButton, pressed: boolean): void;
  /** Freezes emulation (used while the manual-save modal is open). */
  setPaused(paused: boolean): void;
}

/**
 * RN wrapper around the native `DsView` (see
 * android/dscore/.../DsViewManager.kt), which runs ROMs through melonDS
 * (third_party/melonds) -- see ds_jni.cpp for the integration boundary.
 * Mirrors GbaView.tsx's shape; unlike GBA, there's no touch-screen
 * command here -- DsView handles touch input itself natively, since it
 * already knows the bottom screen's exact on-screen scaled rect.
 */
const DsView = forwardRef<DsViewHandle, ViewProps>((props, ref) => {
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
    loadRomPath(path: string, romId?: string) {
      dispatchCommand('loadRomPath', [path, romId ?? null]);
    },
    setButtonPressed(button: DsButton, pressed: boolean) {
      dispatchCommand('setButtonPressed', [button, pressed]);
    },
    setPaused(paused: boolean) {
      dispatchCommand('setPaused', [paused]);
    },
  }));

  return <NativeDsView ref={nativeRef} {...props} />;
});

export default DsView;
