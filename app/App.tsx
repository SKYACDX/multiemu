/**
 * multiemu -- Game Boy / Game Boy Advance screen.
 *
 * GB/GBC ROMs run on core/gb, an emulator written from scratch for this
 * project. GBA ROMs run on mGBA (third_party/mgba, MPL-2.0, vendored)
 * instead -- writing a second CPU-accurate core (ARM7TDMI this time) was
 * judged out of scope; see gba_jni.cpp for the integration boundary.
 *
 * Navigation: Home (recent ROMs + ways to load one) -> Game (the actual
 * emulator) -> Library (RomHack Hub) or Folder (a picked directory),
 * both of which feed back into Game. This app never downloads or ships
 * copyrighted ROMs -- RomHack Hub only ever serves patches, applied
 * client-side onto a ROM the user already has.
 *
 * @format
 */

import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import GameBoyView, {GameBoyButton, GameBoyViewHandle} from './src/GameBoyView';
import GbaView, {GbaButton, GbaViewHandle} from './src/GbaView';
import RomLibraryScreen from './src/RomLibraryScreen';
import HomeScreen from './src/HomeScreen';
import FolderScreen from './src/FolderScreen';
import {InvalidRomExtensionError, pickRomFile, RomPickerCancelledError} from './src/RomFilePicker';
import {
  CachedRom,
  deleteCachedRom,
  FolderFile,
  FolderPickerCancelledError,
  listCachedRoms,
  listRomFolder,
  loadCachedRom,
  pickRomFolder,
  readRomFromFolder,
  saveRomToCache,
} from './src/RomLibraryNative';
import {base64ToBytes, bytesToBase64} from './src/base64';
import {applyPatch, detectPatchExt, SupportedPatchExt} from './src/patchers';
import {downloadPatchBytes, Hack, Patch} from './src/api/romHackHub';
import {extractFromZip} from './src/zip';
import {TEST_ROM_BASE64} from './src/testRom';

const PATCH_EXTENSIONS: SupportedPatchExt[] = ['ips', 'bps', 'ups'];

type Screen = 'home' | 'game' | 'library' | 'folder';
type EmulatedSystem = 'gb' | 'gba';

// NDS/3DS aren't emulated yet (see docs/roadmap.md) -- only accept what
// one of the two cores can actually run, so picking the wrong file fails
// fast with a clear message instead of silently loading garbage.
const SUPPORTED_ROM_EXTENSIONS = ['gb', 'gbc', 'gba'];

function systemForExtension(extension: string): EmulatedSystem {
  return extension.toLowerCase() === 'gba' ? 'gba' : 'gb';
}

/** RomHack Hub platform slugs -> which core plays that platform. */
function systemForPlatformSlug(slug: string): EmulatedSystem {
  return slug === 'gba' ? 'gba' : 'gb';
}

const PLATFORM_LABEL: Record<EmulatedSystem, string> = {gb: 'Game Boy / Color', gba: 'Game Boy Advance'};

