/**
 * multiemu -- Game Boy screen.
 *
 * On first launch it loads the hand-assembled test ROM (no copyrighted
 * game code -- see core/gb/tools/gen_test_rom) so the app always shows
 * something. From there the user can:
 *   - load their own legally-dumped ROM from the device, or
 *   - browse RomHack Hub's public catalog for a fan patch and apply it
 *     on top of their own base ROM (this app never downloads or ships
 *     copyrighted ROMs -- only patches, applied client-side).
 *
 * @format
 */

import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  Alert,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import GameBoyView, {GameBoyButton, GameBoyViewHandle} from './src/GameBoyView';
import RomLibraryScreen from './src/RomLibraryScreen';
import {pickRomFile} from './src/RomFilePicker';
import {base64ToBytes, bytesToBase64} from './src/base64';
import {applyPatch, detectPatchExt} from './src/patchers';
import {downloadPatchBytes, Hack, Patch} from './src/api/romHackHub';
import {TEST_ROM_BASE64} from './src/testRom';

type Screen = 'game' | 'library';

function App(): React.JSX.Element {
  const gameBoyRef = useRef<GameBoyViewHandle>(null);
  const baseRomBytes = useRef<Uint8Array>(base64ToBytes(TEST_ROM_BASE64));
  const [screen, setScreen] = useState<Screen>('game');
  const [romLabel, setRomLabel] = useState('ROM de prueba (franjas)');
  const [busy, setBusy] = useState(false);

  const loadIntoEmulator = useCallback((bytes: Uint8Array, label: string) => {
    baseRomBytes.current = bytes;
    setRomLabel(label);
    gameBoyRef.current?.loadRomBase64(bytesToBase64(bytes));
  }, []);

  useEffect(() => {
    // GameBoyView never auto-loads anything on its own, and it unmounts
    // (destroying the native GameBoy instance) whenever we navigate to
    // the library screen -- so every time it remounts, re-push whatever
    // ROM is current (the initial test ROM, or the user's own/patched one).
    if (screen === 'game') {
      gameBoyRef.current?.loadRomBase64(bytesToBase64(baseRomBytes.current));
    }
  }, [screen]);

  const handlePickRom = useCallback(async () => {
    try {
      const picked = await pickRomFile();
      loadIntoEmulator(base64ToBytes(picked.base64), picked.name);
    } catch {
      // User cancelled the picker -- nothing to do.
    }
  }, [loadIntoEmulator]);

  const handleSelectPatch = useCallback(
    async (hack: Hack, patch: Patch) => {
      const ext = detectPatchExt(patch.format);
      if (!ext) {
        Alert.alert('Formato no soportado', `${patch.formatLabel} todavía no está implementado en la app.`);
        return;
      }
      setScreen('game');
      setBusy(true);
      try {
        const patchBytes = await downloadPatchBytes(patch);
        const {output, warning} = applyPatch(baseRomBytes.current, patchBytes, ext);
        loadIntoEmulator(output, `${hack.title} v${patch.version}`);
        if (warning) Alert.alert('Aviso', warning);
      } catch (e) {
        Alert.alert('Error al aplicar el parche', e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [loadIntoEmulator],
  );

  const press = (button: GameBoyButton, pressed: boolean) => () =>
    gameBoyRef.current?.setButtonPressed(button, pressed);

  const shoulderPress = (label: 'L' | 'R') => () => {
    // The original Game Boy has no shoulder buttons -- these are wired up
    // for when GBA/NDS cores land (see docs/roadmap.md), so for now they
    // intentionally do nothing on a GB/GBC ROM.
    void label;
  };

  if (screen === 'library') {
    return <RomLibraryScreen onSelectPatch={handleSelectPatch} onClose={() => setScreen('game')} />;
  }

  return (
    <SafeAreaView style={styles.container}>
      {Platform.OS === 'android' ? (
        <>
          <View style={styles.topBar}>
            <ShoulderButton label="L" onPress={shoulderPress('L')} />
            <View style={styles.titleBlock}>
              <Text style={styles.title}>multiemu</Text>
              <Text style={styles.romLabel} numberOfLines={1}>
                {busy ? 'Aplicando parche…' : romLabel}
              </Text>
            </View>
            <ShoulderButton label="R" onPress={shoulderPress('R')} />
          </View>

          <GameBoyView ref={gameBoyRef} style={styles.screen} />

          <View style={styles.padRow}>
            <DPad press={press} />
            <ActionButtons press={press} />
          </View>

          <View style={styles.systemRow}>
            <Pressable style={styles.pillButton} onPress={press('SELECT', true)} onPressOut={press('SELECT', false)}>
              <Text style={styles.pillLabel}>SELECT</Text>
            </Pressable>
            <Pressable style={styles.pillButton} onPress={press('START', true)} onPressOut={press('START', false)}>
              <Text style={styles.pillLabel}>START</Text>
            </Pressable>
          </View>

          <View style={styles.menuRow}>
            <Pressable style={styles.menuButton} onPress={handlePickRom}>
              <Text style={styles.menuButtonLabel}>Cargar mi ROM</Text>
            </Pressable>
            <Pressable style={styles.menuButton} onPress={() => setScreen('library')}>
              <Text style={styles.menuButtonLabel}>Buscar hacks</Text>
            </Pressable>
          </View>
        </>
      ) : (
        <Text style={styles.note}>iOS bindings not implemented yet -- see docs/roadmap.md.</Text>
      )}
    </SafeAreaView>
  );
}

function ShoulderButton({label, onPress}: {label: string; onPress: () => void}) {
  return (
    <Pressable style={styles.shoulderButton} onPress={onPress}>
      <Text style={styles.shoulderLabel}>{label}</Text>
    </Pressable>
  );
}

/** Classic cross-shaped D-pad: four arrows at N/S/E/W around an empty center. */
function DPad({press}: {press: (b: GameBoyButton, pressed: boolean) => () => void}) {
  return (
    <View style={styles.dpad}>
      <View style={styles.dpadRow}>
        <View style={styles.dpadSpacer} />
        <DPadButton label="▲" button="UP" press={press} />
        <View style={styles.dpadSpacer} />
      </View>
      <View style={styles.dpadRow}>
        <DPadButton label="◀" button="LEFT" press={press} />
        <View style={styles.dpadCenter} />
        <DPadButton label="▶" button="RIGHT" press={press} />
      </View>
      <View style={styles.dpadRow}>
        <View style={styles.dpadSpacer} />
        <DPadButton label="▼" button="DOWN" press={press} />
        <View style={styles.dpadSpacer} />
      </View>
    </View>
  );
}

function DPadButton({
  label,
  button,
  press,
}: {
  label: string;
  button: GameBoyButton;
  press: (b: GameBoyButton, pressed: boolean) => () => void;
}) {
  return (
    <Pressable style={styles.dpadButton} onPressIn={press(button, true)} onPressOut={press(button, false)}>
      <Text style={styles.dpadLabel}>{label}</Text>
    </Pressable>
  );
}

/** B/A staggered diagonally (B lower-left, A upper-right), matching the real hardware layout. */
function ActionButtons({press}: {press: (b: GameBoyButton, pressed: boolean) => () => void}) {
  return (
    <View style={styles.actionCluster}>
      <Pressable
        style={[styles.actionButton, styles.buttonB]}
        onPressIn={press('B', true)}
        onPressOut={press('B', false)}>
        <Text style={styles.actionLabel}>B</Text>
      </Pressable>
      <Pressable
        style={[styles.actionButton, styles.buttonA]}
        onPressIn={press('A', true)}
        onPressOut={press('A', false)}>
        <Text style={styles.actionLabel}>A</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    paddingHorizontal: 20,
  },
  titleBlock: {alignItems: 'center', flexShrink: 1},
  title: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
  },
  romLabel: {
    color: '#888',
    fontSize: 12,
    marginTop: 2,
    maxWidth: 200,
  },
  shoulderButton: {
    width: 44,
    height: 32,
    borderRadius: 6,
    backgroundColor: '#2a2a2a',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.55,
  },
  shoulderLabel: {color: '#ccc', fontWeight: '700', fontSize: 14},
  screen: {
    width: 320,
    height: 288,
    backgroundColor: '#000',
    marginTop: 12,
  },
  note: {
    color: '#fff',
    marginTop: 40,
    paddingHorizontal: 24,
    textAlign: 'center',
  },
  padRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 28,
    marginTop: 28,
  },
  dpad: {width: 156, alignItems: 'center'},
  dpadRow: {flexDirection: 'row'},
  dpadSpacer: {width: 52, height: 52},
  dpadCenter: {width: 52, height: 52, backgroundColor: '#262626'},
  dpadButton: {
    width: 52,
    height: 52,
    backgroundColor: '#333',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dpadLabel: {color: '#eee', fontSize: 18},
  actionCluster: {width: 140, height: 110, marginRight: 8},
  actionButton: {
    position: 'absolute',
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#8b3a4a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonA: {top: 0, right: 0, backgroundColor: '#a8465a'},
  buttonB: {bottom: 0, left: 0},
  actionLabel: {color: '#fff', fontSize: 20, fontWeight: '700'},
  systemRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginTop: 28,
  },
  pillButton: {
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 14,
    backgroundColor: '#333',
    transform: [{rotate: '-15deg'}],
  },
  pillLabel: {color: '#ccc', fontSize: 11, fontWeight: '700'},
  menuRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 32,
  },
  menuButton: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 8,
    backgroundColor: '#2f5f8f',
  },
  menuButtonLabel: {color: '#fff', fontWeight: '600'},
});

export default App;
