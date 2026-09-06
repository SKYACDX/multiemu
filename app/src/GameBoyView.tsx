import React, {forwardRef, useImperativeHandle, useRef} from 'react';
import {
  findNodeHandle,
  Platform,
  requireNativeComponent,
  UIManager,
  ViewProps,
} from 'react-native';

const NativeGameBoyView = requireNativeComponent<ViewProps>('GameBoyView');

export type GameBoyButton =
  | 'RIGHT'
  | 'LEFT'
  | 'UP'
  | 'DOWN'
  | 'A'
  | 'B'
  | 'SELECT'
  | 'START';

export interface GameBoyViewHandle {
  /** romId (e.g. the ROM's CRC32) keys its save file -- omit to skip save persistence. */
  loadRomBase64(base64: string, romId?: string): void;
  setButtonPressed(button: GameBoyButton, pressed: boolean): void;
}

/**
 * Thin RN wrapper around the native `GameBoyView` (see
 * android/gbcore/.../GameBoyViewManager.kt). The native side owns the
 * emulator, the render loop, and the framebuffer -- this component only
 * forwards commands, so a running game never round-trips pixel data
 * through the JS bridge.
 */
const GameBoyView = forwardRef<GameBoyViewHandle, ViewProps>((props, ref) => {
  const nativeRef = useRef(null);

  const dispatchCommand = (name: string, args: (string | boolean | null)[]) => {
    const node = findNodeHandle(nativeRef.current);
    if (node == null) return;
    // Command names (not numeric IDs) work directly here since Android
    // has supported dispatch-by-name since RN 0.62, and GameBoyViewManager
    // doesn't register a getCommandsMap() -- see its Kotlin source. The RN
    // typings only declare the numeric-ID form, hence the cast.
    UIManager.dispatchViewManagerCommand(node, name as unknown as number, args);
  };

  useImperativeHandle(ref, () => ({
    loadRomBase64(base64: string, romId?: string) {
      dispatchCommand('loadRomBase64', [base64, romId ?? null]);
    },
    setButtonPressed(button: GameBoyButton, pressed: boolean) {
      dispatchCommand('setButtonPressed', [button, pressed]);
    },
  }));

  if (Platform.OS !== 'android') {
    // iOS bindings don't exist yet (see docs/roadmap.md).
    return null;
  }

  return <NativeGameBoyView ref={nativeRef} {...props} />;
});

export default GameBoyView;