function App(): React.JSX.Element {
  const gameBoyRef = useRef<GameBoyViewHandle>(null);
  const gbaRef = useRef<GbaViewHandle>(null);
  const baseRomBytes = useRef<Uint8Array>(base64ToBytes(TEST_ROM_BASE64));
  // False until the user has actually loaded their own ROM (as opposed
  // to the built-in test pattern) -- gates applying a HackRom patch, see
  // handleSelectPatch: applying one against whatever happened to be
  // loaded (often nothing of the right platform) silently produces a
  // corrupt ROM that "loads" but shows a black screen.
  const hasUserRom = useRef(false);
  const [system, setSystem] = useState<EmulatedSystem>('gb');
  const [screen, setScreen] = useState<Screen>('home');
  const [romLabel, setRomLabel] = useState('ROM de prueba (franjas)');
  const [busy, setBusy] = useState(false);
  const prevLabelBeforeLoad = useRef('ROM de prueba (franjas)');

  const [recentRoms, setRecentRoms] = useState<CachedRom[]>([]);
  const [folder, setFolder] = useState<{uri: string; name: string} | null>(null);
  const [folderFiles, setFolderFiles] = useState<FolderFile[]>([]);
  const [folderLoading, setFolderLoading] = useState(false);

  const refreshRecentRoms = useCallback(() => {
    listCachedRoms()
      .then(setRecentRoms)
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshRecentRoms();
  }, [refreshRecentRoms]);

  // base64: pass it through when the caller already has one (e.g. fresh
  // out of the file picker) to skip re-encoding [bytes] -- for a 16-32MB
  // GBA ROM, encoding it a second time is slow and, combined with every
  // other copy already in flight (native bytes, the bridge's own base64
  // string, this decoded Uint8Array), pushes memory usage high enough to
  // risk an OOM crash right as the ROM starts running.
  const loadIntoEmulator = useCallback(
    (bytes: Uint8Array, label: string, targetSystem: EmulatedSystem, base64?: string) => {
      baseRomBytes.current = bytes;
      setRomLabel(label);
      setSystem(targetSystem);
      setScreen('game');
      const encoded = base64 ?? bytesToBase64(bytes);
      if (targetSystem === 'gba') {
        gbaRef.current?.loadRomBase64(encoded);
      } else {
        gameBoyRef.current?.loadRomBase64(encoded);
      }
      return encoded;
    },
    [],
  );

  useEffect(() => {
    // Both native views unmount (destroying their emulator instance)
    // whenever we navigate away from the game screen -- so every time
    // the active one remounts, re-push whatever ROM is current.
    if (screen !== 'game') return;
    const base64 = bytesToBase64(baseRomBytes.current);
    if (system === 'gba') {
      gbaRef.current?.loadRomBase64(base64);
    } else {
      gameBoyRef.current?.loadRomBase64(base64);
    }
  }, [screen, system]);

  const handlePickRom = useCallback(async () => {
    prevLabelBeforeLoad.current = romLabel;
    setBusy(true);
    setRomLabel('Cargando ROM…');
    try {
      const picked = await pickRomFile(SUPPORTED_ROM_EXTENSIONS);
      const extension = picked.name.split('.').pop() ?? '';
      const targetSystem = systemForExtension(extension);
      loadIntoEmulator(base64ToBytes(picked.base64), picked.name, targetSystem, picked.base64);
      hasUserRom.current = true;
      saveRomToCache(picked.base64, picked.name, targetSystem, picked.name)
        .then(refreshRecentRoms)
        .catch(() => {});
    } catch (e) {
      if (e instanceof RomPickerCancelledError) {
        // Cancelled by the user -- restore whatever was showing before.
      } else if (e instanceof InvalidRomExtensionError) {
        Alert.alert('Archivo no soportado', e.message);
      } else {
        Alert.alert('No se pudo cargar la ROM', e instanceof Error ? e.message : String(e));
      }
      setRomLabel(prevLabelBeforeLoad.current);
    } finally {
      setBusy(false);
    }
  }, [loadIntoEmulator, refreshRecentRoms, romLabel]);

  const handlePickFolder = useCallback(async () => {
    try {
      const picked = await pickRomFolder();
      setFolder(picked);
      setScreen('folder');
      setFolderLoading(true);
      const files = await listRomFolder(picked.uri, SUPPORTED_ROM_EXTENSIONS);
      setFolderFiles(files);
    } catch (e) {
      if (!(e instanceof FolderPickerCancelledError)) {
        Alert.alert('No se pudo abrir la carpeta', e instanceof Error ? e.message : String(e));
      }
    } finally {
      setFolderLoading(false);
    }
  }, []);

  const handleSelectFolderFile = useCallback(
    async (file: FolderFile) => {
      setBusy(true);
      setRomLabel('Cargando ROM…');
      try {
        const read = await readRomFromFolder(file.uri, SUPPORTED_ROM_EXTENSIONS);
        const extension = read.name.split('.').pop() ?? '';
        const targetSystem = systemForExtension(extension);
        loadIntoEmulator(base64ToBytes(read.base64), read.name, targetSystem, read.base64);
        hasUserRom.current = true;
        saveRomToCache(read.base64, read.name, targetSystem, read.name)
          .then(refreshRecentRoms)
          .catch(() => {});
      } catch (e) {
        Alert.alert('No se pudo cargar la ROM', e instanceof Error ? e.message : String(e));
        setScreen('home');
      } finally {
        setBusy(false);
      }
    },
    [loadIntoEmulator, refreshRecentRoms],
  );

  const handleSelectRecent = useCallback(
    async (rom: CachedRom) => {
      setBusy(true);
      setRomLabel('Cargando ROM…');
      try {
        const base64 = await loadCachedRom(rom.id);
        const targetSystem: EmulatedSystem = rom.system === 'gba' ? 'gba' : 'gb';
        loadIntoEmulator(base64ToBytes(base64), rom.label, targetSystem, base64);
        hasUserRom.current = true;
      } catch (e) {
        Alert.alert('No se pudo abrir esa ROM', e instanceof Error ? e.message : String(e));
        refreshRecentRoms();
      } finally {
        setBusy(false);
      }
    },
    [loadIntoEmulator, refreshRecentRoms],
  );

  const handleDeleteRecent = useCallback(
    (rom: CachedRom) => {
      deleteCachedRom(rom.id)
        .then(refreshRecentRoms)
        .catch(() => {});
    },
    [refreshRecentRoms],
  );

  const handleSelectPatch = useCallback(
    async (hack: Hack, patch: Patch) => {
      const targetSystem = systemForPlatformSlug(hack.game.platform.slug);
      // Applying a patch against whatever's currently loaded only makes
      // sense if that's the user's own ROM for the right platform --
      // otherwise the patch (which expects a specific source ROM) either
      // gets rejected (BPS/UPS check size/checksum) or "succeeds" against
      // the wrong bytes and produces a ROM that loads but shows nothing.
      if (!hasUserRom.current || system !== targetSystem) {
        Alert.alert(
          'Primero carga tu ROM',
          `Este parche es para ${PLATFORM_LABEL[targetSystem]}. Carga tu propia ROM de ese sistema antes de aplicarlo.`,
          [
            {text: 'Cancelar', style: 'cancel'},
            {text: 'Cargar ROM', onPress: () => handlePickRom()},
          ],
        );
        return;
      }
      prevLabelBeforeLoad.current = romLabel;
      setScreen('game');
      setBusy(true);
      setRomLabel('Aplicando parche…');
      try {
        const downloaded = await downloadPatchBytes(patch);
        // The patch file itself might be a .zip (some are uploaded that
        // way) -- unzip first and trust the extracted file's own
        // extension over the API's declared format, which describes the
        // upload, not necessarily what's inside it.
        const unzipped = extractFromZip(downloaded, PATCH_EXTENSIONS);
        const patchBytes = unzipped?.bytes ?? downloaded;
        const ext = unzipped
          ? detectPatchExt(unzipped.name.split('.').pop() ?? '')
          : detectPatchExt(patch.format);
        if (!ext) {
          Alert.alert(
            'Formato no soportado',
            unzipped
              ? 'El .zip no contiene un parche IPS/BPS/UPS reconocible.'
              : `${patch.formatLabel} todavía no está implementado en la app.`,
          );
          setRomLabel(prevLabelBeforeLoad.current);
          return;
        }
        const {output, warning} = applyPatch(baseRomBytes.current, patchBytes, ext);
        const label = `${hack.title} v${patch.version}`;
        const encoded = loadIntoEmulator(output, label, targetSystem);
        saveRomToCache(encoded, `${hack.slug}-v${patch.version}.${targetSystem}`, targetSystem, label)
          .then(refreshRecentRoms)
          .catch(() => {});
        if (warning) Alert.alert('Aviso', warning);
      } catch (e) {
        Alert.alert('Error al aplicar el parche', e instanceof Error ? e.message : String(e));
        setRomLabel(prevLabelBeforeLoad.current);
      } finally {
        setBusy(false);
      }
    },
    [handlePickRom, loadIntoEmulator, refreshRecentRoms, romLabel, system],
  );

  // RIGHT/LEFT/UP/DOWN/A/B/SELECT/START are valid enum constant names on
  // both GameBoyButton and GbaButton, so the shared controls can dispatch
  // to whichever view is currently active by name.
  const press = (button: GameBoyButton & GbaButton, pressed: boolean) => () => {
    if (system === 'gba') {
      gbaRef.current?.setButtonPressed(button, pressed);
    } else {
      gameBoyRef.current?.setButtonPressed(button, pressed);
    }
  };

  const shoulderPress = (button: 'L' | 'R', pressed: boolean) => () => {
    // The original Game Boy has no shoulder buttons -- only meaningful
    // (and wired up) when a GBA ROM is loaded.
    if (system === 'gba') {
      gbaRef.current?.setButtonPressed(button, pressed);
    }
  };

  if (screen === 'home') {
    return (
      <SafeAreaView style={styles.container}>
        <HomeScreen
          recentRoms={recentRoms}
          onSelectRecent={handleSelectRecent}
          onDeleteRecent={handleDeleteRecent}
          onPickFile={handlePickRom}
          onPickFolder={handlePickFolder}
          onBrowseHackRoms={() => setScreen('library')}
        />
      </SafeAreaView>
    );
  }

  if (screen === 'folder') {
    return (
      <SafeAreaView style={styles.container}>
        <FolderScreen
          folderName={folder?.name ?? 'Carpeta'}
          files={folderFiles}
          loading={folderLoading}
          onSelectFile={handleSelectFolderFile}
          onClose={() => setScreen('home')}
        />
      </SafeAreaView>
    );
  }

  if (screen === 'library') {
    return <RomLibraryScreen onSelectPatch={handleSelectPatch} onClose={() => setScreen('game')} />;
  }

  return (
    <SafeAreaView style={styles.container}>
      {Platform.OS === 'android' ? (
        <>
          <View style={styles.topBar}>
            <Pressable style={styles.homeButton} onPress={() => setScreen('home')} hitSlop={8}>
              <Text style={styles.homeButtonLabel}>🏠</Text>
            </Pressable>
            <View style={styles.titleBlock}>
              <View style={styles.romLabelRow}>
                {busy && <ActivityIndicator size="small" color="#7ab8ff" style={styles.romLabelSpinner} />}
                <Text style={styles.romLabel} numberOfLines={1}>
                  {romLabel}
                </Text>
              </View>
            </View>
            <View style={styles.shoulderPair}>
              <ShoulderButton label="L" active={system === 'gba'} onPress={shoulderPress('L', true)} onRelease={shoulderPress('L', false)} />
              <ShoulderButton label="R" active={system === 'gba'} onPress={shoulderPress('R', true)} onRelease={shoulderPress('R', false)} />
            </View>
          </View>

          {system === 'gba' ? (
            <GbaView ref={gbaRef} style={styles.screenGba} />
          ) : (
            <GameBoyView ref={gameBoyRef} style={styles.screen} />
          )}

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

          <Pressable
            style={[styles.hackRomButton, busy && styles.menuButtonDisabled]}
            disabled={busy}
            onPress={() => setScreen('library')}>
            <Text style={styles.menuButtonLabel}>Buscar HackRoms</Text>
          </Pressable>
        </>
      ) : (
        <Text style={styles.note}>iOS bindings not implemented yet -- see docs/roadmap.md.</Text>
      )}
    </SafeAreaView>
  );
}

