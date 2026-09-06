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
 * Locked to portrait (see AndroidManifest.xml) -- an earlier landscape
 * reflow caused real layout bugs on rotation (controls vanishing, the
 * native view only rendering half-width) that weren't practical to
 * chase blind without a device to test rotation on directly.
 *
 * @format
 */

import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import GameBoyView, {GameBoyButton, GameBoyViewHandle} from './src/GameBoyView';
import GbaView, {GbaButton, GbaViewHandle} from './src/GbaView';
import {IconHome, IconSave} from './src/icons';
import RomLibraryScreen from './src/RomLibraryScreen';
import HomeScreen from './src/HomeScreen';
import FolderScreen from './src/FolderScreen';
import {InvalidRomExtensionError, pickRomFile, RomPickerCancelledError} from './src/RomFilePicker';
import {
  CachedRom,
  deleteCachedRom,
  FolderFile,
  FolderPickerCancelledError,
  getLastFolder,
  listCachedRoms,
  listRomFolder,
  listStateSlots,
  loadCachedRom,
  loadStateSlot,
  pickRomFolder,
  readRomFromFolder,
  saveRomToCache,
  saveStateSlot,
  StateSlot,
} from './src/RomLibraryNative';
import {getAudioDebugInfo, loadGbaState, saveGbaState} from './src/EmulatorControlNative';
import {base64ToBytes, bytesToBase64} from './src/base64';
import {crc32} from './src/patchers/crc32';
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
const SYSTEM_ACCENT: Record<EmulatedSystem, string> = {gb: '#4a90d9', gba: '#c2536a'};

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
  // CRC32 of the currently-loaded ROM, hex-encoded -- keys its save file
  // (see GameBoyView.kt/GbaView.kt). null for the built-in test ROM,
  // which has no battery RAM to persist anyway.
  const currentRomId = useRef<string | null>(null);
  const [system, setSystem] = useState<EmulatedSystem>('gb');
  const [screen, setScreen] = useState<Screen>('home');
  const [romLabel, setRomLabel] = useState('ROM de prueba (franjas)');
  const [busy, setBusy] = useState(false);
  const prevLabelBeforeLoad = useRef('ROM de prueba (franjas)');

  const [recentRoms, setRecentRoms] = useState<CachedRom[]>([]);
  const [lastFolder, setLastFolder] = useState<{uri: string; name: string} | null>(null);
  const [folder, setFolder] = useState<{uri: string; name: string} | null>(null);
  const [folderFiles, setFolderFiles] = useState<FolderFile[]>([]);
  const [folderLoading, setFolderLoading] = useState(false);

  const [speed, setSpeed] = useState<1 | 2 | 3>(1);
  // Manual save states -- only GBA (mGBA exposes full-state save/load
  // out of the box; gbcore doesn't implement that yet, see docs/roadmap.md).
  const [stateSlots, setStateSlots] = useState<StateSlot[]>([]);
  const [saveModalOpen, setSaveModalOpen] = useState(false);

  const refreshRecentRoms = useCallback(() => {
    listCachedRoms()
      .then(setRecentRoms)
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshRecentRoms();
    getLastFolder()
      .then(setLastFolder)
      .catch(() => {});
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
      currentRomId.current = crc32(bytes).toString(16);
      setRomLabel(label);
      setSystem(targetSystem);
      setScreen('game');
      setSpeed(1);
      const encoded = base64 ?? bytesToBase64(bytes);
      if (targetSystem === 'gba') {
        gbaRef.current?.loadRomBase64(encoded, currentRomId.current);
        gbaRef.current?.setSpeedMultiplier(1);
        listStateSlots(currentRomId.current)
          .then(setStateSlots)
          .catch(() => setStateSlots([]));
      } else {
        gameBoyRef.current?.loadRomBase64(encoded, currentRomId.current);
        gameBoyRef.current?.setSpeedMultiplier(1);
        setStateSlots([]);
      }
      return encoded;
    },
    [],
  );

  const handleSetSpeed = useCallback(
    (multiplier: 1 | 2 | 3) => {
      setSpeed(multiplier);
      if (system === 'gba') {
        gbaRef.current?.setSpeedMultiplier(multiplier);
      } else {
        gameBoyRef.current?.setSpeedMultiplier(multiplier);
      }
    },
    [system],
  );

  const openSaveModal = useCallback(() => {
    setSaveModalOpen(true);
    gbaRef.current?.setPaused(true);
    if (currentRomId.current) {
      listStateSlots(currentRomId.current)
        .then(setStateSlots)
        .catch(() => {});
    }
  }, []);

  const closeSaveModal = useCallback(() => {
    setSaveModalOpen(false);
    gbaRef.current?.setPaused(false);
  }, []);

  const handleSaveSlot = useCallback(
    async (slot: number) => {
      const romId = currentRomId.current;
      if (!romId) return;
      try {
        const base64 = await saveGbaState();
        await saveStateSlot(romId, slot, base64);
        setStateSlots(await listStateSlots(romId));
      } catch (e) {
        Alert.alert('No se pudo guardar', e instanceof Error ? e.message : String(e));
      }
    },
    [],
  );

  const handleLoadSlot = useCallback(
    async (slot: number) => {
      const romId = currentRomId.current;
      if (!romId) return;
      try {
        const base64 = await loadStateSlot(romId, slot);
        await loadGbaState(base64);
        closeSaveModal();
      } catch (e) {
        Alert.alert('No se pudo cargar ese guardado', e instanceof Error ? e.message : String(e));
      }
    },
    [closeSaveModal],
  );

  const handleShowAudioDebug = useCallback(() => {
    getAudioDebugInfo()
      .then(info => Alert.alert('Diagnóstico de audio', info))
      .catch(e => Alert.alert('Diagnóstico de audio', String(e)));
  }, []);

  useEffect(() => {
    // Both native views unmount (destroying their emulator instance)
    // whenever we navigate away from the game screen -- so every time
    // the active one remounts, re-push whatever ROM is current (and its
    // romId, so save persistence keeps working after a trip through
    // Home/Folder/Library and back).
    if (screen !== 'game') return;
    const base64 = bytesToBase64(baseRomBytes.current);
    const romId = currentRomId.current ?? undefined;
    setSpeed(1);
    if (system === 'gba') {
      gbaRef.current?.loadRomBase64(base64, romId);
      gbaRef.current?.setSpeedMultiplier(1);
    } else {
      gameBoyRef.current?.loadRomBase64(base64, romId);
      gameBoyRef.current?.setSpeedMultiplier(1);
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

  const openFolder = useCallback(async (picked: {uri: string; name: string}) => {
    setFolder(picked);
    setScreen('folder');
    setFolderLoading(true);
    try {
      const files = await listRomFolder(picked.uri, SUPPORTED_ROM_EXTENSIONS);
      setFolderFiles(files);
    } catch (e) {
      Alert.alert('No se pudo abrir la carpeta', e instanceof Error ? e.message : String(e));
      setScreen('home');
    } finally {
      setFolderLoading(false);
    }
  }, []);

  const handlePickFolder = useCallback(async () => {
    try {
      const picked = await pickRomFolder();
      setLastFolder(picked);
      await openFolder(picked);
    } catch (e) {
      if (!(e instanceof FolderPickerCancelledError)) {
        Alert.alert('No se pudo abrir la carpeta', e instanceof Error ? e.message : String(e));
      }
    }
  }, [openFolder]);

  const handleOpenLastFolder = useCallback(() => {
    if (lastFolder) openFolder(lastFolder);
  }, [lastFolder, openFolder]);

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
        <StatusBar hidden />
        <HomeScreen
          recentRoms={recentRoms}
          onSelectRecent={handleSelectRecent}
          onDeleteRecent={handleDeleteRecent}
          onPickFile={handlePickRom}
          onPickFolder={handlePickFolder}
          onBrowseHackRoms={() => setScreen('library')}
          lastFolder={lastFolder}
          onOpenLastFolder={handleOpenLastFolder}
          busy={busy}
        />
      </SafeAreaView>
    );
  }

  if (screen === 'folder') {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar hidden />
        <FolderScreen
          folderName={folder?.name ?? 'Carpeta'}
          files={folderFiles}
          loading={folderLoading}
          opening={busy}
          onSelectFile={handleSelectFolderFile}
          onClose={() => setScreen('home')}
        />
      </SafeAreaView>
    );
  }

  if (screen === 'library') {
    return (
      <>
        <StatusBar hidden />
        <RomLibraryScreen onSelectPatch={handleSelectPatch} onClose={() => setScreen('home')} />
      </>
    );
  }

  const screenView =
    system === 'gba' ? (
      <GbaView ref={gbaRef} style={styles.screenGba} />
    ) : (
      <GameBoyView ref={gameBoyRef} style={styles.screen} />
    );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar hidden />
      {Platform.OS === 'android' ? (
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.topBar}>
            <Pressable style={styles.homeButton} onPress={() => setScreen('home')} hitSlop={8}>
              <IconHome size={20} />
            </Pressable>
            <View style={styles.titleBlock}>
              <View style={styles.romLabelRow}>
                {busy && <ActivityIndicator size="small" color="#7ab8ff" style={styles.romLabelSpinner} />}
                <Text style={styles.romLabel} numberOfLines={1}>
                  {romLabel}
                </Text>
              </View>
            </View>
            {system === 'gba' ? (
              <Pressable style={styles.homeButton} onPress={handleShowAudioDebug} hitSlop={8}>
                <Text style={styles.debugLabel}>i</Text>
              </Pressable>
            ) : (
              <View style={styles.homeButton} />
            )}
          </View>

          <View style={[styles.consoleShell, {borderColor: SYSTEM_ACCENT[system]}]}>
            <View style={styles.screenBezel}>{screenView}</View>
            <View style={styles.speakerGrill}>
              {[0, 1, 2, 3, 4].map(i => (
                <View key={i} style={[styles.speakerHole, {backgroundColor: SYSTEM_ACCENT[system]}]} />
              ))}
            </View>
          </View>

          {/* L/R below the screen, one per side, reachable with either thumb -- the
              original Game Boy has no shoulder buttons, so these only do anything
              (and light up) once a GBA ROM is loaded. */}
          <View style={styles.shoulderRow}>
            <ShoulderButton label="L" active={system === 'gba'} onPress={shoulderPress('L', true)} onRelease={shoulderPress('L', false)} />
            <ShoulderButton label="R" active={system === 'gba'} onPress={shoulderPress('R', true)} onRelease={shoulderPress('R', false)} />
          </View>

          <View style={styles.padRow}>
            <DPad press={press} />
            <ActionButtons press={press} />
          </View>

          <View style={styles.systemRow}>
            <Pressable style={[styles.pillButton, styles.pillButtonSelect]} onPress={press('SELECT', true)} onPressOut={press('SELECT', false)}>
              <View style={styles.pillHighlight} />
              <Text style={styles.pillLabel}>SELECT</Text>
            </Pressable>
            <Pressable style={[styles.pillButton, styles.pillButtonStart]} onPress={press('START', true)} onPressOut={press('START', false)}>
              <View style={styles.pillHighlight} />
              <Text style={styles.pillLabel}>START</Text>
            </Pressable>
          </View>

          <View style={styles.speedRow}>
            {([1, 2, 3] as const).map(multiplier => (
              <Pressable
                key={multiplier}
                style={[styles.speedButton, speed === multiplier && styles.speedButtonActive]}
                onPress={() => handleSetSpeed(multiplier)}>
                <Text style={[styles.speedLabel, speed === multiplier && styles.speedLabelActive]}>×{multiplier}</Text>
              </Pressable>
            ))}

            {system === 'gba' && (
              <Pressable style={styles.saveOpenButton} onPress={openSaveModal}>
                <IconSave size={16} color="#cfe3fa" />
                <Text style={styles.saveOpenLabel}>Guardado</Text>
              </Pressable>
            )}
          </View>
        </ScrollView>
      ) : (
        <Text style={styles.note}>iOS bindings not implemented yet -- see docs/roadmap.md.</Text>
      )}

      {/* Floating, pauses the game while open -- see openSaveModal/closeSaveModal. */}
      <Modal visible={saveModalOpen} transparent animationType="fade" onRequestClose={closeSaveModal}>
        <Pressable style={styles.modalBackdrop} onPress={closeSaveModal}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <Text style={styles.modalTitle}>Guardado manual</Text>
            <Text style={styles.modalSubtitle}>El juego está en pausa mientras eliges un espacio.</Text>
            <View style={styles.slotsRow}>
              {[0, 1, 2].map(slot => {
                const info = stateSlots.find(s => s.slot === slot) ?? {slot, exists: false};
                return (
                  <View key={slot} style={styles.slotCard}>
                    <Text style={styles.slotLabel}>Slot {slot + 1}</Text>
                    <Text style={styles.slotMeta} numberOfLines={1}>
                      {info.exists
                        ? new Date(info.savedAt ?? 0).toLocaleString(undefined, {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : 'Vacío'}
                    </Text>
                    <View style={styles.slotActions}>
                      <Pressable style={styles.slotActionButton} onPress={() => handleSaveSlot(slot)}>
                        <Text style={styles.slotActionLabel}>Guardar</Text>
                      </Pressable>
                      <Pressable
                        style={[styles.slotActionButton, !info.exists && styles.slotActionButtonDisabled]}
                        disabled={!info.exists}
                        onPress={() => handleLoadSlot(slot)}>
                        <Text style={[styles.slotActionLabel, !info.exists && styles.slotActionLabelDisabled]}>
                          Cargar
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                );
              })}
            </View>
            <Pressable style={styles.modalCloseButton} onPress={closeSaveModal}>
              <Text style={styles.modalCloseLabel}>Cerrar y continuar</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
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
      <View style={styles.shoulderHighlight} />
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
      <View style={styles.dpadHighlight} />
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
        <View style={styles.actionHighlight} />
        <Text style={styles.actionLabel}>B</Text>
      </Pressable>
      <Pressable
        style={[styles.actionButton, styles.buttonA]}
        onPressIn={press('A', true)}
        onPressOut={press('A', false)}>
        <View style={styles.actionHighlight} />
        <Text style={styles.actionLabel}>A</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#14151a',
  },
  scrollContent: {
    flexGrow: 1,
    alignItems: 'center',
    paddingBottom: 24,
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
  debugLabel: {
    color: '#555',
    fontSize: 13,
    fontWeight: '800',
    fontStyle: 'italic',
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#555',
    textAlign: 'center',
    lineHeight: 17,
  },
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
    width: 44,
    height: 34,
    borderRadius: 8,
    backgroundColor: '#3a5a7a',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  shoulderButtonInactive: {
    backgroundColor: '#2a2a2a',
    opacity: 0.55,
  },
  shoulderHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '45%',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  shoulderLabel: {color: '#eee', fontWeight: '700', fontSize: 13},
  // A stylized "device shell" around the screen -- a rounded, elevated
  // panel with a border tinted to the active system (blue for GB/GBC,
  // maroon for GBA, matching HomeScreen's badge colors) instead of the
  // emulator view floating bare on the background.
  consoleShell: {
    marginTop: 8,
    borderWidth: 2,
    borderRadius: 24,
    backgroundColor: '#1e2027',
    paddingTop: 10,
    paddingBottom: 6,
    paddingHorizontal: 18,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 6},
    shadowOpacity: 0.4,
    shadowRadius: 14,
    elevation: 10,
  },
  screenBezel: {
    backgroundColor: '#000',
    borderRadius: 10,
    padding: 6,
  },
  screen: {
    width: 288,
    height: 259,
    backgroundColor: '#000',
    borderRadius: 4,
  },
  screenGba: {
    width: 288,
    height: 192,
    backgroundColor: '#000',
    borderRadius: 4,
  },
  speakerGrill: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
  },
  speakerHole: {
    width: 6,
    height: 6,
    borderRadius: 3,
    opacity: 0.6,
  },
  shoulderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: 288 + 12,
    marginTop: 6,
  },
  speedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  speedButton: {
    width: 40,
    height: 28,
    borderRadius: 8,
    backgroundColor: '#242526',
    alignItems: 'center',
    justifyContent: 'center',
  },
  speedButtonActive: {backgroundColor: '#4a90d9'},
  speedLabel: {color: '#888', fontSize: 12, fontWeight: '700'},
  speedLabelActive: {color: '#fff'},
  saveOpenButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#254a70',
    marginLeft: 4,
  },
  saveOpenLabel: {color: '#cfe3fa', fontSize: 12, fontWeight: '700'},
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: '#1e2027',
    borderRadius: 18,
    padding: 20,
    alignItems: 'center',
    width: '100%',
    maxWidth: 340,
  },
  modalTitle: {color: '#fff', fontSize: 17, fontWeight: '800'},
  modalSubtitle: {color: '#888', fontSize: 12, textAlign: 'center', marginTop: 6, marginBottom: 16},
  modalCloseButton: {
    marginTop: 18,
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 10,
    backgroundColor: '#2f5f8f',
  },
  modalCloseLabel: {color: '#fff', fontWeight: '700', fontSize: 13},
  slotsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  slotCard: {
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: '#242526',
    width: 96,
  },
  slotLabel: {color: '#ddd', fontSize: 12, fontWeight: '700'},
  slotMeta: {color: '#777', fontSize: 10},
  slotActions: {flexDirection: 'row', gap: 4, marginTop: 4},
  slotActionButton: {
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderRadius: 6,
    backgroundColor: '#3a5a7a',
  },
  slotActionButtonDisabled: {backgroundColor: '#2a2a2a', opacity: 0.5},
  slotActionLabel: {color: '#fff', fontSize: 9, fontWeight: '700'},
  slotActionLabelDisabled: {color: '#777'},
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
    marginTop: 12,
  },
  dpad: {width: 144, alignItems: 'center'},
  dpadRow: {flexDirection: 'row'},
  dpadSpacer: {width: 48, height: 48},
  dpadCenter: {width: 48, height: 48, backgroundColor: '#262626'},
  dpadButton: {
    width: 48,
    height: 48,
    backgroundColor: '#33353c',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 4,
  },
  dpadHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '40%',
    backgroundColor: 'rgba(255,255,255,0.08)',
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
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 3},
    shadowOpacity: 0.35,
    shadowRadius: 4,
    elevation: 6,
  },
  actionHighlight: {
    position: 'absolute',
    top: 0,
    left: 6,
    right: 6,
    height: '42%',
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  buttonA: {top: 0, right: 0, backgroundColor: '#c2536a'},
  buttonB: {bottom: 0, left: 0},
  actionLabel: {color: '#fff', fontSize: 20, fontWeight: '700'},
  systemRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginTop: 14,
  },
  pillButton: {
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 14,
    transform: [{rotate: '-15deg'}],
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 3,
  },
  pillButtonSelect: {backgroundColor: '#3a3d47'},
  pillButtonStart: {backgroundColor: '#454040'},
  pillHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '45%',
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  pillLabel: {color: '#ddd', fontSize: 11, fontWeight: '700'},
});

export default App;
