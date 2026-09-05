/**
 * multiemu -- Game Boy smoke test screen.
 *
 * Loads the hand-assembled test ROM (core/gb/tools/gen_test_rom, no
 * copyrighted game code) into the native GameBoyView on mount, so
 * launching the app is itself the end-to-end verification that
 * CPU -> Bus -> PPU -> native render loop -> RN native view all work
 * together on a real device/emulator.
 *
 * @format
 */

import React, {useEffect, useRef} from 'react';
import {
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import GameBoyView, {GameBoyButton, GameBoyViewHandle} from './src/GameBoyView';
import {TEST_ROM_BASE64} from './src/testRom';

const DPAD_BUTTONS: {label: string; button: GameBoyButton}[] = [
  {label: '▲', button: 'UP'},
  {label: '◀', button: 'LEFT'},
  {label: '▶', button: 'RIGHT'},
  {label: '▼', button: 'DOWN'},
];

const ACTION_BUTTONS: {label: string; button: GameBoyButton}[] = [
  {label: 'B', button: 'B'},
  {label: 'A', button: 'A'},
];

function App(): React.JSX.Element {
  const gameBoyRef = useRef<GameBoyViewHandle>(null);

  useEffect(() => {
    gameBoyRef.current?.loadRomBase64(TEST_ROM_BASE64);
  }, []);

  const press = (button: GameBoyButton, pressed: boolean) => () =>
    gameBoyRef.current?.setButtonPressed(button, pressed);

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>multiemu</Text>
      {Platform.OS === 'android' ? (
        <>
          <GameBoyView ref={gameBoyRef} style={styles.screen} />
          <View style={styles.controls}>
            <View style={styles.dpad}>
              {DPAD_BUTTONS.map(({label, button}) => (
                <Pressable
                  key={button}
                  style={styles.dpadButton}
                  onPressIn={press(button, true)}
                  onPressOut={press(button, false)}>
                  <Text style={styles.buttonLabel}>{label}</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.actions}>
              {ACTION_BUTTONS.map(({label, button}) => (
                <Pressable
                  key={button}
                  style={styles.actionButton}
                  onPressIn={press(button, true)}
                  onPressOut={press(button, false)}>
                  <Text style={styles.buttonLabel}>{label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </>
      ) : (
        <Text style={styles.note}>
          iOS bindings not implemented yet -- see docs/roadmap.md.
        </Text>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
  },
  title: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '600',
    marginVertical: 12,
  },
  screen: {
    width: 320,
    height: 288,
    backgroundColor: '#000',
  },
  note: {
    color: '#fff',
    marginTop: 40,
    paddingHorizontal: 24,
    textAlign: 'center',
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    paddingHorizontal: 32,
    marginTop: 32,
  },
  dpad: {
    width: 140,
    height: 140,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dpadButton: {
    width: 56,
    height: 56,
    margin: 4,
    borderRadius: 8,
    backgroundColor: '#333',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: {
    justifyContent: 'center',
    gap: 16,
  },
  actionButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#444',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonLabel: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
});

export default App;