function ShoulderButton({
  label,
  active,
  onPress,
  onRelease,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  onRelease: () => void;
}) {
  return (
    <Pressable
      style={[styles.shoulderButton, !active && styles.shoulderButtonInactive]}
      onPressIn={onPress}
      onPressOut={onRelease}>
      <Text style={styles.shoulderLabel}>{label}</Text>
    </Pressable>
  );
}

/** Classic cross-shaped D-pad: four arrows at N/S/E/W around an empty center. */
function DPad({press}: {press: (b: GameBoyButton & GbaButton, pressed: boolean) => () => void}) {
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
  button: GameBoyButton & GbaButton;
  press: (b: GameBoyButton & GbaButton, pressed: boolean) => () => void;
}) {
  return (
    <Pressable style={styles.dpadButton} onPressIn={press(button, true)} onPressOut={press(button, false)}>
      <Text style={styles.dpadLabel}>{label}</Text>
    </Pressable>
  );
}

/** B/A staggered diagonally (B lower-left, A upper-right), matching the real hardware layout. */
function ActionButtons({press}: {press: (b: GameBoyButton & GbaButton, pressed: boolean) => () => void}) {
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
    paddingHorizontal: 16,
  },
  homeButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  homeButtonLabel: {fontSize: 20},
  shoulderPair: {flexDirection: 'row', gap: 6},
  titleBlock: {alignItems: 'center', flex: 1},
  romLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  romLabelSpinner: {
    marginRight: 6,
  },
  romLabel: {
    color: '#ccc',
    fontSize: 13,
    fontWeight: '600',
    maxWidth: 220,
  },
  shoulderButton: {
    width: 40,
    height: 32,
    borderRadius: 6,
    backgroundColor: '#3a5a7a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shoulderButtonInactive: {
    backgroundColor: '#2a2a2a',
    opacity: 0.55,
  },
  shoulderLabel: {color: '#ccc', fontWeight: '700', fontSize: 13},
  screen: {
    width: 320,
    height: 288,
    backgroundColor: '#000',
    marginTop: 12,
  },
  screenGba: {
    width: 320,
    height: 213,
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
  hackRomButton: {
    marginTop: 28,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    backgroundColor: '#2f5f8f',
  },
  menuButtonDisabled: {
    backgroundColor: '#2a3f52',
    opacity: 0.6,
  },
  menuButtonLabel: {color: '#fff', fontWeight: '600'},
});

export default App;
