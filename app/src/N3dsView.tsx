import React, {forwardRef, useImperativeHandle, useRef} from 'react';
import {findNodeHandle, requireNativeComponent, UIManager, ViewProps} from 'react-native';

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
