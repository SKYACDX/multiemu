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

import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  GestureResponderEvent,
  ImageBackground,
  Linking,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  ToastAndroid,
  useWindowDimensions,
  View,
} from 'react-native';
import GameBoyView, {GameBoyButton, GameBoyViewHandle} from './src/GameBoyView';
import GbaView, {GbaButton, GbaViewHandle} from './src/GbaView';
import DsView, {DsButton, DsViewHandle} from './src/DsView';
import N3dsView, {
  join3dsRoom,
  leave3dsRoom,
  load3dsSlot,
  N3DS_ROOM_COUNT,
  N3DS_ROOM_ERRORS,
  N3DS_ROOM_JOINED_STATES,
  N3dsButton,
  n3dsRoomStatus,
  n3dsDownloadSlot,
  n3dsGameKey,
  n3dsLocalSave,
  n3dsRestoreSave,
  n3dsSlotSize,
  n3dsUploadSlot,
  N3dsViewHandle,
  n3dsZipFingerprint,
  save3dsSlot,
} from './src/N3dsView';
import {IconCloud, IconHome, IconMenu, IconPencil, IconSave, IconTrash, IconTriangle} from './src/icons';
import HomeScreen from './src/HomeScreen';
import FolderScreen from './src/FolderScreen';
import HubScreen from './src/HubScreen';
import LocalLinkScreen from './src/LocalLinkScreen';
import AccountScreen from './src/AccountScreen';
import FeedbackScreen from './src/FeedbackScreen';
import ThemeEditorScreen from './src/ThemeEditorScreen';
import ThemesExploreScreen from './src/ThemesExploreScreen';
import {createTheme, incrementThemeDownload, updateTheme} from './src/api/themes';
import {defaultTheme, resolveControlStyle, Theme, withAlpha} from './src/theme';
import {dsBannerTitle, readRomTitle} from './src/romTitle';
import {
  downloadRomToPath,
  InvalidRomExtensionError,
  pickRomFilePath,
  readFileAsBase64,
  readFileHeaderBase64,
  readRomIcon,
  RomPickerCancelledError,
} from './src/RomFilePicker';
import {
  CachedRom,
  clearAuthSession,
  deleteCachedRom,
  FolderFile,
  FolderPickerCancelledError,
  deleteStateSlot,
  getAuthSession,
  getLastFolder,
  listCachedRoms,
  listRomFolder,
  dsSaveId,
  legacyDsSaveId,
  romCrc32,
  romTitle,
  pickSaveToImport,
  exportSave,
  writeCloudBackup,
  listStateSlots,
  loadCachedRom,
  loadCachedRomPath,
  loadStateSlot,
  pickRomFolder,
  readRomFromFolder,
  saveAuthSession,
  saveRomToCache,
  saveRomToCachePath,
  saveStateSlot,
  StateSlot,
  getPreference,
  setPreference,
  getAppVersionCode,
  getAppVersionName,
} from './src/RomLibraryNative';
import {
  ejectGbaCart,
  getAudioDebugInfo,
  getGameSaveBytes,
  insertGbaCart,
  loadDsState,
  loadGbaState,
  saveDsState,
  saveGbaState,
} from './src/EmulatorControlNative';
import {base64ToBytes, bytesToBase64} from './src/base64';
import {crc32} from './src/patchers/crc32';
import {applyPatch, detectPatchExt, SupportedPatchExt} from './src/patchers';
import {downloadPatchBytes, findCoverArt, getAppInfo, Hack, Patch, RomHackHubFile} from './src/api/romHackHub';
import {
  setSessionRejectedHandler,
  cloudSaveDownloadUrl,
  CloudSave,
  cleanSaveTitle,
  deleteCloudSave,
  downloadCloudSave,
  listCloudSaves,
  login as accountLogin,
  TotpRequiredError,
  uploadCloudSave,
  uploadCloudSaveVia,
  setCloudSaveTitle,
  verifyTotp as accountVerifyTotp,
} from './src/api/romHackHubAccount';
import {extractFromZip} from './src/zip';
import {TEST_ROM_BASE64} from './src/testRom';

const PATCH_EXTENSIONS: SupportedPatchExt[] = ['ips', 'bps', 'ups'];

type Screen = 'home' | 'game' | 'hub' | 'folder' | 'account' | 'localLink' | 'themeEditor' | 'themesExplore' | 'feedback';
type EmulatedSystem = 'gb' | 'gba' | 'nds' | '3ds';
type PadButtonId =
  | 'UP' | 'DOWN' | 'LEFT' | 'RIGHT' | 'A' | 'B' | 'L' | 'R' | 'X' | 'Y' | 'ZL' | 'ZR' | 'SELECT' | 'START';

// Draggable clusters a user can reposition in "Personalizar controles"
// mode -- grouped (whole D-pad, whole A/B) rather than per-button, which
// covers "mover los botones" without needing a drag handle for all 12.
// 'shoulderL'/'shoulderR' position L and R *separately*; 'shoulders'
// survives only as their shared scale target (they are meant to stay
// the same size) and as the key older saved layouts used for both.
type ClusterId = 'dpad' | 'actions' | 'shoulders' | 'shoulderL' | 'shoulderR' | 'xy' | 'system' | 'screen';
type ClusterOffset = {dx: number; dy: number};
// Everything the user can resize independently in "editar interfaz" --
// the emulator screen plus each draggable cluster. Each keeps its own
// scale (applied as a paint-time transform, so scaling one never moves
// or resizes anything else) instead of one shared "screenScale" that
// used to apply to the screen alone.
type ScalableId = ClusterId;
interface ControlLayout {
  offsets: Partial<Record<ClusterId, ClusterOffset>>;
  scales: Partial<Record<ScalableId, number>>;
  // 2 since portrait screens default to the full width; see the loader.
  v?: number;
}
const CONTROL_LAYOUT_VERSION = 2;
const DEFAULT_CONTROL_LAYOUT: ControlLayout = {offsets: {}, scales: {}};
/**
 * L and R used to be one draggable cluster keyed 'shoulders'; they are
 * two now (see ClusterId). A layout saved before that split carries the
 * user's positioning under the old key, so hand it to both halves --
 * they were moved together, so together is where they belong. Without
 * this they'd silently snap back to the default and the user would just
 * see their arrangement undone by an update.
 */
function migrateControlLayout(layout: ControlLayout): ControlLayout {
  const shared = layout.offsets?.shoulders;
  if (!shared || layout.offsets.shoulderL || layout.offsets.shoulderR) return layout;
  return {...layout, offsets: {...layout.offsets, shoulderL: shared, shoulderR: shared}};
}
// Landscape has no drag-to-reposition (controls sit at fixed corners,
// see GameControls' landscape branch) -- the screen defaults bigger
// since landscape has a lot more room to give it once it's not stacked
// above a column of controls.
const DEFAULT_CONTROL_LAYOUT_LANDSCAPE: ControlLayout = {offsets: {}, scales: {screen: 2}};
// The DS stacks two screens in the same box one GB/GBA screen gets, so at
// scale 1 each half comes out noticeably smaller than a GBA screen does.
// 1.4 is a deliberate choice of size over clearance: it fills the width,
// and the cost is that the d-pad and the X button sit over the last ~70px
// of the lower (touch) screen. That only blocks touches that land on a
// button -- the shared touch surface hit-tests the real button rects, so
// the rest of the lower screen still reaches the DS -- and both are
// draggable if a particular game needs that strip. 1.2 is the largest
// step that clears them completely. Kept as
// a module constant (like the two above) because defaultControlLayout is
// a useEffect dependency: building the object inline would make it a new
// reference every render and reload the layout on each one.
const DEFAULT_CONTROL_LAYOUT_NDS: ControlLayout = {offsets: {}, scales: {screen: 1.4}};
// Landscape cluster anchors are positioned `top: stageHeight - MARGIN -
// <cluster height>` (see GameControls' landscape branch) -- these mirror
// the matching styles.landscape*Wrap heights below so the two can't drift
// out of sync (a taller dpad without a matching offset update would push
// it toward the bottom edge of the screen again).
const LANDSCAPE_EDGE_MARGIN = 20;
const LANDSCAPE_DPAD_HEIGHT = 144;
const LANDSCAPE_ACTIONS_HEIGHT = 110;
// Side of the DS face-button diamond (styles.actionClusterDs). Taller
// than the GBA's two-button cluster, so landscape's bottom-anchored top:
// has to account for it or the diamond hangs off the edge.
const DS_DIAMOND_SIZE = 160;
const LANDSCAPE_SYSTEM_ROW_HEIGHT = 40;
const MIN_SCALE = 0.7;
// The screen is now decoupled from every cluster's layout (see
// portraitStage/landscapeStage) and its rendered size is separately
// capped to the device's own width/height (see scaledScreenStyle), so
// both orientations can share one generous ceiling -- nothing it can
// grow into displaces a button anymore.
const MAX_SCREEN_SCALE = 4;
// Clusters (dpad, A/B, L/R, SELECT/START, X/Y) scale from their own
// center in place, so a lower ceiling than the screen's is enough
// headroom before they start overlapping their neighbors.
const MAX_CLUSTER_SCALE = 2;
const SCALE_TARGETS: {id: ScalableId; label: string}[] = [
  {id: 'screen', label: 'Pantalla'},
  {id: 'dpad', label: 'Dpad'},
  {id: 'actions', label: 'A/B'},
  {id: 'shoulders', label: 'L/R'},
  {id: 'system', label: 'Start/Select'},
];

// Only accept what one of the cores can actually run, so picking the wrong
// file fails fast with a clear message instead of silently loading garbage.
// 3DS games have to be decrypted dumps (.3ds/.cci/.cxi).
const N3DS_EXTENSIONS = ['3ds', 'cci', 'cxi'];
const SUPPORTED_ROM_EXTENSIONS = ['gb', 'gbc', 'gba', 'nds', ...N3DS_EXTENSIONS];
// The folder browser reads a ROM whole into JS, which a 1-4GB 3DS game
// can't survive -- those open through "Cargar un archivo" instead.
const FOLDER_ROM_EXTENSIONS = SUPPORTED_ROM_EXTENSIONS.filter(e => !N3DS_EXTENSIONS.includes(e));

function systemForExtension(extension: string): EmulatedSystem {
  const ext = extension.toLowerCase();
  if (N3DS_EXTENSIONS.includes(ext)) return '3ds';
  if (ext === 'gba') return 'gba';
  if (ext === 'nds') return 'nds';
  return 'gb';
}

/** RomHack Hub platform slugs -> which core plays that platform. */
function systemForPlatformSlug(slug: string): EmulatedSystem {
  return slug === 'gba' ? 'gba' : 'gb';
}

// Cloud saves share one list per gameKey; this slot number is reserved
// for the cartridge's own in-game save (as opposed to slots 0-2, which
// are manual full-state saves) so both kinds can live side by side.
// Must be >=0 -- RomHack Hub's API rejects negative slot numbers.
const GAME_SAVE_CLOUD_SLOT = 99;

// A 3DS state from the desktop port can't load on Android, or one from
// Android there: Azahar serializes with boost's binary archive, which isn't
// portable (a `long` is 4 bytes on Windows, 8 on Android arm64). So the two
// keep their 3DS states in separate cloud slots -- Windows 0-3, Android 10-13
// -- rather than overwriting each other's with something unusable.
const N3DS_CLOUD_STATE_SLOT_BASE = 10;
/**
 * Moves a DS game's cloud saves from its pre-1.17 key (nds:<name>-<size>) to
 * the desktop app's (nds:<crc32>), slot by slot: copy, then delete the old
 * one. A slot the new key already has is left alone on both sides -- the
 * upload is an upsert, and the new key's copy may be the Windows app's.
 *
 * Losing a cloud save can't be undone, so the old copy is only deleted once
 * a fresh listing shows the new key holding that slot at the same size. A
 * slot that fails (say another device migrated it a moment ago and the old
 * one is already gone -- a 404) is skipped without stopping the others. The
 * copy gets a generic file name, not whatever the old one carried.
 */
async function moveLegacyDsCloudSaves(token: string, legacyId: string, romId: string, title: string | null) {
  const saves = await listCloudSaves(token);
  const newKey = `nds:${romId}`;
  for (const old of saves.filter(save => save.gameKey === `nds:${legacyId}`)) {
    if (saves.some(save => save.gameKey === newKey && save.slot === old.slot)) continue;
    try {
      const bytes = await downloadCloudSave(token, old.id);
      const fileName = old.slot === GAME_SAVE_CLOUD_SLOT ? 'game.sav' : `slot${old.slot}.sav`;
      await uploadCloudSave(token, newKey, old.slot, bytes, fileName, title ?? old.title);
      const copied = (await listCloudSaves(token)).some(
        save => save.gameKey === newKey && save.slot === old.slot && save.fileSize === bytes.length,
      );
      if (copied) await deleteCloudSave(token, old.id);
    } catch {
      // Left as it was; the next time the game opens tries again.
    }
  }
}

const TITLED_KEYS_PREFERENCE = 'cloudSaveTitlesSent';

/**
 * Names the account's cloud saves that have no title yet, from the ROMs in
 * Recientes (RomHack Hub's public profile shows the name, never the key).
 * Each key is named once -- remembered in a preference -- and only from the
 * ROM itself (romTitle), never its file name. Skips a system with nothing
 * to name, so DS ROMs aren't hashed for nothing.
 */
async function nameUntitledCloudSaves(token: string) {
  const untitled = new Set(
    (await listCloudSaves(token)).filter(save => !save.title).map(save => save.gameKey),
  );
  const sent: string[] = JSON.parse((await getPreference(TITLED_KEYS_PREFERENCE)) ?? '[]');
  sent.forEach(key => untitled.delete(key));
  if (!untitled.size) return;
  const wanted = (prefix: string) => [...untitled].some(key => key.startsWith(`${prefix}:`));
  for (const rom of await listCachedRoms()) {
    if (!untitled.size) break;
    if (!wanted(rom.system)) continue;
    try {
      const path = await loadCachedRomPath(rom.id);
      const keys =
        rom.system === '3ds'
          ? [await n3dsGameKey(path)]
          : [`${rom.system}:${await romCrc32(path)}`, ...(rom.system === 'nds' ? [`nds:${legacyDsSaveId(rom.name, rom.size)}`] : [])];
      const key = keys.find(candidate => untitled.has(candidate));
      if (!key) continue;
      const title = cleanSaveTitle(await romTitle(path, rom.system));
      if (title) await setCloudSaveTitle(token, key, title);
      sent.push(key);
      untitled.delete(key);
    } catch {
      // That ROM is gone or the request failed: try again next time.
    }
  }
  await setPreference(TITLED_KEYS_PREFERENCE, JSON.stringify(sent));
}

const cloudStateSlot = (system: EmulatedSystem, slot: number) =>
  system === '3ds' ? N3DS_CLOUD_STATE_SLOT_BASE + slot : slot;

// A 4th state slot, written automatically (see the autosave effect
// below) so a crash or an accidental close doesn't cost hours of
// progress -- separate from the 3 the user manages by hand.
const AUTOSAVE_SLOT = 3;
const AUTOSAVE_INTERVAL_MS = 45_000;

const PLATFORM_LABEL: Record<EmulatedSystem, string> = {
  gb: 'Game Boy / Color',
  gba: 'Game Boy Advance',
  nds: 'Nintendo DS',
  '3ds': 'Nintendo 3DS',
};

function App(): React.JSX.Element {
  // The Activity survives rotation (see AndroidManifest.xml's
  // configChanges), so this is the only signal driving the
  // landscape/portrait layout switch below -- no remount, no lost
  // emulator state.
  const {width: windowWidth, height: windowHeight} = useWindowDimensions();
  const isLandscape = windowWidth > windowHeight;
  // landscapeStage's own onLayout measured a height *larger than the
  // window itself* (566dp against a 411dp-tall window) -- its flex:1
  // lets the scaled-up screenBezel push it taller than the actual
  // viewport instead of clipping to it, and every control positioned
  // with `top` computed from that number landed below the physical
  // screen. Deriving the stage height from the trusted window height
  // instead (and capping the stage's own style to match) keeps both
  // the visible area and the control math grounded in the same number.
  // landscapeHeaderHeight is measured from the top bar + editToolbar
  // container (a plain flex column, not subject to the oversized-content
  // measurement bug above) so opening "editar controles" -- which adds
  // 2-3 rows above the stage -- shrinks stageHeight to match instead of
  // leaving the pre-toolbar estimate stale and pushing every landscape
  // control below the now-smaller visible stage.
  const [landscapeHeaderHeight, setLandscapeHeaderHeight] = useState(40);
  const landscapeStageHeight = Math.max(200, windowHeight - landscapeHeaderHeight - 8);
  const gameBoyRef = useRef<GameBoyViewHandle>(null);
  const gbaRef = useRef<GbaViewHandle>(null);
  const dsRef = useRef<DsViewHandle>(null);
  const n3dsRef = useRef<N3dsViewHandle>(null);
  // NDS's equivalent of baseRomBytes -- there's no byte buffer to keep
  // for it (the whole point of loadRomPath is to avoid ever holding a
  // 128-512MB ROM in JS memory), just the path DsView should read it
  // from. Set by handlePickRom, consumed by the remount effect below.
  const currentDsRomPath = useRef<string | null>(null);
  const current3dsRomPath = useRef<string | null>(null);
  // A 3DS game's cloud key is "3ds:<program ID>" (docs/3ds-cloud-save.md),
  // not "<system>:<romId>": read from the ROM when it opens.
  const current3dsCloudKey = useRef<string | null>(null);
  // The running game's name as its cloud saves carry it (RomHack Hub's
  // profile shows it): read from the ROM, never from the file name.
  const cloudTitle = useRef<string | null>(null);
  // Read by cloudGameKey/readGameSavePaused/checkGameSaveConflict -- a
  // ref (not the system state) so it's never stale/racy relative to
  // those closures, same reasoning as currentRomId.
  const currentSaveSystem = useRef<EmulatedSystem>('gb');
  // "Personalizar controles" -- per-system (a DS layout makes no sense
  // for GB) drag-to-reposition + screen scale, persisted natively (see
  // RomLibraryModule's getPreference/setPreference).
  const [editingControls, setEditingControls] = useState(false);
  // The layout last loaded, with the key it belongs to -- see controlLayout below.
  const [loadedLayout, setLoadedLayout] = useState<{key: string; layout: ControlLayout} | null>(null);
  // Which component the size +/- controls in "editar interfaz" apply to.
  const [scaleTarget, setScaleTarget] = useState<ScalableId>('screen');
  const [theme, setTheme] = useState<Theme>(() => defaultTheme('gb'));
  const [themeBusy, setThemeBusy] = useState(false);
  // Name of the GBA ROM currently inserted in the NDS's slot-2 (Pal
  // Park-style Pokemon transfer), or null if none -- see
  // handleInsertGbaCart. Purely a display label; the actual cart lives
  // in the native DsView/melonDS session and resets whenever the NDS
  // ROM itself reloads (a new DsNative instance has an empty slot-2).
  const [gbaCartLabel, setGbaCartLabel] = useState<string | null>(null);
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
  const [hubInitialTab, setHubInitialTab] = useState<'hacks' | 'files'>('hacks');
  const [romLabel, setRomLabel] = useState('ROM de prueba (franjas)');
  const [busy, setBusy] = useState(false);
  const prevLabelBeforeLoad = useRef('ROM de prueba (franjas)');

  const [recentRoms, setRecentRoms] = useState<CachedRom[]>([]);
  const [lastFolder, setLastFolder] = useState<{uri: string; name: string} | null>(null);
  const [folder, setFolder] = useState<{uri: string; name: string} | null>(null);
  const [folderFiles, setFolderFiles] = useState<FolderFile[]>([]);
  const [folderLoading, setFolderLoading] = useState(false);

  const [speed, setSpeed] = useState<1 | 2 | 3>(1);
  // Manual save states -- GBA and NDS only (mGBA and melonDS both expose
  // full-state save/load; gbcore doesn't implement that yet for GB/GBC,
  // see docs/roadmap.md).
  const [stateSlots, setStateSlots] = useState<StateSlot[]>([]);
  const [saveModalOpen, setSaveModalOpen] = useState(false);

  // Best-effort themed background: RomHack Hub's public files API can
  // return community-uploaded cover art (via TheGamesDB) for a
  // recognized official/hack-of-an-official game -- see findCoverArt.
  // coverLookupId guards against a slow lookup for a previous ROM
  // landing after a newer one has already loaded.
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(null);
  const coverLookupId = useRef(0);
  // The ROM's own icon as the background (DS/3DS) -- for when there's no
  // cover art to look up. Same stale-lookup guard as the cover lookups.
  // A 3DS game's cloud key comes from its own header; once known, the same
  // conflict check GBA/DS get when a game opens.
  const checkGameSaveConflictRef = useRef<((romId: string) => void) | null>(null);
  const loadCloudTitle = (path: string, system: string) => {
    cloudTitle.current = null;
    romTitle(path, system)
      .then(title => (cloudTitle.current = title))
      .catch(() => {});
  };

  const start3dsCloudSync = (path: string, romId: string) => {
    loadCloudTitle(path, '3ds');
    current3dsCloudKey.current = null;
    lastSyncedSaveCrc.current = null;
    saveConflictChecked.current = false;
    n3dsGameKey(path)
      .then(key => {
        current3dsCloudKey.current = key;
        checkGameSaveConflictRef.current?.(romId);
      })
      .catch(() => {});
  };

  const showRomIcon = useCallback((path: string) => {
    const lookupId = ++coverLookupId.current;
    readRomIcon(path).then(url => {
      if (coverLookupId.current === lookupId) setCoverImageUrl(url);
    });
  }, []);

  // RomHack Hub account session -- token kept only in memory + native
  // SharedPreferences (see saveAuthSession/getAuthSession), never in JS
  // persistent storage. pendingTotpToken holds the intermediate token
  // from login() while 2FA verification is in progress.
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [authUsername, setAuthUsername] = useState<string | null>(null);
  const pendingTotpToken = useRef<string | null>(null);
  const [cloudSaves, setCloudSaves] = useState<CloudSave[]>([]);
  const [cloudBusySlot, setCloudBusySlot] = useState<number | null>(null);

  // For the feedback form's appVersion field (see docs/feedback-api.md).
  const [appVersionName, setAppVersionName] = useState('');
  useEffect(() => {
    getAppVersionName()
      .then(setAppVersionName)
      .catch(() => {});
  }, []);

  // A newer release is available and the user hasn't dismissed this
  // exact versionCode yet -- see the update-check effect below.
  const [availableUpdate, setAvailableUpdate] = useState<{version: string; changelog: string; versionCode: number} | null>(
    null,
  );
  const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6h, not on every launch
  const checkForUpdate = useCallback(async () => {
    try {
      const lastCheckedAt = Number((await getPreference('lastUpdateCheckAt')) ?? 0);
      if (Date.now() - lastCheckedAt < UPDATE_CHECK_INTERVAL_MS) return;
      const [{latestRelease}, installedVersionCode, dismissed] = await Promise.all([
        getAppInfo(),
        getAppVersionCode(),
        getPreference('dismissedUpdateVersionCode'),
      ]);
      setPreference('lastUpdateCheckAt', String(Date.now())).catch(() => {});
      if (latestRelease.versionCode <= installedVersionCode) return;
      if (Number(dismissed) === latestRelease.versionCode) return;
      setAvailableUpdate({version: latestRelease.version, changelog: latestRelease.changelog, versionCode: latestRelease.versionCode});
    } catch {
      // No connection, or the endpoint is briefly down -- just try again next check window.
    }
  }, []);

  useEffect(() => {
    checkForUpdate();
    // Most phone usage is "resume from background", not a cold start --
    // a mounted App() never re-runs a []-deps effect on its own, so
    // without this the check could go days without firing for someone
    // who rarely fully closes the app. Same 6h throttle applies either
    // way, this just gives it more chances to actually run.
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') checkForUpdate();
    });
    return () => sub.remove();
  }, [checkForUpdate]);

  const dismissUpdateBanner = useCallback(() => {
    if (availableUpdate) setPreference('dismissedUpdateVersionCode', String(availableUpdate.versionCode)).catch(() => {});
    setAvailableUpdate(null);
  }, [availableUpdate]);

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
    getAuthSession()
      .then(session => {
        if (session) {
          setAuthToken(session.token);
          setAuthUsername(session.username);
          // Is it still alive? A rejected one is caught by the handler
          // below, so the user hears about it now rather than the next
          // time a save quietly fails to sync.
          listCloudSaves(session.token).catch(() => {});
        }
      })
      .catch(() => {});
  }, [refreshRecentRoms]);

  // Signed in (at start-up or just now): name the cloud saves that have no
  // title yet, in the background.
  useEffect(() => {
    if (authToken) nameUntitledCloudSaves(authToken).catch(() => {});
  }, [authToken]);

  const handleLogin = useCallback(async (email: string, password: string, label: string) => {
    try {
      const {token, username} = await accountLogin(email, password, label);
      await saveAuthSession(token, username);
      setAuthToken(token);
      setAuthUsername(username);
      return {needsTotp: false};
    } catch (e) {
      if (e instanceof TotpRequiredError) {
        pendingTotpToken.current = e.pendingToken;
        return {needsTotp: true};
      }
      throw e;
    }
  }, []);

  const handleVerifyTotp = useCallback(async (code: string) => {
    if (!pendingTotpToken.current) throw new Error('La sesión de verificación expiró, intenta de nuevo.');
    const {token, username} = await accountVerifyTotp(pendingTotpToken.current, code, 'multiemu Android');
    pendingTotpToken.current = null;
    await saveAuthSession(token, username);
    setAuthToken(token);
    setAuthUsername(username);
  }, []);

  const handleLogout = useCallback(() => {
    clearAuthSession().catch(() => {});
    setAuthToken(null);
    setAuthUsername(null);
    setCloudSaves([]);
  }, []);

  // The server stopped accepting the saved session (closed from the website,
  // password changed, expired): forget it and say so -- once, however many
  // requests fail at the same time.
  const sessionRejectedShown = useRef(false);
  useEffect(() => {
    setSessionRejectedHandler(() => {
      if (sessionRejectedShown.current) return;
      sessionRejectedShown.current = true;
      handleLogout();
      Alert.alert(
        'Tu sesión se cerró',
        'RomHack Hub ya no reconoce la sesión de este teléfono (se cerró desde la web, cambiaste la ' +
          'contraseña o caducó). Tus guardados no se están sincronizando con la nube. Vuelve a ' +
          'iniciar sesión para seguir.',
        [
          {text: 'Ahora no', style: 'cancel', onPress: () => (sessionRejectedShown.current = false)},
          {
            text: 'Iniciar sesión',
            onPress: () => {
              sessionRejectedShown.current = false;
              setScreen('account');
            },
          },
        ],
      );
    });
    return () => setSessionRejectedHandler(null);
  }, [handleLogout]);

  // gameKey groups cloud saves by ROM regardless of which device produced
  // them -- "<system>:<romId>" so different systems' save formats can't
  // collide (GB never used this -- see the system !== 'gba' guards below
  // -- so the prefix was hardcoded to "gba:" until NDS needed a second
  // one; existing GBA keys are unaffected, they still get exactly that).
  const cloudGameKey = useCallback(() => {
    if (currentSaveSystem.current === '3ds') return current3dsCloudKey.current;
    const romId = currentRomId.current;
    return romId ? `${currentSaveSystem.current}:${romId}` : null;
  }, []);

  // Full-state save/load dispatches to whichever core is actually
  // running -- GB has no equivalent (see the modal's system === 'gba' ||
  // system === 'nds' gates), so this only ever needs to pick between two.
  const saveEmuState = useCallback((): Promise<string> => {
    return currentSaveSystem.current === 'nds' ? saveDsState() : saveGbaState();
  }, []);

  const loadEmuState = useCallback((base64: string): Promise<void> => {
    return currentSaveSystem.current === 'nds' ? loadDsState(base64) : loadGbaState(base64);
  }, []);

  const refreshCloudSaves = useCallback(() => {
    const gameKey = cloudGameKey();
    if (!authToken || !gameKey) {
      setCloudSaves([]);
      return;
    }
    listCloudSaves(authToken)
      .then(saves => setCloudSaves(saves.filter(s => s.gameKey === gameKey)))
      .catch(() => {});
  }, [authToken, cloudGameKey]);

  const handleUploadCloudSlot = useCallback(
    async (slot: number) => {
      const gameKey = cloudGameKey();
      if (!authToken || !gameKey) return;
      setCloudBusySlot(slot);
      try {
        if (currentSaveSystem.current === '3ds') {
          // The state of the running game, like GBA/DS -- written to this
          // slot first, then the file goes up natively (it's ~12MB).
          const romId = currentRomId.current!;
          await save3dsSlot(romId, slot);
          setStateSlots(await listStateSlots(romId));
          const size = await n3dsSlotSize(romId, slot);
          await uploadCloudSaveVia(
            authToken,
            gameKey,
            cloudStateSlot('3ds', slot),
            size,
            `slot${slot}.sav`,
            (url, type) => n3dsUploadSlot(romId, slot, url, type),
            cloudTitle.current,
          );
          refreshCloudSaves();
          return;
        }
        const base64 = await saveEmuState();
        const bytes = base64ToBytes(base64);
        await uploadCloudSave(authToken, gameKey, slot, bytes, `slot${slot}.sav`, cloudTitle.current);
        refreshCloudSaves();
      } catch (e) {
        Alert.alert('No se pudo subir a la nube', e instanceof Error ? e.message : String(e));
      } finally {
        setCloudBusySlot(null);
      }
    },
    [authToken, cloudGameKey, refreshCloudSaves, saveEmuState],
  );

  const handleDownloadCloudSlot = useCallback(
    async (slot: number) => {
      const romId = currentRomId.current;
      if (!authToken || !romId) return;
      const remote = cloudSaves.find(s => s.slot === cloudStateSlot(currentSaveSystem.current, slot));
      if (!remote) return;
      setCloudBusySlot(slot);
      try {
        if (currentSaveSystem.current === '3ds') {
          // Loaded into the game first; the local slot only changes if that
          // worked (a state from a New 3DS may not load here).
          await n3dsDownloadSlot(romId, slot, await cloudSaveDownloadUrl(authToken, remote.id));
          setStateSlots(await listStateSlots(romId));
          closeSaveModal();
          return;
        }
        const bytes = await downloadCloudSave(authToken, remote.id);
        const base64 = bytesToBase64(bytes);
        await loadEmuState(base64);
        // Also persist it locally -- otherwise the slot's own "Cargar"
        // button stays stuck on whatever (or nothing) was there before,
        // even though the game now has this save state loaded live.
        await saveStateSlot(romId, slot, base64);
        setStateSlots(await listStateSlots(romId));
        closeSaveModal();
      } catch (e) {
        Alert.alert('No se pudo descargar de la nube', e instanceof Error ? e.message : String(e));
      } finally {
        setCloudBusySlot(null);
      }
    },
    [authToken, cloudSaves, loadEmuState],
  );

  // The cartridge's own in-game save (SRAM/flash), separate from the 3
  // manual full-state slots above -- this is what the game's own menu
  // reads on "continue". Reuses the same cloud list/slot mechanism with a
  // reserved slot number. Only safe while paused, same as the state
  // slots (see EmulatorControlModule.kt).
  // The in-game save as it goes to the cloud, and the number it's compared
  // by: a GBA/DS .sav and its CRC32, or a 3DS game's save folder as a zip and
  // its content fingerprint (docs/3ds-cloud-save.md). Null while there's no
  // save. newestModified (3DS only) says when the core last wrote to it.
  const readLocalGameSave = useCallback(
    async (romId: string): Promise<{bytes: Uint8Array; crc: number; newestModified?: number} | null> => {
      if (currentSaveSystem.current === '3ds') {
        const path = current3dsRomPath.current;
        const local = path ? await n3dsLocalSave(path) : null;
        return local && {bytes: base64ToBytes(local.base64), crc: local.fingerprint, newestModified: local.newestModified};
      }
      const base64 = await getGameSaveBytes(romId);
      const bytes = base64ToBytes(base64);
      return {bytes, crc: crc32(bytes)};
    },
    [],
  );

  /** The comparable number for a cloud copy; -1 (3DS) for one without progress. */
  const remoteGameSaveCrc = useCallback(
    (bytes: Uint8Array): Promise<number> =>
      currentSaveSystem.current === '3ds' ? n3dsZipFingerprint(bytesToBase64(bytes)) : Promise.resolve(crc32(bytes)),
    [],
  );

  /**
   * Puts a cloud copy in place of the local save. The running game is closed
   * before the file changes (the DS core keeps its save in memory and would
   * write the old one back; GB flushes its RAM on reload), so the caller must
   * reload the ROM right after -- see reloadActiveRom.
   */
  const writeLocalGameSave = useCallback(async (romId: string, bytes: Uint8Array) => {
    const base64 = bytesToBase64(bytes);
    if (currentSaveSystem.current === '3ds') {
      if (current3dsRomPath.current) await n3dsRestoreSave(current3dsRomPath.current, base64);
    } else if (currentSaveSystem.current === 'nds') {
      dsRef.current?.replaceSave(romId, base64);
    } else if (currentSaveSystem.current === 'gba') {
      gbaRef.current?.replaceSave(romId, base64);
    } else {
      gameBoyRef.current?.replaceSave(romId, base64);
    }
  }, []);

  const gameSaveFileName = () => (currentSaveSystem.current === '3ds' ? 'game.zip' : 'game.sav');

  const handleUploadGameSave = useCallback(async () => {
    const romId = currentRomId.current;
    const gameKey = cloudGameKey();
    if (!authToken || !gameKey || !romId) return;
    setCloudBusySlot(GAME_SAVE_CLOUD_SLOT);
    try {
      const local = await readLocalGameSave(romId);
      if (!local) throw new Error('Este juego todavía no ha guardado nada');
      await uploadCloudSave(authToken, gameKey, GAME_SAVE_CLOUD_SLOT, local.bytes, gameSaveFileName(), cloudTitle.current);
      lastSyncedSaveCrc.current = local.crc;
      refreshCloudSaves();
    } catch (e) {
      Alert.alert('No se pudo subir el guardado del juego', e instanceof Error ? e.message : String(e));
    } finally {
      setCloudBusySlot(null);
    }
  }, [authToken, cloudGameKey, readLocalGameSave, refreshCloudSaves]);

  const handleDownloadGameSave = useCallback(async () => {
    const romId = currentRomId.current;
    if (!authToken || !romId) return;
    const remote = cloudSaves.find(s => s.slot === GAME_SAVE_CLOUD_SLOT);
    if (!remote) return;
    setCloudBusySlot(GAME_SAVE_CLOUD_SLOT);
    try {
      const bytes = await downloadCloudSave(authToken, remote.id);
      await writeLocalGameSave(romId, bytes);
      lastSyncedSaveCrc.current = await remoteGameSaveCrc(bytes);
      // The core already has the old save open (mGBA maps it in memory; a
      // 3DS game was just closed) -- restart it on the one just written.
      reloadActiveRom(romId);
      closeSaveModal();
    } catch (e) {
      Alert.alert('No se pudo descargar el guardado del juego', e instanceof Error ? e.message : String(e));
    } finally {
      setCloudBusySlot(null);
    }
  }, [authToken, cloudSaves, writeLocalGameSave, remoteGameSaveCrc]);

  // A save from another emulator (docs/save-import.md): picked and converted
  // natively (SaveNormalizer), confirmed, then put in place with the core
  // closed (replaceSave keeps one .bak of the old one) and the game
  // restarted. It never goes to the cloud behind the user's back: they're
  // asked, and the cloud's current copy is kept on the phone first.
  const applyImportedSave = async (romId: string, bytes: Uint8Array) => {
    closeSaveModal();
    await writeLocalGameSave(romId, bytes);
    // So the auto-sync doesn't upload it on its own: the user decides below.
    lastSyncedSaveCrc.current = crc32(bytes);
    reloadActiveRom(romId);
    const gameKey = cloudGameKey();
    if (!authToken || !gameKey || currentSaveSystem.current === 'gb') {
      Alert.alert('Partida importada', 'El juego se reinició con la partida importada.');
      return;
    }
    Alert.alert(
      'Partida importada',
      'El juego se reinició con la partida importada. ¿Subirla también a la nube? La copia que haya ahora en la nube se guarda en el teléfono antes de reemplazarla.',
      [
        {text: 'Ahora no', style: 'cancel'},
        {
          text: 'Subir',
          onPress: async () => {
            try {
              const remote = (await listCloudSaves(authToken)).find(
                save => save.gameKey === gameKey && save.slot === GAME_SAVE_CLOUD_SLOT,
              );
              if (remote) await writeCloudBackup(romId, bytesToBase64(await downloadCloudSave(authToken, remote.id)));
              await uploadCloudSave(authToken, gameKey, GAME_SAVE_CLOUD_SLOT, bytes, gameSaveFileName(), cloudTitle.current);
              refreshCloudSaves();
            } catch (e) {
              Alert.alert('No se pudo subir la partida', e instanceof Error ? e.message : String(e));
            }
          },
        },
      ],
    );
  };

  const handleImportGameSave = async () => {
    const romId = currentRomId.current;
    const target = currentSaveSystem.current;
    if (!romId || target === '3ds') return;
    let picked: {base64: string; note: string | null};
    try {
      picked = await pickSaveToImport(target);
    } catch (e: any) {
      if (e?.code !== 'CANCELLED') Alert.alert('No se pudo importar', e instanceof Error ? e.message : String(e));
      return;
    }
    Alert.alert(
      '¿Reemplazar la partida de este juego?',
      `${picked.note ? `${picked.note}\n\n` : ''}La partida actual se guarda como copia de seguridad en el teléfono.`,
      [
        {text: 'Cancelar', style: 'cancel'},
        {text: 'Importar', onPress: () => applyImportedSave(romId, base64ToBytes(picked.base64))},
      ],
    );
  };

  const handleExportGameSave = async () => {
    const romId = currentRomId.current;
    if (!romId) return;
    const name = (cloudTitle.current ?? romLabel).replace(/[\\/:*?"<>|]/g, '').trim() || 'partida';
    try {
      await exportSave(romId, `${name}.sav`);
      Alert.alert('Partida exportada', 'Se guardó una copia de la partida de este juego.');
    } catch (e: any) {
      if (e?.code !== 'CANCELLED') Alert.alert('No se pudo exportar', e instanceof Error ? e.message : String(e));
    }
  };

  // CRC of the game-save bytes as of the last successful upload/download,
  // so the periodic auto-sync effect can tell "changed since we last
  // synced" from "nothing new to push" without re-uploading every tick.
  const lastSyncedSaveCrc = useRef<number | null>(null);
  // True once checkGameSaveConflict has actually resolved (found no
  // conflict, or the user picked a side) for the currently-loaded ROM --
  // reset to false alongside lastSyncedSaveCrc whenever a new ROM loads.
  // Fixes a real data-loss bug: autoSyncGameSave used to compare against
  // lastSyncedSaveCrc's initial `null` and treat any local save as "new",
  // silently overwriting a real cloud save the moment its 45s timer fired
  // -- which happens whenever the user logs in *after* the ROM already
  // loaded (a fresh install has no session yet), since the one-time
  // conflict check at load time bails out early with no session to check
  // against and never gets retried on its own.
  const saveConflictChecked = useRef(false);

  // Pauses whichever view is actually showing a game -- see
  // currentSaveSystem's own comment for why this reads that ref instead
  // of the system state.
  const setActiveViewPaused = useCallback((paused: boolean) => {
    if (currentSaveSystem.current === '3ds') {
      n3dsRef.current?.setPaused(paused);
    } else if (currentSaveSystem.current === 'nds') {
      dsRef.current?.setPaused(paused);
    } else {
      gbaRef.current?.setPaused(paused);
    }
  }, []);

  // Reading the .sav file while the core is actively running risks
  // catching it mid-write (both mGBA and melonDS write straight through
  // as the game saves) -- pausing for the handful of milliseconds a
  // small SRAM/flash file takes to read is cheap insurance and reuses
  // the same pause the manual-save modal already relies on.
  const readGameSavePaused = useCallback(async (romId: string): Promise<string | null> => {
    setActiveViewPaused(true);
    try {
      return await getGameSaveBytes(romId);
    } catch {
      return null;
    } finally {
      setActiveViewPaused(saveModalOpen ? true : false);
    }
  }, [saveModalOpen, setActiveViewPaused]);

  const reloadActiveRom = useCallback((romId: string) => {
    if (currentSaveSystem.current === '3ds') {
      if (current3dsRomPath.current) n3dsRef.current?.loadRomPath(current3dsRomPath.current);
    } else if (currentSaveSystem.current === 'nds') {
      if (currentDsRomPath.current) dsRef.current?.loadRomPath(currentDsRomPath.current, romId);
    } else if (currentSaveSystem.current === 'gba') {
      gbaRef.current?.loadRomBase64(bytesToBase64(baseRomBytes.current), romId);
    } else {
      gameBoyRef.current?.loadRomBase64(bytesToBase64(baseRomBytes.current), romId);
    }
  }, []);

  /** "10/09/2026, 14:35" -- for the cloud-conflict alerts and the save modal's cloud row, so the user can tell versions apart before picking one. */
  const formatCloudTimestamp = (iso: string) =>
    new Date(iso).toLocaleString(undefined, {day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'});

  // The id a DS game's save had before 1.17 ("<name>-<size>"); see
  // moveLegacyDsCloudSaves.
  const dsLegacySaveId = useRef<string | null>(null);

  // Right after loading a ROM (see loadIntoEmulator/handlePickRom), or
  // from autoSyncGameSave's first tick for a ROM if this hasn't run yet
  // (see saveConflictChecked): if the user is logged in and the device's
  // save differs from the cloud's, ask which one should win instead of
  // silently picking one and possibly costing them progress either way.
  const checkGameSaveConflict = useCallback(
    async (romId: string) => {
      const gameKey = cloudGameKey();
      if (!authToken || !gameKey) return;
      try {
        if (currentSaveSystem.current === 'nds' && dsLegacySaveId.current && dsLegacySaveId.current !== romId) {
          await moveLegacyDsCloudSaves(authToken, dsLegacySaveId.current, romId, cloudTitle.current);
        }
        const saves = await listCloudSaves(authToken);
        const remote = saves.find(s => s.gameKey === gameKey && s.slot === GAME_SAVE_CLOUD_SLOT);
        const local = currentSaveSystem.current === '3ds' ? await readLocalGameSave(romId) : null;
        const localBase64 = currentSaveSystem.current === '3ds' ? null : await readGameSavePaused(romId);
        const localBytes = local ? local.bytes : localBase64 ? base64ToBytes(localBase64) : null;
        const localCrc = local ? local.crc : localBytes ? crc32(localBytes) : null;

        if (!remote) {
          saveConflictChecked.current = true; // Nothing in the cloud yet -- the autosync timer will create it.
          return;
        }

        const remoteBytes = await downloadCloudSave(authToken, remote.id);
        const remoteCrc = await remoteGameSaveCrc(remoteBytes);
        const remoteDate = formatCloudTimestamp(remote.updatedAt);

        // A cloud copy with no progress in it (3DS: just the core's metadata)
        // is nothing worth offering over the local save.
        if (localCrc === remoteCrc || remoteCrc === -1) {
          lastSyncedSaveCrc.current = remoteCrc;
          saveConflictChecked.current = true;
          return;
        }

        if (localCrc === null) {
          Alert.alert(
            'Guardado en la nube encontrado',
            `Este juego no tiene datos locales, pero sí un guardado en la nube del ${remoteDate}. ¿Descargarlo?`,
            [
              {text: 'No', style: 'cancel', onPress: () => (saveConflictChecked.current = true)},
              {
                text: 'Descargar',
                onPress: async () => {
                  await writeLocalGameSave(romId, remoteBytes);
                  lastSyncedSaveCrc.current = remoteCrc;
                  saveConflictChecked.current = true;
                  reloadActiveRom(romId);
                },
              },
            ],
          );
          return;
        }

        Alert.alert(
          'El guardado de este juego no coincide con la nube',
          `La nube tiene una versión del ${remoteDate}. ¿Cuál quieres conservar?`,
          [
            {
              text: 'Este dispositivo',
              onPress: async () => {
                await uploadCloudSave(authToken, gameKey, GAME_SAVE_CLOUD_SLOT, localBytes!, gameSaveFileName(), cloudTitle.current);
                lastSyncedSaveCrc.current = localCrc;
                saveConflictChecked.current = true;
                refreshCloudSaves();
              },
            },
            {
              text: 'La nube',
              onPress: async () => {
                await writeLocalGameSave(romId, remoteBytes);
                lastSyncedSaveCrc.current = remoteCrc;
                saveConflictChecked.current = true;
                reloadActiveRom(romId);
              },
            },
          ],
        );
      } catch {
        // Best-effort -- skip silently, the manual Subir/Bajar buttons still work.
      }
    },
    [authToken, cloudGameKey, readGameSavePaused, readLocalGameSave, refreshCloudSaves, reloadActiveRom, remoteGameSaveCrc, writeLocalGameSave],
  );
  checkGameSaveConflictRef.current = checkGameSaveConflict;

  // Silently pushes the current in-game save to the cloud if it changed
  // since the last sync -- the "cada que haya un cambio... se actualice
  // automáticamente" ask. Runs on a timer while playing (see the effect
  // below) instead of hooking every individual SRAM write, which
  // neither core exposes a callback for. NDS's cartridge save is small
  // (same as GBA's SRAM/flash) even though its ROM isn't, so this reuses
  // the exact same path -- only the full-state autosave below is
  // GBA-only.
  // settled: the game is paused or closed, so nothing is mid-write (see the
  // 3DS check below).
  const autoSyncGameSave = useCallback(async (settled = false) => {
    const romId = currentRomId.current;
    const gameKey = cloudGameKey();
    if (!authToken || !gameKey || !romId || (system !== 'gba' && system !== 'nds' && system !== '3ds')) return;
    // Never push blind: the very first sync for this ROM (typically
    // "logged in after the ROM was already loaded") must reconcile
    // against whatever's already in the cloud instead of assuming local
    // is authoritative -- see saveConflictChecked's own comment.
    if (!saveConflictChecked.current) {
      checkGameSaveConflict(romId);
      return;
    }
    let local: {bytes: Uint8Array; crc: number; newestModified?: number} | null;
    if (system === '3ds') {
      local = await readLocalGameSave(romId).catch(() => null);
      // A 3DS save is many files the core writes straight into while the
      // game runs: one touched in the last 5s may be half written.
      if (local && !settled && Date.now() - (local.newestModified ?? 0) < 5000) return;
    } else {
      const base64 = await readGameSavePaused(romId);
      local = base64 ? {bytes: base64ToBytes(base64), crc: crc32(base64ToBytes(base64))} : null;
    }
    if (!local || local.crc === lastSyncedSaveCrc.current) return;
    try {
      await uploadCloudSave(authToken, gameKey, GAME_SAVE_CLOUD_SLOT, local.bytes, gameSaveFileName(), cloudTitle.current);
      lastSyncedSaveCrc.current = local.crc;
      refreshCloudSaves();
    } catch {
      // Best-effort -- the next tick (or the manual "Subir" button) retries.
    }
  }, [authToken, cloudGameKey, readGameSavePaused, readLocalGameSave, refreshCloudSaves, system, checkGameSaveConflict]);

  useEffect(() => {
    if (screen !== 'game' || (system !== 'gba' && system !== 'nds' && system !== '3ds') || !authToken) return;
    const interval = setInterval(() => autoSyncGameSave(), AUTOSAVE_INTERVAL_MS);
    const sub = AppState.addEventListener('change', state => {
      // Backgrounded: the game pauses with the window, nothing is mid-write.
      if (state !== 'active') autoSyncGameSave(true);
    });
    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, [screen, system, authToken, autoSyncGameSave]);

  // Logging in *after* a ROM is already loaded skips the one-time
  // conflict check at load time (no session to check against yet, see
  // checkGameSaveConflict's own call sites) -- this catches up the
  // instant a session appears instead of waiting up to AUTOSAVE_INTERVAL_MS
  // for autoSyncGameSave's own fallback to kick in.
  useEffect(() => {
    if (screen !== 'game' || (system !== 'gba' && system !== 'nds' && system !== '3ds') || !authToken) return;
    if (saveConflictChecked.current) return;
    const romId = currentRomId.current;
    if (romId) checkGameSaveConflict(romId);
  }, [screen, system, authToken, checkGameSaveConflict]);

  // A full-state autosave (slot 3, see AUTOSAVE_SLOT) so a crash or the
  // app getting killed doesn't lose progress -- separate from the cloud
  // sync above, which only covers the cartridge's own SRAM/flash save.
  const autoSaveState = useCallback(async () => {
    const romId = currentRomId.current;
    if (!romId || (system !== 'gba' && system !== 'nds' && system !== '3ds') || saveModalOpen) return;
    try {
      if (system === '3ds') {
        await save3dsSlot(romId, AUTOSAVE_SLOT);
        return;
      }
      const base64 = await saveEmuState();
      await saveStateSlot(romId, AUTOSAVE_SLOT, base64);
    } catch {
      // Best-effort -- silent, this isn't user-initiated.
    }
  }, [system, saveModalOpen, saveEmuState]);

  useEffect(() => {
    if (screen !== 'game' || (system !== 'gba' && system !== 'nds' && system !== '3ds')) return;
    // A 3DS state takes ~3s to write on a mid-range phone, which would
    // freeze the game every 45s: it autosaves only on the way out (here,
    // and in confirmExitToHome).
    const interval = system === '3ds' ? null : setInterval(autoSaveState, AUTOSAVE_INTERVAL_MS);
    const sub = AppState.addEventListener('change', state => {
      if (state !== 'active') autoSaveState();
    });
    return () => {
      if (interval) clearInterval(interval);
      sub.remove();
    };
  }, [screen, system, autoSaveState]);

  // Pausing on backgrounding is handled natively (EmulatorControlModule's
  // Activity lifecycle listener sets GbaView's pausedByBackground
  // directly) rather than from here -- an AppState-driven version left
  // audio audibly running, at an uneven OS-throttled rate, for a
  // stretch after backgrounding, consistent with that JS event not
  // arriving promptly while the app loses foreground.

  // After overwriting the local .sav from the cloud below, the running
  // core needs to reload it from disk -- neither core exposes a "reload
  // save without resetting" call, so this just reloads the whole ROM
  // (cheap either way: GBA's bytes are already in memory, NDS's native
  // side re-reads its own path).
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
      dsLegacySaveId.current = null; // already keyed by CRC32 -- nothing to move
      cloudTitle.current =
        (targetSystem === 'nds' ? dsBannerTitle(bytes) : null) ?? (readRomTitle(bytes, targetSystem) || null);
      currentSaveSystem.current = targetSystem;
      setRomLabel(label);
      setSystem(targetSystem);
      setScreen('game');
      setSpeed(1);
      setCoverImageUrl(null);

      {
        const lookupId = ++coverLookupId.current;
        const romTitle = readRomTitle(bytes, targetSystem);
        findCoverArt(targetSystem, romTitle).then(url => {
          if (coverLookupId.current === lookupId) setCoverImageUrl(url);
        });
      }

      const encoded = base64 ?? bytesToBase64(bytes);
      lastSyncedSaveCrc.current = null;
      saveConflictChecked.current = false;
      if (targetSystem === 'gba') {
        gbaRef.current?.loadRomBase64(encoded, currentRomId.current);
        gbaRef.current?.setSpeedMultiplier(1);
        listStateSlots(currentRomId.current)
          .then(setStateSlots)
          .catch(() => setStateSlots([]));
        // Delayed so the native side has finished creating/opening the
        // ROM's save file before we try to read it (loadRomBase64 above
        // is a fire-and-forget command dispatch, not an awaited call).
        const romId = currentRomId.current;
        setTimeout(() => checkGameSaveConflict(romId), 500);
      } else if (targetSystem === 'nds') {
        dsRef.current?.loadRomBase64(encoded, currentRomId.current);
        setGbaCartLabel(null);
        listStateSlots(currentRomId.current)
          .then(setStateSlots)
          .catch(() => setStateSlots([]));
        const romId = currentRomId.current;
        setTimeout(() => checkGameSaveConflict(romId), 500);
      } else {
        gameBoyRef.current?.loadRomBase64(encoded, currentRomId.current);
        gameBoyRef.current?.setSpeedMultiplier(1);
        setStateSlots([]);
      }
      return encoded;
    },
    [checkGameSaveConflict],
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

  // The in-game menu: speed, saves and the controls editor, out of the way
  // of the screen and the buttons. The game pauses while it is open.
  const [menuOpen, setMenuOpen] = useState(false);
  const openMenu = useCallback(() => {
    setActiveViewPaused(true);
    setMenuOpen(true);
  }, [setActiveViewPaused]);
  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    setActiveViewPaused(false);
  }, [setActiveViewPaused]);

  // 3DS local wireless over the internet: this console and another phone or
  // PC in the same room on the room server (see N3dsView.tsx). Joining and
  // dropping out happen on the room's own threads, so the status is polled.
  const [n3dsRoom, setN3dsRoom] = useState<number | null>(null); // joined or being joined
  const [n3dsRoomPick, setN3dsRoomPick] = useState(1);
  const [n3dsRoomJoined, setN3dsRoomJoined] = useState(false);
  const [n3dsRoomMembers, setN3dsRoomMembers] = useState(0);
  const handleJoin3dsRoom = useCallback(() => {
    setN3dsRoom(n3dsRoomPick);
    setN3dsRoomJoined(false);
    join3dsRoom(n3dsRoomPick);
  }, [n3dsRoomPick]);
  const handleLeave3dsRoom = useCallback(() => {
    leave3dsRoom();
    setN3dsRoom(null);
    setN3dsRoomJoined(false);
  }, []);
  useEffect(() => {
    if (n3dsRoom === null) return;
    // Leaving the game leaves the room: the 3DS game itself outlives the
    // screen (N3dsSession), so it would otherwise stay in it.
    if (screen !== 'game' || system !== '3ds') {
      handleLeave3dsRoom();
      return;
    }
    let joined = false;
    const interval = setInterval(() => {
      n3dsRoomStatus()
        .then(status => {
          const nowJoined = N3DS_ROOM_JOINED_STATES.includes(status.state);
          setN3dsRoomMembers(status.members);
          if (nowJoined !== joined) {
            joined = nowJoined;
            setN3dsRoomJoined(nowJoined);
            if (nowJoined) ToastAndroid.show(`Conectado a la sala ${n3dsRoom}`, ToastAndroid.SHORT);
          }
          if (!nowJoined && status.error >= 0) {
            ToastAndroid.show(N3DS_ROOM_ERRORS[status.error] ?? 'No se pudo conectar a la sala', ToastAndroid.LONG);
            setN3dsRoom(null);
            setN3dsRoomJoined(false);
          }
        })
        .catch(() => {});
    }, 1000);
    return () => clearInterval(interval);
  }, [n3dsRoom, screen, system, handleLeave3dsRoom]);

  // Home is one tap from the controls, so it asks first: leaving by
  // accident drops whatever happened since the last save.
  const confirmExitToHome = useCallback(() => {
    Alert.alert('¿Salir del juego?', 'Volverás al inicio. Lo que no hayas guardado podría perderse.', [
      {text: 'Seguir jugando', style: 'cancel'},
      {
        text: 'Salir',
        style: 'destructive',
        onPress: () => {
          setMenuOpen(false);
          setEditingControls(false);
          // The 3DS game outlives its view (N3dsSession), so this still
          // saves it after the screen is gone.
          if (system === '3ds') {
            autoSaveState();
            autoSyncGameSave(true);
          }
          setScreen('home');
        },
      },
    ]);
  }, [system, autoSaveState, autoSyncGameSave]);

  const openSaveModal = useCallback(() => {
    setSaveModalOpen(true);
    setActiveViewPaused(true);
    if (currentRomId.current) {
      listStateSlots(currentRomId.current)
        .then(setStateSlots)
        .catch(() => {});
    }
    refreshCloudSaves();
  }, [refreshCloudSaves, setActiveViewPaused]);

  const closeSaveModal = useCallback(() => {
    setSaveModalOpen(false);
    setActiveViewPaused(false);
  }, [setActiveViewPaused]);

  const handleSaveSlot = useCallback(
    async (slot: number) => {
      const romId = currentRomId.current;
      if (!romId) return;
      try {
        if (currentSaveSystem.current === '3ds') {
          await save3dsSlot(romId, slot);
        } else {
          await saveStateSlot(romId, slot, await saveEmuState());
        }
        setStateSlots(await listStateSlots(romId));
      } catch (e) {
        Alert.alert('No se pudo guardar', e instanceof Error ? e.message : String(e));
      }
    },
    [saveEmuState],
  );

  const handleLoadSlot = useCallback(
    async (slot: number) => {
      const romId = currentRomId.current;
      if (!romId) return;
      try {
        if (currentSaveSystem.current === '3ds') {
          await load3dsSlot(romId, slot);
        } else {
          await loadEmuState(await loadStateSlot(romId, slot));
        }
        closeSaveModal();
      } catch (e) {
        Alert.alert('No se pudo cargar ese guardado', e instanceof Error ? e.message : String(e));
      }
    },
    [closeSaveModal, loadEmuState],
  );

  const handleDeleteSlot = useCallback((slot: number) => {
    const romId = currentRomId.current;
    if (!romId) return;
    Alert.alert('Eliminar guardado', `¿Borrar el contenido del slot ${slot === AUTOSAVE_SLOT ? 'automático' : slot + 1}?`, [
      {text: 'Cancelar', style: 'cancel'},
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: async () => {
          await deleteStateSlot(romId, slot);
          setStateSlots(await listStateSlots(romId));
        },
      },
    ]);
  }, []);

  const handleShowAudioDebug = useCallback(() => {
    getAudioDebugInfo()
      .then(info => Alert.alert('Diagnóstico de audio', info))
      .catch(e => Alert.alert('Diagnóstico de audio', String(e)));
  }, []);

  useEffect(() => {
    // All three native views unmount (destroying their emulator instance)
    // whenever we navigate away from the game screen -- so every time the
    // active one remounts, re-push whatever ROM is current (and its
    // romId, so save persistence keeps working after a trip through
    // Home/Folder/Library and back). Rotating the phone does the exact
    // same remount (confirmed live: the native view's identity and its
    // framebuffer both change across a rotation, leaving a permanently
    // black screen if nothing reloads it) -- isLandscape is in the
    // dependency list for that reason, not because anything here reads
    // it directly. Same tradeoff as the Home/Game round trip: any
    // progress since the last in-game save is lost, persisted saves are
    // not.
    if (screen !== 'game') return;
    const romId = currentRomId.current ?? undefined;
    setSpeed(1);
    if (system === 'gba') {
      const base64 = bytesToBase64(baseRomBytes.current);
      gbaRef.current?.loadRomBase64(base64, romId);
      gbaRef.current?.setSpeedMultiplier(1);
    } else if (system === '3ds') {
      // The game outlives the view (N3dsSession): this re-attaches it, or
      // starts it the first time.
      if (current3dsRomPath.current) n3dsRef.current?.loadRomPath(current3dsRomPath.current);
    } else if (system === 'nds') {
      if (currentDsRomPath.current) dsRef.current?.loadRomPath(currentDsRomPath.current, romId);
      setGbaCartLabel(null);
    } else {
      const base64 = bytesToBase64(baseRomBytes.current);
      gameBoyRef.current?.loadRomBase64(base64, romId);
      gameBoyRef.current?.setSpeedMultiplier(1);
    }
  }, [screen, system, isLandscape]);

  const handlePickRom = useCallback(async () => {
    prevLabelBeforeLoad.current = romLabel;
    setBusy(true);
    setRomLabel('Cargando ROM…');
    try {
      // Path-based, not the base64 pickRomFile -- NDS ROMs run
      // 128-512MB, and base64-encoding one of those plus passing it
      // across the JS bridge as a single string reliably runs out of
      // memory (confirmed live: a real 128MB .nds OOM-crashed here
      // before this existed). GB/GBA files are small enough that
      // reading them back as base64 in a second step (below) is fine.
      const picked = await pickRomFilePath(SUPPORTED_ROM_EXTENSIONS);
      const extension = picked.name.split('.').pop() ?? '';
      const targetSystem = systemForExtension(extension);
      hasUserRom.current = true;

      if (targetSystem === '3ds') {
        // A 3DS game keeps its saves inside the emulated console's own
        // storage rather than a .sav, so it has no state slots, cloud sync
        // or cover art yet -- only the play itself, like the DS branch
        // minus those.
        const romId = `${picked.name}-${picked.size}`.replace(/[^a-zA-Z0-9_.-]/g, '_');
        currentRomId.current = romId;
        currentSaveSystem.current = '3ds';
        let romPath = picked.path;
        try {
          const cached = await saveRomToCachePath(picked.path, picked.name, '3ds', picked.name);
          romPath = cached.path;
          refreshRecentRoms();
        } catch {}
        current3dsRomPath.current = romPath;
        setRomLabel(picked.name);
        setCoverImageUrl(null);
        showRomIcon(romPath);
        start3dsCloudSync(romPath, romId);
        setStateSlots([]);
        setSystem('3ds');
        setScreen('game');
        return;
      }

      if (targetSystem === 'nds') {
        // romId is the ROM's CRC32 (see dsSaveId), not the cache entry's own
        // id, so the save file, any Recientes reopen and the desktop app all
        // resolve to the same key. Cover art only needs the 12-byte title at
        // the very start of the file, so it's cheap even without the rest.
        const legacyId = legacyDsSaveId(picked.name, picked.size);
        currentSaveSystem.current = 'nds';
        // Cached the same way GB/GBA ROMs are (see saveRomToCache), just
        // path-based instead of base64 -- the file stays on disk the whole
        // time instead of round-tripping through JS memory. Not fatal if
        // it fails: still playable, just won't show up in Recientes.
        let dsPath = picked.path;
        try {
          const cached = await saveRomToCachePath(picked.path, picked.name, 'nds', picked.name);
          dsPath = cached.path;
          refreshRecentRoms();
        } catch {}
        currentDsRomPath.current = dsPath;
        const romId = await dsSaveId(dsPath, legacyId);
        currentRomId.current = romId;
        dsLegacySaveId.current = legacyId;
        loadCloudTitle(dsPath, 'nds');
        setRomLabel(picked.name);
        setCoverImageUrl(null);
        setGbaCartLabel(null);
        listStateSlots(romId)
          .then(setStateSlots)
          .catch(() => setStateSlots([]));
        lastSyncedSaveCrc.current = null;
        saveConflictChecked.current = false;
        const lookupId = ++coverLookupId.current;
        readFileHeaderBase64(dsPath, 0x0c)
          .then(base64 => {
            const romTitle = readRomTitle(base64ToBytes(base64), 'nds');
            return findCoverArt('nds', romTitle).then(url => url ?? readRomIcon(dsPath));
          })
          .then(url => {
            if (coverLookupId.current === lookupId) setCoverImageUrl(url);
          })
          .catch(() => {});
        // Cartridge-save cloud sync works for NDS too (see
        // readGameSavePaused/autoSyncGameSave below) -- unlike a
        // full-state save, the .sav file is small (melonDS writes
        // straight through to it the same way mGBA does), so checking
        // it against the cloud doesn't touch the ROM bytes at all.
        setTimeout(() => checkGameSaveConflict(romId), 500);
        // Actually loading the ROM happens in the remount effect above,
        // not here -- dsRef.current is still null at this point (DsView
        // doesn't exist in the tree until this same setSystem/setScreen
        // commits and mounts it).
        setSystem('nds');
        setScreen('game');
      } else {
        const base64 = await readFileAsBase64(picked.path);
        loadIntoEmulator(base64ToBytes(base64), picked.name, targetSystem, base64);
        saveRomToCache(base64, picked.name, targetSystem, picked.name)
          .then(refreshRecentRoms)
          .catch(() => {});
      }
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
  }, [checkGameSaveConflict, loadIntoEmulator, refreshRecentRoms, romLabel]);

  const openFolder = useCallback(async (picked: {uri: string; name: string}) => {
    setFolder(picked);
    setScreen('folder');
    setFolderLoading(true);
    try {
      const files = await listRomFolder(picked.uri, FOLDER_ROM_EXTENSIONS);
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
        const read = await readRomFromFolder(file.uri, FOLDER_ROM_EXTENSIONS);
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
        if (rom.system === '3ds') {
          currentRomId.current = `${rom.name}-${rom.size}`.replace(/[^a-zA-Z0-9_.-]/g, '_');
          currentSaveSystem.current = '3ds';
          current3dsRomPath.current = await loadCachedRomPath(rom.id);
          hasUserRom.current = true;
          setRomLabel(rom.label);
          setCoverImageUrl(null);
          showRomIcon(current3dsRomPath.current);
          start3dsCloudSync(current3dsRomPath.current, currentRomId.current);
          setStateSlots([]);
          setSystem('3ds');
          setScreen('game');
          return;
        }
        if (rom.system === 'nds') {
          // Same romId as handlePickRom/handleSelectHubFile (the ROM's
          // CRC32, not rom.id -- that's just the cache entry's own key) so
          // the save file resolves the same way however the ROM was opened.
          const dsPath = await loadCachedRomPath(rom.id);
          const legacyId = legacyDsSaveId(rom.name, rom.size);
          const romId = await dsSaveId(dsPath, legacyId);
          currentRomId.current = romId;
          dsLegacySaveId.current = legacyId;
          loadCloudTitle(dsPath, 'nds');
          currentSaveSystem.current = 'nds';
          currentDsRomPath.current = dsPath;
          hasUserRom.current = true;
          setRomLabel(rom.label);
          setCoverImageUrl(null);
          setGbaCartLabel(null);
          listStateSlots(romId)
            .then(setStateSlots)
            .catch(() => setStateSlots([]));
          lastSyncedSaveCrc.current = null;
          saveConflictChecked.current = false;
          const lookupId = ++coverLookupId.current;
          readFileHeaderBase64(dsPath, 0x0c)
            .then(base64 => {
              const romTitle = readRomTitle(base64ToBytes(base64), 'nds');
              return findCoverArt('nds', romTitle).then(url => url ?? readRomIcon(dsPath));
            })
            .then(url => {
              if (coverLookupId.current === lookupId) setCoverImageUrl(url);
            })
            .catch(() => {});
          setTimeout(() => checkGameSaveConflict(romId), 500);
          setSystem('nds');
          setScreen('game');
          return;
        }
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
    [checkGameSaveConflict, loadIntoEmulator, refreshRecentRoms],
  );

  const handleSelectHubFile = useCallback(
    async (file: RomHackHubFile) => {
      setBusy(true);
      setRomLabel('Descargando…');
      try {
        // Path-based, not the old fully-in-JS download+unzip+base64 --
        // an NDS file here can be 128-512MB once unzipped, and holding
        // that as a JS ArrayBuffer/base64 string reliably OOMs the same
        // way a locally-picked one did (see handlePickRom).
        const picked = await downloadRomToPath(file.downloadUrl, file.originalName, SUPPORTED_ROM_EXTENSIONS);
        const extension = picked.name.split('.').pop() ?? '';
        const targetSystem = systemForExtension(extension);
        hasUserRom.current = true;

        if (targetSystem === 'nds') {
          const legacyId = legacyDsSaveId(picked.name, picked.size);
          currentSaveSystem.current = 'nds';
          let dsPath = picked.path;
          try {
            const cached = await saveRomToCachePath(picked.path, picked.name, 'nds', file.title);
            dsPath = cached.path;
            refreshRecentRoms();
          } catch {}
          currentDsRomPath.current = dsPath;
          const romId = await dsSaveId(dsPath, legacyId);
          currentRomId.current = romId;
          dsLegacySaveId.current = legacyId;
          loadCloudTitle(dsPath, 'nds');
          setRomLabel(file.title);
          setCoverImageUrl(null);
          setGbaCartLabel(null);
          listStateSlots(romId)
            .then(setStateSlots)
            .catch(() => setStateSlots([]));
          lastSyncedSaveCrc.current = null;
          saveConflictChecked.current = false;
          const lookupId = ++coverLookupId.current;
          readFileHeaderBase64(dsPath, 0x0c)
            .then(base64 => {
              const romTitle = readRomTitle(base64ToBytes(base64), 'nds');
              return findCoverArt('nds', romTitle).then(url => url ?? readRomIcon(dsPath));
            })
            .then(url => {
              if (coverLookupId.current === lookupId) setCoverImageUrl(url);
            })
            .catch(() => {});
          setTimeout(() => checkGameSaveConflict(romId), 500);
          setSystem('nds');
          setScreen('game');
        } else {
          const base64 = await readFileAsBase64(picked.path);
          loadIntoEmulator(base64ToBytes(base64), file.title, targetSystem, base64);
          saveRomToCache(base64, picked.name, targetSystem, file.title)
            .then(refreshRecentRoms)
            .catch(() => {});
        }
      } catch (e) {
        Alert.alert('No se pudo cargar el archivo', e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [checkGameSaveConflict, loadIntoEmulator, refreshRecentRoms],
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
  // to whichever view is currently active by name. L/R don't exist on
  // GameBoyButton (the original Game Boy has no shoulder buttons) --
  // only meaningful, and only sent, once a GBA ROM is loaded.
  const dispatchButton = useCallback(
    (button: PadButtonId, pressed: boolean) => {
      if (system === '3ds') {
        n3dsRef.current?.setButtonPressed(button as N3dsButton, pressed);
      } else if (button === 'ZL' || button === 'ZR') {
        // Only the 3DS has them.
      } else if (system === 'gba') {
        if (button !== 'X' && button !== 'Y') gbaRef.current?.setButtonPressed(button as GbaButton, pressed);
      } else if (system === 'nds') {
        dsRef.current?.setButtonPressed(button as DsButton, pressed);
      } else if (button !== 'L' && button !== 'R' && button !== 'X' && button !== 'Y') {
        gameBoyRef.current?.setButtonPressed(button as GameBoyButton, pressed);
      }
    },
    [system],
  );

  // Loads whatever custom layout was saved for this system+orientation
  // (or the matching default, if none was) -- runs whenever the active
  // system or orientation changes, since GB/GBA/NDS each get their own
  // layout, and landscape's fixed-corner controls need a different
  // default scale than portrait's stacked-below-the-screen ones.
  const controlLayoutKey = `controlLayout_${system}_${isLandscape ? 'landscape' : 'portrait'}`;
  // Portrait: every screen spans the full width of the device by default,
  // whatever its base size -- the scale that does that, per system.
  const portraitScreenBaseWidth =
    system === 'gba'
      ? styles.screenGba.width
      : system === 'nds'
        ? styles.screenDs.width
        : system === '3ds'
          ? styles.screen3ds.width
          : styles.screen.width;
  const portraitScreenBaseHeight =
    system === 'gba'
      ? styles.screenGba.height
      : system === 'nds'
        ? styles.screenDs.height
        : system === '3ds'
          ? styles.screen3ds.height
          : styles.screen.height;
  // Where the portrait controls (L/R, Home and the menu included) begin. A
  // full-width DS -- two stacked screens -- is taller than the room above
  // them on most phones, and the L/R row then sat on the bottom strip of
  // the touch screen, swallowing taps there. So the default is full width
  // unless that runs into the controls; 0 until measured.
  const [portraitControlsTop, setPortraitControlsTop] = useState(0);
  const defaultControlLayout = useMemo<ControlLayout>(
    () =>
      isLandscape
        ? DEFAULT_CONTROL_LAYOUT_LANDSCAPE
        : {
            offsets: {},
            scales: {
              screen: Math.min(
                windowWidth / portraitScreenBaseWidth,
                portraitControlsTop > 0 ? portraitControlsTop / portraitScreenBaseHeight : Infinity,
              ),
            },
          },
    [isLandscape, windowWidth, portraitScreenBaseWidth, portraitScreenBaseHeight, portraitControlsTop],
  );
  // Until this system+orientation's own layout has loaded, its default --
  // never the previous one's. Switching systems used to render the new
  // screen for a moment at the old system's scale (GB's on a cold start),
  // and resizing a 3DS surface right after it was created could leave its
  // picture laid out for the old size.
  const controlLayout = loadedLayout?.key === controlLayoutKey ? loadedLayout.layout : defaultControlLayout;
  const setControlLayout = useCallback(
    (layout: ControlLayout) => setLoadedLayout({key: controlLayoutKey, layout}),
    [controlLayoutKey],
  );
  useEffect(() => {
    let cancelled = false;
    getPreference(controlLayoutKey)
      .then(json => {
        if (cancelled) return;
        if (json) {
          try {
            const saved = migrateControlLayout(JSON.parse(json));
            // A portrait screen size saved before screens filled the width
            // was chosen against the old framed layout: it gives way to the
            // new default. The buttons' arrangement is kept.
            if (!isLandscape && (saved.v ?? 1) < CONTROL_LAYOUT_VERSION) {
              const {screen: _scale, ...scales} = saved.scales;
              const {screen: _offset, ...offsets} = saved.offsets;
              setControlLayout({...saved, scales, offsets});
              return;
            }
            setControlLayout(saved);
            return;
          } catch {
            // Fall through to the default below.
          }
        }
        setControlLayout(defaultControlLayout);
      })
      .catch(() => setControlLayout(defaultControlLayout));
    return () => {
      cancelled = true;
    };
  }, [controlLayoutKey, defaultControlLayout, isLandscape, setControlLayout]);

  const persistControlLayout = useCallback(
    (layout: ControlLayout) => {
      setControlLayout(layout);
      setPreference(controlLayoutKey, JSON.stringify({...layout, v: CONTROL_LAYOUT_VERSION})).catch(() => {});
    },
    [controlLayoutKey, setControlLayout],
  );

  // Reads the live layout out of a ref rather than the render that built
  // this callback: a drag is a long-lived gesture and the layout can have
  // changed (another cluster moved, a rescale, a rotation reloading it)
  // since. Merging into a stale copy is how one cluster's move erased
  // another's.
  const controlLayoutRef = useRef(controlLayout);
  controlLayoutRef.current = controlLayout;
  const handleDragCluster = useCallback(
    (id: ClusterId, dx: number, dy: number) => {
      const current = controlLayoutRef.current;
      persistControlLayout({...current, offsets: {...current.offsets, [id]: {dx, dy}}});
    },
    [persistControlLayout],
  );

  // The value shown/adjusted for whichever component is selected --
  // falls back to the landscape screen's bigger default, or 1 for
  // everything else that's never been touched.
  const currentScale =
    controlLayout.scales[scaleTarget] ?? (scaleTarget === 'screen' ? defaultControlLayout.scales.screen ?? 1 : 1);

  const handleScaleStep = useCallback(
    (delta: number) => {
      const max = scaleTarget === 'screen' ? MAX_SCREEN_SCALE : MAX_CLUSTER_SCALE;
      const base = controlLayout.scales[scaleTarget] ?? (scaleTarget === 'screen' ? defaultControlLayout.scales.screen ?? 1 : 1);
      const next = Math.min(max, Math.max(MIN_SCALE, base + delta));
      persistControlLayout({...controlLayout, scales: {...controlLayout.scales, [scaleTarget]: next}});
    },
    [controlLayout, persistControlLayout, scaleTarget, defaultControlLayout],
  );

  const resetControlLayout = useCallback(() => {
    persistControlLayout(defaultControlLayout);
  }, [persistControlLayout, defaultControlLayout]);

  // Same per-system loading pattern as controlLayout above -- each
  // system keeps its own theme since their button sets differ (NDS has
  // X/Y, GB has no L/R).
  useEffect(() => {
    let cancelled = false;
    getPreference(`theme_${system}`)
      .then(json => {
        if (cancelled) return;
        if (json) {
          try {
            setTheme(JSON.parse(json));
            return;
          } catch {
            // Fall through to the default below.
          }
        }
        setTheme(defaultTheme(system));
      })
      .catch(() => setTheme(defaultTheme(system)));
    return () => {
      cancelled = true;
    };
  }, [system]);

  const persistTheme = useCallback(
    (next: Theme) => {
      setTheme(next);
      setPreference(`theme_${system}`, JSON.stringify(next)).catch(() => {});
    },
    [system],
  );

  const handleSaveTheme = useCallback(
    (next: Theme) => {
      persistTheme(next);
      setScreen('game');
    },
    [persistTheme],
  );

  const handlePublishTheme = useCallback(
    async (next: Theme) => {
      if (!authToken) return;
      setThemeBusy(true);
      try {
        const published = next.id
          ? await updateTheme(authToken, next.id, next)
          : await createTheme(authToken, {...next, public: true});
        persistTheme(published);
        Alert.alert('Tema publicado', 'Ya está disponible para que otros lo descarguen.');
        setScreen('game');
      } catch (e) {
        Alert.alert('No se pudo publicar el tema', e instanceof Error ? e.message : String(e));
      } finally {
        setThemeBusy(false);
      }
    },
    [authToken, persistTheme],
  );

  const handleApplyExploredTheme = useCallback(
    (applied: Theme) => {
      persistTheme(applied);
      if (applied.id) incrementThemeDownload(applied.id);
      setScreen('game');
    },
    [persistTheme],
  );

  // Pal Park-style Pokemon transfer: insert a GBA ROM into the running
  // NDS game's slot-2 (see ds_jni.cpp's nativeInsertGbaCart). Reads the
  // small GBA ROM into JS memory to compute its CRC32 -- fine at GBA's
  // <=32MB size, and needed so the same save file GbaView would use
  // for this exact ROM gets reused here (whatever the user already
  // caught playing it standalone).
  const handleInsertGbaCart = useCallback(async () => {
    try {
      const picked = await pickRomFilePath(['gba']);
      const base64 = await readFileAsBase64(picked.path);
      const gbaRomId = crc32(base64ToBytes(base64)).toString(16);
      await insertGbaCart(picked.path, gbaRomId);
      setGbaCartLabel(picked.name);
    } catch (e) {
      if (e instanceof RomPickerCancelledError) return;
      Alert.alert('No se pudo insertar el cartucho', e instanceof Error ? e.message : String(e));
    }
  }, []);

  const handleEjectGbaCart = useCallback(async () => {
    await ejectGbaCart();
    setGbaCartLabel(null);
  }, []);

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
          onBrowseHub={() => {
            setHubInitialTab('hacks');
            setScreen('hub');
          }}
          lastFolder={lastFolder}
          onOpenLastFolder={handleOpenLastFolder}
          busy={busy}
          username={authUsername}
          onOpenAccount={() => setScreen('account')}
          onOpenLocalLink={() => setScreen('localLink')}
          onOpenFeedback={() => setScreen('feedback')}
        />
        {availableUpdate && (
          <View style={styles.updateBanner}>
            <View style={{flex: 1}}>
              <Text style={styles.updateBannerTitle}>Versión {availableUpdate.version} disponible</Text>
              <Text style={styles.updateBannerChangelog} numberOfLines={3}>
                {availableUpdate.changelog}
              </Text>
            </View>
            <Pressable
              style={styles.updateBannerButton}
              onPress={() => Linking.openURL('https://www.emulatornds.online/app')}>
              <Text style={styles.updateBannerButtonLabel}>Descargar</Text>
            </Pressable>
            <Pressable style={styles.updateBannerClose} onPress={dismissUpdateBanner} hitSlop={8}>
              <Text style={styles.updateBannerCloseLabel}>✕</Text>
            </Pressable>
          </View>
        )}
      </SafeAreaView>
    );
  }

  if (screen === 'account') {
    return (
      <>
        <StatusBar hidden />
        <AccountScreen
          username={authUsername}
          onLogin={handleLogin}
          onVerifyTotp={handleVerifyTotp}
          onLogout={handleLogout}
          onClose={() => setScreen('home')}
        />
      </>
    );
  }

  if (screen === 'feedback') {
    return (
      <>
        <StatusBar hidden />
        <FeedbackScreen authToken={authToken} appVersion={appVersionName} onClose={() => setScreen('home')} />
      </>
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

  if (screen === 'hub') {
    return (
      <>
        <StatusBar hidden />
        <HubScreen
          initialTab={hubInitialTab}
          onSelectPatch={handleSelectPatch}
          onSelectFile={handleSelectHubFile}
          downloadingFile={busy}
          onClose={() => setScreen('home')}
        />
      </>
    );
  }

  if (screen === 'localLink') {
    return (
      <>
        <StatusBar hidden />
        <LocalLinkScreen onClose={() => setScreen('home')} />
      </>
    );
  }

  if (screen === 'themeEditor') {
    return (
      <>
        <StatusBar hidden />
        <ThemeEditorScreen
          theme={theme}
          authToken={authToken}
          busy={themeBusy}
          onClose={() => setScreen('game')}
          onSave={handleSaveTheme}
          onPublish={handlePublishTheme}
        />
      </>
    );
  }

  if (screen === 'themesExplore') {
    return (
      <>
        <StatusBar hidden />
        <ThemesExploreScreen system={system} onApply={handleApplyExploredTheme} onClose={() => setScreen('game')} />
      </>
    );
  }

  const screenScale = controlLayout.scales.screen ?? defaultControlLayout.scales.screen ?? 1;
  const scaledScreenStyle = (base: {width: number; height: number; backgroundColor: string; borderRadius: number}) => ({
    ...base,
    width: base.width * screenScale,
    height: base.height * screenScale,
    // However far the user scales it, the screen can never outgrow the
    // device itself -- this is what lets the screen scale share one
    // generous ceiling across both orientations (see MAX_SCREEN_SCALE)
    // instead of needing a per-shape hand-tuned max.
    maxWidth: windowWidth,
    maxHeight: windowHeight,
  });
  const controlStyle = resolveControlStyle(theme);
  const screenView =
    system === 'gba' ? (
      <GbaView ref={gbaRef} style={scaledScreenStyle(styles.screenGba)} />
    ) : system === 'nds' ? (
      <DsView ref={dsRef} style={scaledScreenStyle(isLandscape ? styles.screenDsLandscape : styles.screenDs)} />
    ) : system === '3ds' ? (
      <N3dsView ref={n3dsRef} style={scaledScreenStyle(isLandscape ? styles.screen3dsLandscape : styles.screen3ds)} />
    ) : (
      <GameBoyView ref={gameBoyRef} style={scaledScreenStyle(styles.screen)} />
    );

  // Shared between portrait and landscape -- only the drag-to-reposition
  // hint differs, since landscape's controls sit at fixed corners
  // instead (see GameControls' landscape branch).
  // X/Y only exist on the DS, so only offer to resize them there.
  // On the DS, X/Y sit inside the A/B diamond (see GameControls), so they
  // move and scale with it -- there's nothing left for a separate 'xy'
  // target to act on, only a label to widen.
  const scaleTargets =
    system === 'nds' || system === '3ds'
      ? SCALE_TARGETS.map(t => (t.id === 'actions' ? {...t, label: 'A/B/X/Y'} : t))
      : SCALE_TARGETS;
  const editToolbar = editingControls && (
    <View style={styles.editToolbar}>
      <View style={styles.editToolbarHeader}>
        <Text style={[styles.editToolbarHint, styles.editToolbarHintInRow]}>Arrastra un grupo de botones para moverlo</Text>
        <Pressable style={styles.editDoneButton} onPress={() => setEditingControls(false)} hitSlop={6}>
          <Text style={styles.editDoneLabel}>Listo</Text>
        </Pressable>
      </View>
      <View style={[styles.editToolbarRow, styles.scaleTargetRow]}>
        {scaleTargets.map(t => (
          <Pressable
            key={t.id}
            style={[styles.scaleTargetChip, scaleTarget === t.id && styles.scaleTargetChipActive]}
            onPress={() => setScaleTarget(t.id)}>
            <Text style={[styles.scaleTargetLabel, scaleTarget === t.id && styles.scaleTargetLabelActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.editToolbarRow}>
        <Text style={styles.editToolbarLabel}>Tamaño</Text>
        <Pressable style={styles.editStepButton} onPress={() => handleScaleStep(-0.1)}>
          <Text style={styles.editStepLabel}>−</Text>
        </Pressable>
        <Text style={styles.editScaleValue}>{Math.round(currentScale * 100)}%</Text>
        <Pressable style={styles.editStepButton} onPress={() => handleScaleStep(0.1)}>
          <Text style={styles.editStepLabel}>+</Text>
        </Pressable>
        <Pressable style={styles.editResetButton} onPress={resetControlLayout}>
          <Text style={styles.editResetLabel}>Restablecer</Text>
        </Pressable>
      </View>
      <View style={styles.editToolbarRow}>
        <Text style={styles.editToolbarLabel}>Tema</Text>
        <Pressable style={styles.editThemeButton} onPress={() => setScreen('themeEditor')}>
          <Text style={styles.editThemeLabel}>Editar</Text>
        </Pressable>
        <Pressable style={styles.editThemeButton} onPress={() => setScreen('themesExplore')}>
          <Text style={styles.editThemeLabel}>Explorar</Text>
        </Pressable>
      </View>
      {system === 'nds' && (
        <View style={styles.editToolbarRow}>
          <Text style={styles.editToolbarLabel}>Cartucho GBA</Text>
          {gbaCartLabel ? (
            <Pressable style={styles.editThemeButton} onPress={handleEjectGbaCart}>
              <Text style={styles.editThemeLabel} numberOfLines={1}>
                {gbaCartLabel} (expulsar)
              </Text>
            </Pressable>
          ) : (
            <Pressable style={styles.editThemeButton} onPress={handleInsertGbaCart}>
              <Text style={styles.editThemeLabel}>Insertar</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );

  const menuModal = (
    <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={closeMenu}>
      <Pressable style={styles.modalBackdrop} onPress={closeMenu}>
        {/* Scrolls when it doesn't fit: in landscape the 3DS menu is taller than the screen. */}
        <Pressable style={[styles.modalCard, styles.menuCard]} onPress={() => {}}>
          <ScrollView style={styles.menuScroll} contentContainerStyle={styles.menuScrollContent}>
            <Text style={styles.modalTitle} numberOfLines={1}>
              {romLabel}
            </Text>
            <Text style={styles.modalSubtitle}>El juego está en pausa.</Text>
            {system !== '3ds' && (
              <View style={styles.menuSection}>
                <Text style={styles.menuSectionLabel}>Velocidad</Text>
                <View style={styles.menuSpeedRow}>
                  {([1, 2, 3] as const).map(multiplier => (
                    <Pressable
                      key={multiplier}
                      style={[styles.speedButton, styles.menuSpeedButton, speed === multiplier && styles.speedButtonActive]}
                      onPress={() => handleSetSpeed(multiplier)}>
                      <Text style={[styles.speedLabel, speed === multiplier && styles.speedLabelActive]}>×{multiplier}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            )}
            {(system === 'gb' || system === 'gba' || system === 'nds' || system === '3ds') && (
              <Pressable
                style={styles.menuItem}
                onPress={() => {
                  setMenuOpen(false);
                  openSaveModal();
                }}>
                <IconSave size={16} color="#cfe3fa" />
                <Text style={styles.menuItemLabel}>Guardado</Text>
              </Pressable>
            )}
            {system === '3ds' && (
              <View style={[styles.menuSection, styles.menuRoomSection]}>
                <Text style={styles.menuSectionLabel}>Inalámbrica por internet</Text>
                <Text style={styles.menuRoomNote}>
                  {n3dsRoom === null
                    ? 'Con otro celular o una PC en la misma sala, el juego los ve como si estuvieran juntos (intercambios, combates).'
                    : n3dsRoomJoined
                      ? `En la sala ${n3dsRoom} · ${n3dsRoomMembers} ${n3dsRoomMembers === 1 ? 'consola' : 'consolas'}`
                      : `Conectando a la sala ${n3dsRoom}…`}
                </Text>
                <View style={styles.menuRoomGrid}>
                  {Array.from({length: N3DS_ROOM_COUNT}, (_, i) => i + 1).map(room => {
                    const active = (n3dsRoom ?? n3dsRoomPick) === room;
                    return (
                      <Pressable
                        key={room}
                        disabled={n3dsRoom !== null}
                        style={[styles.speedButton, styles.menuRoomButton, active && styles.speedButtonActive]}
                        onPress={() => setN3dsRoomPick(room)}>
                        <Text style={[styles.speedLabel, active && styles.speedLabelActive]}>{room}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Pressable
                  style={[styles.menuItem, styles.menuRoomAction]}
                  onPress={n3dsRoom === null ? handleJoin3dsRoom : handleLeave3dsRoom}>
                  <Text style={[styles.menuItemLabel, n3dsRoom !== null && styles.menuItemDanger]}>
                    {n3dsRoom === null ? `Conectar a la sala ${n3dsRoomPick}` : 'Desconectar'}
                  </Text>
                </Pressable>
              </View>
            )}
            <Pressable
              style={styles.menuItem}
              onPress={() => {
                closeMenu();
                setEditingControls(true);
              }}>
              <IconPencil size={16} color="#cfe3fa" />
              <Text style={styles.menuItemLabel}>Tamaño y posición de los controles</Text>
            </Pressable>
            <Pressable style={styles.menuItem} onPress={confirmExitToHome}>
              <IconHome size={16} color="#f0a0a0" />
              <Text style={[styles.menuItemLabel, styles.menuItemDanger]}>Salir al inicio</Text>
            </Pressable>
            <Pressable style={styles.modalCloseButton} onPress={closeMenu}>
              <Text style={styles.modalCloseLabel}>Seguir jugando</Text>
            </Pressable>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );

  // Shared between portrait and landscape's save modals -- identical
  // content, only the surrounding <Modal>/<Pressable> backdrop differs
  // per layout (well, it doesn't -- but keeping one JSX literal here
  // avoids maintaining two copies of this large block in sync).
  // Everything syncs, the game save and the state slots alike. A 3DS state
  // only loads on the same emulated model, though (see n3dsDownloadSlot).
  const cloudEnabled = !!authToken;
  const stateCloudEnabled = !!authToken;
  const saveModalContent = (
    <>
      <Text style={styles.modalTitle}>Guardado manual</Text>
      <Text style={styles.modalSubtitle}>El juego está en pausa mientras eliges un espacio.</Text>
      {(system === 'gba' || system === 'nds' || system === '3ds') && (
        <>
          <View style={styles.slotsRow}>
            {[0, 1, 2].map(slot => {
              const info = stateSlots.find(s => s.slot === slot) ?? {slot, exists: false};
              const cloud = cloudSaves.find(s => s.slot === cloudStateSlot(system, slot));
              const cloudBusy = cloudBusySlot === slot;
              return (
                <View key={slot} style={styles.slotCard}>
                  <View style={styles.slotCardTop}>
                    <View style={{flex: 1}}>
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
                        {cloud ? ` · Nube: ${formatCloudTimestamp(cloud.updatedAt)}` : ''}
                      </Text>
                    </View>
                    {info.exists && (
                      <Pressable style={styles.slotDelete} hitSlop={8} onPress={() => handleDeleteSlot(slot)}>
                        <IconTrash size={18} />
                      </Pressable>
                    )}
                  </View>
                  <View style={styles.slotActions}>
                    <Pressable style={styles.slotActionButton} onPress={() => handleSaveSlot(slot)}>
                      <Text style={styles.slotActionLabel} numberOfLines={1}>
                        Guardar
                      </Text>
                    </Pressable>
                    <Pressable
                      style={[styles.slotActionButton, !info.exists && styles.slotActionButtonDisabled]}
                      disabled={!info.exists}
                      onPress={() => handleLoadSlot(slot)}>
                      <Text style={[styles.slotActionLabel, !info.exists && styles.slotActionLabelDisabled]}>Cargar</Text>
                    </Pressable>
                    {stateCloudEnabled && (
                      <>
                        {/* Nothing to upload from an empty slot. */}
                        <Pressable
                          style={[
                            styles.slotActionButton,
                            styles.slotActionButtonCloud,
                            (!info.exists || cloudBusy) && styles.slotActionButtonDisabled,
                          ]}
                          disabled={!info.exists || cloudBusy}
                          onPress={() => handleUploadCloudSlot(slot)}>
                          {cloudBusy ? (
                            <ActivityIndicator size="small" color="#a0ffe8" />
                          ) : (
                            <>
                              <IconCloud size={14} color={info.exists ? '#a0ffe8' : '#777'} />
                              <Text
                                style={[
                                  styles.slotActionLabel,
                                  info.exists ? styles.slotActionLabelCloud : styles.slotActionLabelDisabled,
                                ]}>
                                Subir
                              </Text>
                            </>
                          )}
                        </Pressable>
                        <Pressable
                          style={[
                            styles.slotActionButton,
                            styles.slotActionButtonCloud,
                            (!cloud || cloudBusy) && styles.slotActionButtonDisabled,
                          ]}
                          disabled={!cloud || cloudBusy}
                          onPress={() => handleDownloadCloudSlot(slot)}>
                          <IconCloud size={14} color={cloud ? '#a0ffe8' : '#777'} />
                          <Text style={[styles.slotActionLabel, cloud ? styles.slotActionLabelCloud : styles.slotActionLabelDisabled]}>
                            Bajar
                          </Text>
                        </Pressable>
                      </>
                    )}
                  </View>
                </View>
              );
            })}
          </View>

          {/* Written automatically every ~45s and on background -- see the
              autoSaveState effect -- so a crash doesn't cost progress. */}
          {(() => {
            const autoInfo = stateSlots.find(s => s.slot === AUTOSAVE_SLOT) ?? {slot: AUTOSAVE_SLOT, exists: false};
            return (
              <View style={styles.gameSaveRow}>
                <View style={{flex: 1}}>
                  <View style={styles.slotCardTop}>
                    <Text style={styles.slotLabel}>Automático</Text>
                  </View>
                  <Text style={styles.slotMeta} numberOfLines={1}>
                    {autoInfo.exists
                      ? new Date(autoInfo.savedAt ?? 0).toLocaleString(undefined, {
                          day: '2-digit',
                          month: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : 'Vacío'}
                  </Text>
                </View>
                <Pressable
                  style={[styles.slotActionButton, styles.slotActionSolo, !autoInfo.exists && styles.slotActionButtonDisabled]}
                  disabled={!autoInfo.exists}
                  onPress={() => handleLoadSlot(AUTOSAVE_SLOT)}>
                  <Text style={[styles.slotActionLabel, !autoInfo.exists && styles.slotActionLabelDisabled]}>Cargar</Text>
                </Pressable>
              </View>
            );
          })()}
        </>
      )}

      {((cloudEnabled && system !== 'gb') || system !== '3ds') && (
        <View style={[styles.slotCard, styles.gameSaveCard]}>
          <View>
            <Text style={styles.slotLabel}>Guardado del juego</Text>
            <Text style={styles.slotMeta} numberOfLines={1}>
              {cloudEnabled && system !== 'gb'
                ? (() => {
                    const cloudSave = cloudSaves.find(s => s.slot === GAME_SAVE_CLOUD_SLOT);
                    return cloudSave ? `En la nube: ${formatCloudTimestamp(cloudSave.updatedAt)}` : 'Sin guardado en la nube';
                  })()
                : 'De otro emulador, o para llevártela'}
            </Text>
          </View>
          {cloudEnabled && system !== 'gb' && (
          <View style={styles.slotActions}>
            <Pressable
              style={[styles.slotActionButton, styles.slotActionButtonCloud, cloudBusySlot === GAME_SAVE_CLOUD_SLOT && styles.slotActionButtonDisabled]}
              disabled={cloudBusySlot === GAME_SAVE_CLOUD_SLOT}
              onPress={handleUploadGameSave}>
              {cloudBusySlot === GAME_SAVE_CLOUD_SLOT ? (
                <ActivityIndicator size="small" color="#a0ffe8" />
              ) : (
                <>
                  <IconCloud size={14} color="#a0ffe8" />
                  <Text style={[styles.slotActionLabel, styles.slotActionLabelCloud]}>Subir</Text>
                </>
              )}
            </Pressable>
            <Pressable
              style={[
                styles.slotActionButton,
                styles.slotActionButtonCloud,
                (!cloudSaves.some(s => s.slot === GAME_SAVE_CLOUD_SLOT) || cloudBusySlot === GAME_SAVE_CLOUD_SLOT) &&
                  styles.slotActionButtonDisabled,
              ]}
              disabled={!cloudSaves.some(s => s.slot === GAME_SAVE_CLOUD_SLOT) || cloudBusySlot === GAME_SAVE_CLOUD_SLOT}
              onPress={handleDownloadGameSave}>
              <IconCloud size={14} color={cloudSaves.some(s => s.slot === GAME_SAVE_CLOUD_SLOT) ? '#a0ffe8' : '#777'} />
              <Text
                style={[
                  styles.slotActionLabel,
                  cloudSaves.some(s => s.slot === GAME_SAVE_CLOUD_SLOT) && styles.slotActionLabelCloud,
                  !cloudSaves.some(s => s.slot === GAME_SAVE_CLOUD_SLOT) && styles.slotActionLabelDisabled,
                ]}>
                Bajar
              </Text>
            </Pressable>
          </View>
          )}
          {system !== '3ds' && (
            <View style={styles.slotActions}>
              <Pressable style={styles.slotActionButton} onPress={handleImportGameSave}>
                <Text style={styles.slotActionLabel}>Importar</Text>
              </Pressable>
              <Pressable style={styles.slotActionButton} onPress={handleExportGameSave}>
                <Text style={styles.slotActionLabel}>Exportar</Text>
              </Pressable>
            </View>
          )}
        </View>
      )}
      {system === '3ds' ? (
        <Text style={styles.modalCloudHint}>
          {authToken
            ? 'Los estados de 3DS en la nube son solo de Android: los de la app de Windows no son compatibles. El guardado del juego sí se comparte.'
            : 'Inicia sesión en Cuenta para sincronizar tus guardados en la nube.'}
        </Text>
      ) : (
        !authToken && <Text style={styles.modalCloudHint}>Inicia sesión en Cuenta para sincronizar guardados en la nube.</Text>
      )}
      <Pressable style={styles.modalCloseButton} onPress={closeSaveModal}>
        <Text style={styles.modalCloseLabel}>Cerrar y continuar</Text>
      </Pressable>
    </>
  );

  if (isLandscape) {
    return (
      <SafeAreaView style={styles.container}>
        {coverImageUrl && (
          <ImageBackground
            source={{uri: coverImageUrl}}
            style={StyleSheet.absoluteFill}
            blurRadius={6}
            resizeMode="cover">
            <View style={styles.coverOverlay} />
          </ImageBackground>
        )}
        <StatusBar hidden />
        <View style={styles.landscapeRoot}>
          <View onLayout={e => setLandscapeHeaderHeight(e.nativeEvent.layout.height)}>
            <View style={styles.landscapeTopBar}>
              <Pressable style={styles.homeButton} onPress={confirmExitToHome} hitSlop={8}>
                <IconHome size={18} />
              </Pressable>
              <Text style={styles.landscapeRomLabel} numberOfLines={1}>
                {romLabel}
              </Text>
              <Pressable style={styles.homeButton} onPress={openMenu} hitSlop={8}>
                <IconMenu size={18} />
              </Pressable>
            </View>

          </View>

          <View style={[styles.landscapeStage, {maxHeight: landscapeStageHeight}]}>
            <View style={[styles.screenBezel, {backgroundColor: withAlpha(controlStyle.screenBezel, 0.55)}]}>{screenView}</View>
            <GameControls
              system={system}
              dispatch={dispatchButton}
              editing={editingControls}
              offsets={controlLayout.offsets}
              scales={controlLayout.scales}
              onDrag={handleDragCluster}
              theme={theme}
              orientation="landscape"
              stageHeight={landscapeStageHeight}
            />
          </View>
          {/* Floated over the stage rather than stacked above it: in
              landscape there isn't the vertical room to give this a row of
              its own, and competing for it left the toolbar's lower half
              underneath the screen -- which, the screen being a
              SurfaceView, punches a hole straight through whatever shares
              its rect (see DsView.kt's z-order note). On top it is always
              reachable, and it only exists while editing anyway. */}
          {editingControls && (
            // Offset by the header's height: this overlay is a child of
            // the landscape root, so top:0 would start it above the title
            // bar and bury the button that leaves edit mode.
            <View style={[styles.landscapeEditOverlay, {top: landscapeHeaderHeight}]}>{editToolbar}</View>
          )}
        </View>

        <Modal visible={saveModalOpen} transparent animationType="fade" onRequestClose={closeSaveModal}>
          <Pressable style={styles.modalBackdrop} onPress={closeSaveModal}>
            <Pressable style={[styles.modalCard, styles.menuCard]} onPress={() => {}}>
              <ScrollView style={styles.menuScroll} contentContainerStyle={styles.menuScrollContent}>
                {saveModalContent}
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>
        {menuModal}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {coverImageUrl && (
        <ImageBackground
          source={{uri: coverImageUrl}}
          style={StyleSheet.absoluteFill}
          blurRadius={6}
          resizeMode="cover">
          <View style={styles.coverOverlay} />
        </ImageBackground>
      )}
      <StatusBar hidden />
      {Platform.OS === 'android' ? (
        <View style={styles.scrollContent}>
          {/* Painted first (position:absolute, so it's also removed from
              the column's normal flow) -- topGroup and bottomGroup are
              plain later siblings, so they always paint on top of the
              console/screen and lay out exactly as if it weren't there,
              no matter how big MAX_SCREEN_SCALE lets it grow. */}
          <View style={styles.portraitStage}>
            {/* Bare, edge to edge: no console shell or bezel around it, so
                the default scale (see defaultControlLayout) spans the full
                width of the device. */}
            <DraggableCluster id="screen" editing={editingControls} offset={controlLayout.offsets.screen} onDrag={handleDragCluster}>
              {screenView}
            </DraggableCluster>
          </View>

          {/* Nothing over the screen while playing: Home and the menu live
              between L and R below. Only the controls editor, while open. */}
          <View style={styles.topGroup}>
            {busy && <ActivityIndicator size="small" color="#7ab8ff" style={styles.portraitBusy} />}
            {editToolbar}
          </View>

          {/* Everything below sits in its own bottom-anchored group (see
              scrollContent's justifyContent:'space-between') so controls
              stay in comfortable thumb reach instead of bunching up right
              under the screen. */}
          <View style={styles.bottomGroup} onLayout={e => setPortraitControlsTop(e.nativeEvent.layout.y)}>
            {/* One shared touch surface for D-pad/A/B/L/R/SELECT/START -- see
                GameControls for why these can no longer be separate Pressables
                (L/R only do anything, and light up, once a GBA ROM is loaded). */}
            <GameControls
              system={system}
              dispatch={dispatchButton}
              editing={editingControls}
              offsets={controlLayout.offsets}
              scales={controlLayout.scales}
              onDrag={handleDragCluster}
              theme={theme}
            />

            {/* Home and the menu, in the gap L and R leave between them:
                clear of the screen above and of the buttons. After
                GameControls and above its elevation, so its full-width touch
                surface doesn't sit on top of them. */}
            <View style={styles.portraitMenuRow} pointerEvents="box-none">
              <Pressable style={styles.portraitMenuButton} onPress={confirmExitToHome} hitSlop={6}>
                <IconHome size={17} />
              </Pressable>
              <Pressable style={styles.portraitMenuButton} onPress={openMenu} hitSlop={6}>
                <IconMenu size={17} />
              </Pressable>
            </View>
          </View>
        </View>
      ) : (
        <Text style={styles.note}>iOS bindings not implemented yet -- see docs/roadmap.md.</Text>
      )}

      {/* Floating, pauses the game while open -- see openSaveModal/closeSaveModal. */}
      <Modal visible={saveModalOpen} transparent animationType="fade" onRequestClose={closeSaveModal}>
        <Pressable style={styles.modalBackdrop} onPress={closeSaveModal}>
          <Pressable style={[styles.modalCard, styles.menuCard]} onPress={() => {}}>
            <ScrollView style={styles.menuScroll} contentContainerStyle={styles.menuScrollContent}>
              {saveModalContent}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
      {menuModal}
    </SafeAreaView>
  );
}

/**
 * D-pad + A/B + L/R + SELECT/START as ONE surface tracking raw touches,
 * instead of separate Pressables. RN's gesture responder system only
 * grants "responder" to one view at a time on Android: pressing a second
 * Pressable while the first is still held steals the responder from it,
 * which fired its onPressOut -- exactly the "pressing A/B releases the
 * D-pad" bug. A single parent view that never releases responder-ship
 * and manually hit-tests every active touch against each button's
 * measured rect is the standard fix for virtual-gamepad multitouch in
 * plain RN (no gesture-handler dependency needed).
 */
function GameControls({
  system,
  dispatch,
  editing,
  offsets,
  scales,
  onDrag,
  theme,
  orientation = 'portrait',
  stageHeight = 0,
}: {
  system: EmulatedSystem;
  dispatch: (button: PadButtonId, pressed: boolean) => void;
  editing: boolean;
  offsets: Partial<Record<ClusterId, ClusterOffset>>;
  // Independent per-cluster size, applied as a paint-time transform (see
  // each cluster's `clusterScale(...)` below) -- purely visual, never
  // changes layout, so one cluster growing can't push or resize another.
  scales: Partial<Record<ScalableId, number>>;
  onDrag: (id: ClusterId, dx: number, dy: number) => void;
  theme: Theme;
  orientation?: 'portrait' | 'landscape';
  // Landscape only -- measured by the parent from landscapeStage's own
  // onLayout. Bottom-anchored clusters use `top` computed from this
  // instead of `bottom` directly (`bottom` doesn't resolve reliably
  // inside this absolute-fill root), and it must come from the parent:
  // a same-shaped onLayout measured *inside* GameControls' own
  // absolute-fill root was observed returning a height larger than the
  // window itself, pushing every bottom-anchored button off-screen.
  stageHeight?: number;
}) {
  const cs = resolveControlStyle(theme);
  const clusterScale = (id: ClusterId): {transform: [{scale: number}]} => ({transform: [{scale: scales[id] ?? 1}]});
  // Portrait only -- landscape pins the controls to fixed corners and
  // keeps its own X/Y pill row, so it doesn't take the diamond.
  // The 3DS has the same four-button diamond as the DS.
  const isDs = system === 'nds' || system === '3ds';
  type ViewRef = React.ElementRef<typeof View>;
  const refs = useRef<Partial<Record<PadButtonId, ViewRef | null>>>({});
  const rects = useRef<Partial<Record<PadButtonId, {x: number; y: number; w: number; h: number}>>>({});
  const [pressed, setPressed] = useState<Set<PadButtonId>>(new Set());

  const measureAll = useCallback(() => {
    (Object.keys(refs.current) as PadButtonId[]).forEach(id => {
      refs.current[id]?.measure((_x: number, _y: number, w: number, h: number, pageX: number, pageY: number) => {
        rects.current[id] = {x: pageX, y: pageY, w, h};
      });
    });
  }, []);

  const setRef = useCallback(
    (id: PadButtonId) => (node: ViewRef | null) => {
      refs.current[id] = node;
    },
    [],
  );

  const buttonsUnderTouches = useCallback((evt: GestureResponderEvent) => {
    const touches = evt.nativeEvent.touches.length ? evt.nativeEvent.touches : [evt.nativeEvent];
    const next = new Set<PadButtonId>();
    for (const touch of touches) {
      for (const id of Object.keys(rects.current) as PadButtonId[]) {
        const r = rects.current[id];
        if (r && touch.pageX >= r.x && touch.pageX <= r.x + r.w && touch.pageY >= r.y && touch.pageY <= r.y + r.h) {
          next.add(id);
        }
      }
    }
    return next;
  }, []);

  // gameControlsRoot/landscapeControlsRoot are one shared touch surface
  // spanning every cluster's bounding box, including the empty space a
  // flex row like shoulderRow leaves between L (left edge) and R (right
  // edge) -- that gap sits right over the screen once it's big enough,
  // and used to swallow every tap there before it could reach the DS
  // touchscreen underneath. Only claiming the responder when a touch
  // actually lands on a tracked button (not just inside the root's
  // rectangle) lets anything else fall through to whatever is behind it.
  const isTouchOnButton = useCallback((evt: GestureResponderEvent) => buttonsUnderTouches(evt).size > 0, [buttonsUnderTouches]);

  const updateFromTouches = useCallback(
    (evt: GestureResponderEvent) => {
      const next = buttonsUnderTouches(evt);
      setPressed(prev => {
        prev.forEach(id => {
          if (!next.has(id)) dispatch(id, false);
        });
        next.forEach(id => {
          if (!prev.has(id)) dispatch(id, true);
        });
        // onResponderMove fires on every touch movement, including the
        // micro-movements of a finger just *held* on the d-pad -- and
        // holding a direction is exactly what walking around in a game
        // is. Returning `next` unconditionally hands React a fresh Set
        // identity every time, so it re-renders this whole control tree
        // dozens of times a second for nothing. Keeping `prev` when the
        // pressed set is unchanged skips that entirely; on-device
        // profiling (simpleperf) had the JS thread at ~21% of process
        // CPU while walking, against ~56% for emulation itself.
        if (prev.size === next.size && [...next].every(id => prev.has(id))) return prev;
        return next;
      });
    },
    [dispatch, buttonsUnderTouches],
  );

  const releaseAll = useCallback(() => {
    setPressed(prev => {
      if (prev.size === 0) return prev;
      prev.forEach(id => dispatch(id, false));
      return new Set();
    });
  }, [dispatch]);

  const isPressed = (id: PadButtonId) => pressed.has(id);

  // ZL/ZR (3DS only) ride along under L and R, in the same draggable
  // cluster, so they move and scale with them.
  const zButton = (id: 'ZL' | 'ZR', alpha: number) =>
    system === '3ds' && (
      <View
        ref={setRef(id)}
        style={[
          styles.shoulderButton,
          styles.shoulderButtonZ,
          {backgroundColor: withAlpha(cs.shoulderColor, alpha), borderRadius: cs.shoulderRadius},
          clusterScale('shoulders'),
          isPressed(id) && styles.shoulderButtonPressed,
        ]}>
        <Text style={styles.shoulderLabel}>{id}</Text>
      </View>
    );

  // Landscape: no drag-to-reposition (fixed corners instead -- rotating
  // the phone already gives plenty of room without needing per-user
  // placement), so this skips DraggableCluster/padRow/shoulderRow/
  // systemRow entirely and just anchors each cluster's own content
  // straight to a corner of this View, which fills whatever "stage"
  // area App.tsx gives it (see the landscape branch of App's render --
  // that area excludes the top bar, so nothing here overlaps it).
  if (orientation === 'landscape') {
    return (
      <View
        style={styles.landscapeControlsRoot}
        // box-none: this root covers the whole stage, and in landscape the
        // stage *is* the two DS screens -- so as a touch target it ate
        // every tap meant for the touch screen, including taps nowhere
        // near a button (confirmed: DsView's onTouchEvent never fired in
        // landscape, while it fires normally in portrait, where the
        // controls sit below the screen instead of over it). Declining
        // the RN responder wasn't enough; the view has to stop being a
        // target at all. Its children still are, and the responder
        // negotiation still bubbles up here from them, so the shared
        // multi-touch surface keeps working for the buttons themselves.
        pointerEvents="box-none"
        onLayout={measureAll}
        onStartShouldSetResponder={evt => !editing && isTouchOnButton(evt)}
        onMoveShouldSetResponder={evt => !editing && isTouchOnButton(evt)}
        onResponderTerminationRequest={() => false}
        onResponderGrant={updateFromTouches}
        onResponderMove={updateFromTouches}
        onResponderRelease={releaseAll}
        onResponderTerminate={releaseAll}>
        <View style={styles.landscapeShoulderLeft}>
          <DraggableCluster id="shoulderL" editing={editing} offset={offsets.shoulderL} onDrag={onDrag}>
          <View
            ref={setRef('L')}
            style={[
              styles.shoulderButton,
              {backgroundColor: withAlpha(cs.shoulderColor, 0.75), borderRadius: cs.shoulderRadius},
              clusterScale('shoulders'),
              system === 'gb' && styles.shoulderButtonInactive,
              isPressed('L') && styles.shoulderButtonPressed,
            ]}>
            <Text style={styles.shoulderLabel}>L</Text>
          </View>
          {zButton('ZL', 0.75)}
          </DraggableCluster>
        </View>
        <View style={styles.landscapeShoulderRight}>
          <DraggableCluster id="shoulderR" editing={editing} offset={offsets.shoulderR} onDrag={onDrag}>
          <View
            ref={setRef('R')}
            style={[
              styles.shoulderButton,
              {backgroundColor: withAlpha(cs.shoulderColor, 0.75), borderRadius: cs.shoulderRadius},
              clusterScale('shoulders'),
              system === 'gb' && styles.shoulderButtonInactive,
              isPressed('R') && styles.shoulderButtonPressed,
            ]}>
            <Text style={styles.shoulderLabel}>R</Text>
          </View>
          {zButton('ZR', 0.75)}
          </DraggableCluster>
        </View>

        <View style={[styles.landscapeDpadWrap, {top: stageHeight - LANDSCAPE_EDGE_MARGIN - LANDSCAPE_DPAD_HEIGHT}]}>
          <DraggableCluster id="dpad" editing={editing} offset={offsets.dpad} onDrag={onDrag}>
          <View style={[styles.dpad, clusterScale('dpad')]}>
            <View style={[styles.dpadBarHorizontal, {backgroundColor: withAlpha(cs.dpadColor, 0.75), borderRadius: cs.dpadRadius}]} />
            <View style={[styles.dpadBarVertical, {backgroundColor: withAlpha(cs.dpadColor, 0.75), borderRadius: cs.dpadRadius}]} />
            <View style={styles.dpadRivet} />
            <View
              ref={setRef('UP')}
              style={[styles.dpadHit, styles.dpadHitUp, {borderRadius: cs.dpadRadius}, isPressed('UP') && styles.dpadHitPressed]}>
              <IconTriangle rotation={0} />
            </View>
            <View
              ref={setRef('DOWN')}
              style={[styles.dpadHit, styles.dpadHitDown, {borderRadius: cs.dpadRadius}, isPressed('DOWN') && styles.dpadHitPressed]}>
              <IconTriangle rotation={180} />
            </View>
            <View
              ref={setRef('LEFT')}
              style={[styles.dpadHit, styles.dpadHitLeft, {borderRadius: cs.dpadRadius}, isPressed('LEFT') && styles.dpadHitPressed]}>
              <IconTriangle rotation={-90} />
            </View>
            <View
              ref={setRef('RIGHT')}
              style={[styles.dpadHit, styles.dpadHitRight, {borderRadius: cs.dpadRadius}, isPressed('RIGHT') && styles.dpadHitPressed]}>
              <IconTriangle rotation={90} />
            </View>
          </View>
          </DraggableCluster>
        </View>

        <View
          style={[
            styles.landscapeActionsWrap,
            {top: stageHeight - LANDSCAPE_EDGE_MARGIN - (isDs ? DS_DIAMOND_SIZE : LANDSCAPE_ACTIONS_HEIGHT)},
          ]}>
          <DraggableCluster id="actions" editing={editing} offset={offsets.actions} onDrag={onDrag}>
          <View style={[isDs ? styles.actionClusterDs : styles.actionCluster, clusterScale('actions')]}>
            <View
              ref={setRef('B')}
              style={[
                styles.actionButton,
                {backgroundColor: withAlpha(cs.actionColorB, 0.8), borderRadius: cs.actionRadius, transform: [{scale: cs.actionScale}]},
                isDs ? styles.buttonBPositionDs : styles.buttonBPosition,
                isPressed('B') && styles.actionButtonPressed,
              ]}>
              <Text style={styles.actionLabel}>B</Text>
            </View>
            <View
              ref={setRef('A')}
              style={[
                styles.actionButton,
                {backgroundColor: withAlpha(cs.actionColorA, 0.8), borderRadius: cs.actionRadius, transform: [{scale: cs.actionScale}]},
                isDs ? styles.buttonAPositionDs : styles.buttonAPosition,
                isPressed('A') && styles.actionButtonPressed,
              ]}>
              <Text style={styles.actionLabel}>A</Text>
            </View>
            {isDs && (
              <>
                <View
                  ref={setRef('X')}
                  style={[
                    styles.actionButton,
                    {backgroundColor: withAlpha(cs.actionColorA, 0.8), borderRadius: cs.actionRadius, transform: [{scale: cs.actionScale}]},
                    styles.buttonXPositionDs,
                    isPressed('X') && styles.actionButtonPressed,
                  ]}>
                  <Text style={styles.actionLabel}>X</Text>
                </View>
                <View
                  ref={setRef('Y')}
                  style={[
                    styles.actionButton,
                    {backgroundColor: withAlpha(cs.actionColorB, 0.8), borderRadius: cs.actionRadius, transform: [{scale: cs.actionScale}]},
                    styles.buttonYPositionDs,
                    isPressed('Y') && styles.actionButtonPressed,
                  ]}>
                  <Text style={styles.actionLabel}>Y</Text>
                </View>
              </>
            )}
          </View>
          </DraggableCluster>
        </View>

        <View style={[styles.landscapeSystemRow, {top: stageHeight - LANDSCAPE_EDGE_MARGIN - LANDSCAPE_SYSTEM_ROW_HEIGHT}]}>
          <DraggableCluster id="system" editing={editing} offset={offsets.system} onDrag={onDrag}>
          <View style={[styles.landscapeSystemInner, clusterScale('system')]}>
          <View ref={setRef('SELECT')} style={[styles.pillButton, styles.pillButtonSelect, isPressed('SELECT') && styles.pillButtonPressed]}>
            <Text style={styles.pillLabel}>SELECT</Text>
          </View>
          <View ref={setRef('START')} style={[styles.pillButton, styles.pillButtonStart, isPressed('START') && styles.pillButtonPressed]}>
            <Text style={styles.pillLabel}>START</Text>
          </View>
          </View>
          </DraggableCluster>
        </View>
      </View>
    );
  }

  return (
    <View
      style={styles.gameControlsRoot}
      // Same two guards landscape already had, and for the same reason:
      // this root spans every cluster's bounding box, including the wide
      // empty gap shoulderRow leaves between L and R. With the screen
      // top-anchored and large, that gap sits over the bottom strip of
      // the DS touch screen -- and claiming every touch inside the root
      // swallowed taps there, which is exactly where a game's "save
      // settings" style buttons live. Only claim a touch that lands on a
      // real button, and stop being a touch target otherwise so the ones
      // that miss fall through to DsView underneath.
      pointerEvents="box-none"
      onLayout={measureAll}
      onStartShouldSetResponder={evt => !editing && isTouchOnButton(evt)}
      onMoveShouldSetResponder={evt => !editing && isTouchOnButton(evt)}
      onResponderTerminationRequest={() => false}
      onResponderGrant={updateFromTouches}
      onResponderMove={updateFromTouches}
      onResponderRelease={releaseAll}
      onResponderTerminate={releaseAll}>
      {/* L and R are dragged independently. As one cluster they shared a
          343px-wide box with the buttons pinned to its far edges, so the
          only thing a user could do was slide both at once -- and with a
          large default screen that box straddles the DS touch screen,
          which reads as "the buttons are in the way" with no obvious fix.
          The row below is still their default layout (same size, same
          height, at the edges); it just isn't what moves anymore.
          clusterScale also moves from the row to each button: on the row
          it scaled the 343px gap too, pushing L and R further apart
          instead of just making them bigger (landscape already scales
          per-button, see landscapeShoulderLeft/Right). */}
      <View style={styles.shoulderRow}>
        <DraggableCluster id="shoulderL" editing={editing} offset={offsets.shoulderL} onDrag={onDrag}>
          <View
            ref={setRef('L')}
            style={[
              styles.shoulderButton,
              {backgroundColor: withAlpha(cs.shoulderColor, 0.85), borderRadius: cs.shoulderRadius},
              clusterScale('shoulders'),
              system === 'gb' && styles.shoulderButtonInactive,
              isPressed('L') && styles.shoulderButtonPressed,
            ]}>
            <View style={styles.shoulderHighlight} />
            <Text style={styles.shoulderLabel}>L</Text>
          </View>
          {zButton('ZL', 0.85)}
        </DraggableCluster>
        <DraggableCluster id="shoulderR" editing={editing} offset={offsets.shoulderR} onDrag={onDrag}>
          <View
            ref={setRef('R')}
            style={[
              styles.shoulderButton,
              {backgroundColor: withAlpha(cs.shoulderColor, 0.85), borderRadius: cs.shoulderRadius},
              clusterScale('shoulders'),
              system === 'gb' && styles.shoulderButtonInactive,
              isPressed('R') && styles.shoulderButtonPressed,
            ]}>
            <View style={styles.shoulderHighlight} />
            <Text style={styles.shoulderLabel}>R</Text>
          </View>
          {zButton('ZR', 0.85)}
        </DraggableCluster>
      </View>

      <View style={styles.padRow}>
        <DraggableCluster id="dpad" editing={editing} offset={offsets.dpad} onDrag={onDrag}>
          <View style={[styles.dpad, clusterScale('dpad')]}>
            <View style={[styles.dpadBarHorizontal, {backgroundColor: withAlpha(cs.dpadColor, 0.85), borderRadius: cs.dpadRadius}]} />
            <View style={[styles.dpadBarVertical, {backgroundColor: withAlpha(cs.dpadColor, 0.85), borderRadius: cs.dpadRadius}]} />
            <View style={styles.dpadRivet} />
            <View
              ref={setRef('UP')}
              style={[styles.dpadHit, styles.dpadHitUp, {borderRadius: cs.dpadRadius}, isPressed('UP') && styles.dpadHitPressed]}>
              <IconTriangle rotation={0} />
            </View>
            <View
              ref={setRef('DOWN')}
              style={[styles.dpadHit, styles.dpadHitDown, {borderRadius: cs.dpadRadius}, isPressed('DOWN') && styles.dpadHitPressed]}>
              <IconTriangle rotation={180} />
            </View>
            <View
              ref={setRef('LEFT')}
              style={[styles.dpadHit, styles.dpadHitLeft, {borderRadius: cs.dpadRadius}, isPressed('LEFT') && styles.dpadHitPressed]}>
              <IconTriangle rotation={-90} />
            </View>
            <View
              ref={setRef('RIGHT')}
              style={[styles.dpadHit, styles.dpadHitRight, {borderRadius: cs.dpadRadius}, isPressed('RIGHT') && styles.dpadHitPressed]}>
              <IconTriangle rotation={90} />
            </View>
          </View>
        </DraggableCluster>

        {/* B/A staggered diagonally (B lower-left, A upper-right), matching the real hardware layout. */}
        <DraggableCluster id="actions" editing={editing} offset={offsets.actions} onDrag={onDrag}>
          <View style={[isDs ? styles.actionClusterDs : styles.actionCluster, clusterScale('actions')]}>
            <View
              ref={setRef('B')}
              style={[
                styles.actionButton,
                {backgroundColor: withAlpha(cs.actionColorB, 0.85), borderRadius: cs.actionRadius, transform: [{scale: cs.actionScale}]},
                isDs ? styles.buttonBPositionDs : styles.buttonBPosition,
                isPressed('B') && styles.actionButtonPressed,
              ]}>
              <View style={styles.actionHighlight} />
              <Text style={styles.actionLabel}>B</Text>
            </View>
            <View
              ref={setRef('A')}
              style={[
                styles.actionButton,
                {backgroundColor: withAlpha(cs.actionColorA, 0.85), borderRadius: cs.actionRadius, transform: [{scale: cs.actionScale}]},
                isDs ? styles.buttonAPositionDs : styles.buttonAPosition,
                isPressed('A') && styles.actionButtonPressed,
              ]}>
              <View style={styles.actionHighlight} />
              <Text style={styles.actionLabel}>A</Text>
            </View>
            {/* On a DS the four face buttons are one diamond -- X top, Y
                left, A right, B bottom -- so on that system X/Y join this
                cluster as round buttons instead of living in their own
                pill row. They pair colours diagonally with the button
                they sit opposite, which keeps them themeable without
                inventing two more theme fields. */}
            {isDs && (
              <>
                <View
                  ref={setRef('X')}
                  style={[
                    styles.actionButton,
                    {backgroundColor: withAlpha(cs.actionColorA, 0.85), borderRadius: cs.actionRadius, transform: [{scale: cs.actionScale}]},
                    styles.buttonXPositionDs,
                    isPressed('X') && styles.actionButtonPressed,
                  ]}>
                  <View style={styles.actionHighlight} />
                  <Text style={styles.actionLabel}>X</Text>
                </View>
                <View
                  ref={setRef('Y')}
                  style={[
                    styles.actionButton,
                    {backgroundColor: withAlpha(cs.actionColorB, 0.85), borderRadius: cs.actionRadius, transform: [{scale: cs.actionScale}]},
                    styles.buttonYPositionDs,
                    isPressed('Y') && styles.actionButtonPressed,
                  ]}>
                  <View style={styles.actionHighlight} />
                  <Text style={styles.actionLabel}>Y</Text>
                </View>
              </>
            )}
          </View>
        </DraggableCluster>
      </View>

      <DraggableCluster id="system" editing={editing} offset={offsets.system} onDrag={onDrag}>
        <View style={[styles.systemRow, clusterScale('system')]}>
          <View ref={setRef('SELECT')} style={[styles.pillButton, styles.pillButtonSelect, isPressed('SELECT') && styles.pillButtonPressed]}>
            <View style={styles.pillHighlight} />
            <Text style={styles.pillLabel}>SELECT</Text>
          </View>
          <View ref={setRef('START')} style={[styles.pillButton, styles.pillButtonStart, isPressed('START') && styles.pillButtonPressed]}>
            <View style={styles.pillHighlight} />
            <Text style={styles.pillLabel}>START</Text>
          </View>
        </View>
      </DraggableCluster>
    </View>
  );
}

/**
 * Wraps one control cluster (the whole D-pad, the A/B pair, etc.) so it
 * can be dragged to a new position in "Personalizar controles" mode --
 * see App's controlLayout state. The offset is applied as a transform,
 * which RN's measure() (GameControls' own touch hit-testing) already
 * reports post-transform, so gameplay input keeps working at whatever
 * position the user drags a cluster to without any extra plumbing.
 *
 * The drag itself uses a PanResponder scoped to this one cluster rather
 * than GameControls' own shared responder (disabled while editing, see
 * its onStartShouldSetResponder) so multiple clusters don't fight over
 * who's dragging.
 */
function DraggableCluster({
  id,
  editing,
  offset,
  onDrag,
  children,
}: {
  id: ClusterId;
  editing: boolean;
  offset: ClusterOffset | undefined;
  onDrag: (id: ClusterId, dx: number, dy: number) => void;
  children: React.ReactNode;
}) {
  const resolvedOffset = offset ?? {dx: 0, dy: 0};
  // PanResponder's callbacks close over whatever `latest` pointed to
  // when PanResponder.create ran (once, via the useRef initializer) --
  // this ref is how they see up-to-date editing/offset values instead
  // of a stale first-render snapshot.
  // onDrag belongs in here too, not just editing/offset: PanResponder is
  // built once (useRef initializer), so calling the prop directly meant
  // every drag for the life of the view ran the callback from the *first*
  // render -- which closes over the layout as it was then. Dragging a
  // second cluster therefore saved the first one's position back to its
  // pre-drag value, silently undoing it.
  const latest = useRef({editing, offset: resolvedOffset, onDrag});
  latest.current = {editing, offset: resolvedOffset, onDrag};
  const dragStart = useRef({dx: 0, dy: 0});

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => latest.current.editing,
      onMoveShouldSetPanResponder: () => latest.current.editing,
      onPanResponderGrant: () => {
        dragStart.current = latest.current.offset;
      },
      onPanResponderMove: (_evt, gesture) => {
        latest.current.onDrag(id, dragStart.current.dx + gesture.dx, dragStart.current.dy + gesture.dy);
      },
    }),
  ).current;

  return (
    <View
      {...(editing ? panResponder.panHandlers : null)}
      style={[
        {transform: [{translateX: resolvedOffset.dx}, {translateY: resolvedOffset.dy}]},
        editing && styles.draggableEditing,
      ]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#14151a',
  },
  // Android stacks by elevation, not render order (see HomeScreen's own
  // note on this, and updateBanner above) -- consoleShell's own shadow
  // uses elevation:10, which without this would render it on top of the
  // buttons regardless of paint order, covering them once the screen is
  // scaled up enough to reach them.
  // width:'100%' so this matches the full-width bottomGroup it sits in.
  // Without it this box sized itself to its widest child and got centred,
  // which offset every '100%' row inside it by a few px against the real
  // screen -- enough to clip L off the left edge while R kept a margin.
  gameControlsRoot: {elevation: 15, width: '100%'},
  updateBanner: {
    position: 'absolute',
    left: 12,
    right: 12,
    top: 90,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#1e3a5c',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#4a90d9',
    // Android stacks by elevation, not render order (see HomeScreen's
    // own note on this) -- higher than any of HomeScreen's own cards
    // (max elevation:20) so this sits above them despite being a later
    // sibling, not under.
    elevation: 30,
  },
  updateBannerTitle: {color: '#fff', fontSize: 13, fontWeight: '700'},
  updateBannerChangelog: {color: '#cfe3fa', fontSize: 11, marginTop: 2},
  updateBannerButton: {backgroundColor: '#4a90d9', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14},
  updateBannerButtonLabel: {color: '#0c1420', fontSize: 12, fontWeight: '700'},
  updateBannerClose: {padding: 4},
  updateBannerCloseLabel: {color: '#cfe3fa', fontSize: 14, fontWeight: '700'},
  scrollContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 24,
  },
  topGroup: {alignItems: 'center', width: '100%'},
  // Top-anchored, not centred. GameControls overlays the lower part of
  // this same stage, so centring the screen across the full height left
  // dead space above it and grew it *into* the buttons below -- on the DS,
  // where one box holds two stacked screens, that meant the d-pad and the
  // face buttons sat on top of the lower (touch) screen at any useful
  // size. Anchoring to the top spends that dead space on the screen
  // instead, which is the room the controls were competing for.
  portraitStage: {position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'flex-start'},
  portraitBusy: {marginTop: 8},
  portraitMenuRow: {
    position: 'absolute',
    top: 6,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 14,
    elevation: 16,
  },
  portraitMenuButton: {
    width: 38,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  menuSection: {width: '100%', marginBottom: 10},
  menuSectionLabel: {color: '#888', fontSize: 12, marginBottom: 6},
  menuSpeedRow: {flexDirection: 'row', gap: 8},
  menuSpeedButton: {flex: 1, height: 36},
  menuItem: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginTop: 6,
    borderRadius: 10,
    backgroundColor: '#272a33',
  },
  menuItemLabel: {color: '#e6e6e6', fontSize: 14, fontWeight: '600'},
  menuItemDanger: {color: '#f0a0a0'},
  menuCard: {maxHeight: '100%', paddingHorizontal: 0},
  menuScroll: {width: '100%'},
  menuScrollContent: {alignItems: 'center', paddingHorizontal: 20},
  menuRoomSection: {marginTop: 6, marginBottom: 4},
  menuRoomNote: {color: '#b8bcc6', fontSize: 12, marginBottom: 8},
  menuRoomGrid: {flexDirection: 'row', flexWrap: 'wrap', gap: 6},
  menuRoomButton: {width: '18%', height: 32},
  menuRoomAction: {justifyContent: 'center'},
  editToolbarHeader: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8},
  editDoneButton: {paddingVertical: 6, paddingHorizontal: 14, borderRadius: 8, backgroundColor: '#2f5f8f'},
  editDoneLabel: {color: '#fff', fontWeight: '700', fontSize: 13},
  editToolbarHintInRow: {flex: 1},
  bottomGroup: {alignItems: 'center', width: '100%'},
  // Landscape: a slim top bar (not the portrait topGroup's console+title
  // block) plus a "stage" that fills the rest -- the screen centered in
  // it, GameControls overlaid on top absolutely. See App's isLandscape
  // branch and GameControls' own landscape branch.
  landscapeRoot: {flex: 1, width: '100%'},
  landscapeTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  landscapeRomLabel: {flex: 1, color: '#ccc', fontSize: 12},
  landscapeStage: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  landscapeEditOverlay: {position: 'absolute', left: 12, right: 12, alignItems: 'center'},
  coverOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15,16,20,0.22)',
  },
  homeButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
  },
  editToolbar: {
    width: '100%',
    marginTop: 8,
    // Translucent: this panel is how you arrange the controls, so it has
    // to let you see what you're arranging. It matters most in landscape,
    // where it floats over the screen rather than sitting above it.
    backgroundColor: 'rgba(30, 32, 39, 0.82)',
    borderRadius: 12,
    padding: 10,
  },
  editToolbarHint: {color: '#999', fontSize: 11, textAlign: 'center', marginBottom: 8},
  editToolbarRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10},
  editToolbarLabel: {color: '#ccc', fontSize: 12},
  scaleTargetRow: {flexWrap: 'wrap', marginBottom: 8},
  scaleTargetChip: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: '#2a2c34',
  },
  scaleTargetChipActive: {backgroundColor: '#4a90d9'},
  scaleTargetLabel: {color: '#ccc', fontSize: 11, fontWeight: '600'},
  scaleTargetLabelActive: {color: '#0c1420'},
  editStepButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#2a2c34',
    alignItems: 'center',
    justifyContent: 'center',
  },
  editStepLabel: {color: '#fff', fontSize: 16, fontWeight: '700', lineHeight: 18},
  editScaleValue: {color: '#fff', fontSize: 12, fontWeight: '700', width: 40, textAlign: 'center'},
  editResetButton: {
    marginLeft: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#3a2a2a',
  },
  editResetLabel: {color: '#ffb3b3', fontSize: 11, fontWeight: '700'},
  editThemeButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#2f5f8f',
  },
  editThemeLabel: {color: '#cfe3fa', fontSize: 11, fontWeight: '700'},
  draggableEditing: {
    borderWidth: 1,
    borderColor: '#7ab8ff',
    borderStyle: 'dashed',
    borderRadius: 10,
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
  // ZL/ZR under L/R on the 3DS: a little shorter, so the pair stays compact.
  shoulderButtonZ: {
    height: 28,
    marginTop: 6,
  },
  shoulderButtonPressed: {backgroundColor: '#4a72a0'},
  shoulderHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '45%',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  shoulderLabel: {color: '#eee', fontWeight: '700', fontSize: 13},
  // Landscape only: portrait shows the screen bare, edge to edge.
  screenBezel: {
    backgroundColor: '#000',
    borderRadius: 10,
    padding: 6,
  },
  screen: {
    width: 331,
    height: 298,
    backgroundColor: '#000',
    borderRadius: 4,
  },
  screenGba: {
    width: 331,
    height: 221,
    backgroundColor: '#000',
    borderRadius: 4,
  },
  // Two 256x192 screens stacked (2:3 combined). Sized to use a good
  // amount of the device without being oversized -- what used to make
  // it look like it "covered" the A button (and blocked the DS
  // touchscreen under L/R) was GameControls' shared touch surface
  // claiming the whole gap between L and R even where nothing was
  // drawn (see isTouchOnButton), not the screen's size, so this no
  // longer needs to be shrunk to fix that.
  screenDs: {
    // transparent, not '#000': DsView is a SurfaceView, and a background
    // here is painted straight over the transparent hole it punches to
    // let its own GL layer show through -- see DsView.kt's init block.
    width: 220,
    height: 330,
    backgroundColor: 'transparent',
    borderRadius: 4,
  },
  // Same two 256x192 screens, laid out left/right by DsView's native
  // onDraw once its box is wider than it is tall -- see isSideBySide()
  // there. Combined aspect is 512:192 (8:3); this base keeps that ratio.
  screenDsLandscape: {
    width: 400,
    height: 150,
    backgroundColor: 'transparent',
    borderRadius: 4,
  },
  // The 3DS's two screens, laid out by N3dsView's native side the same way
  // DsView lays out the DS's: stacked here, each fitted to its half -- the
  // box is sized so the 5:3 top screen fills the width exactly, the 4:3
  // bottom one centred below it. Same width as screenDs, so the default
  // 1.4 scale gives it the same footprint. Transparent for the same
  // SurfaceView reason as screenDs.
  screen3ds: {
    width: 220,
    height: 264,
    backgroundColor: 'transparent',
    borderRadius: 4,
  },
  // Side by side, each screen in its half: a 5:3 top screen fills a half
  // of 200x120 exactly.
  screen3dsLandscape: {
    width: 400,
    height: 120,
    backgroundColor: 'transparent',
    borderRadius: 4,
  },
  shoulderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    // Full width, not a fixed 343: that width was centred in whatever the
    // controls column happened to be, so the two ends landed at arbitrary
    // points -- L flush against the left edge (and clipped by it) while R
    // kept a margin on the right. '100%' with space-between puts each one
    // on its own real edge, symmetrically, on any screen width.
    width: '100%',
    marginTop: 6,
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
  slotsRow: {width: '100%', gap: 8},
  slotCard: {
    width: '100%',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#242526',
  },
  gameSaveCard: {marginTop: 12},
  slotCardTop: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 6},
  slotDelete: {width: 36, height: 36, alignItems: 'center', justifyContent: 'center'},
  slotLabel: {color: '#ddd', fontSize: 14, fontWeight: '700'},
  slotMeta: {color: '#8a8a8a', fontSize: 12, marginTop: 2},
  slotActions: {flexDirection: 'row', gap: 6},
  // 44dp tall: these are tapped mid-game, often in a hurry.
  slotActionButton: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: 2,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#3a5a7a',
  },
  slotActionSolo: {flex: 0, paddingHorizontal: 20},
  slotActionButtonDisabled: {backgroundColor: '#2a2a2a', opacity: 0.5},
  slotActionButtonCloud: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#1e5c4f',
  },
  slotActionLabel: {color: '#fff', fontSize: 12, fontWeight: '700'},
  slotActionLabelDisabled: {color: '#777'},
  slotActionLabelCloud: {color: '#a0ffe8'},
  modalCloudHint: {color: '#666', fontSize: 10, textAlign: 'center', marginTop: 10, paddingHorizontal: 8},
  gameSaveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#242526',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginTop: 12,
    width: '100%',
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
    marginTop: 12,
  },
  dpad: {width: 144, height: 144},
  dpadBarHorizontal: {
    position: 'absolute',
    top: 48,
    left: 0,
    width: 144,
    height: 48,
    backgroundColor: '#33353c',
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 3},
    shadowOpacity: 0.35,
    shadowRadius: 5,
    elevation: 5,
  },
  dpadBarVertical: {
    position: 'absolute',
    top: 0,
    left: 48,
    width: 48,
    height: 144,
    backgroundColor: '#33353c',
    borderRadius: 8,
  },
  dpadRivet: {
    position: 'absolute',
    top: 60,
    left: 60,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#3d3f48',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  dpadHit: {
    position: 'absolute',
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  dpadHitPressed: {backgroundColor: 'rgba(255,255,255,0.12)'},
  dpadHitUp: {top: 0, left: 48},
  dpadHitDown: {top: 96, left: 48},
  dpadHitLeft: {top: 48, left: 0},
  dpadHitRight: {top: 48, left: 96},
  actionCluster: {width: 140, height: 110, marginRight: 8},
  // DS diamond: 60px buttons at the four points of a 160x160 box, so
  // their centres sit ~71px apart -- about 10px of gap, the snug
  // arrangement a real DS has, rather than four buttons floating apart.
  actionClusterDs: {width: DS_DIAMOND_SIZE, height: DS_DIAMOND_SIZE, marginRight: 8},
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
  buttonAPosition: {top: 0, right: 0},
  buttonBPosition: {bottom: 0, left: 0},
  buttonAPositionDs: {top: 50, right: 0},
  buttonBPositionDs: {bottom: 0, left: 50},
  buttonXPositionDs: {top: 0, left: 50},
  buttonYPositionDs: {top: 50, left: 0},
  actionButtonPressed: {opacity: 0.7},
  actionLabel: {color: '#fff', fontSize: 20, fontWeight: '700'},
  systemRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginTop: 14,
  },
  // Landscape overlay anchors -- see GameControls' landscape branch.
  // Fixed corners instead of DraggableCluster's drag-to-reposition
  // (rotating the phone already gives plenty of room without needing
  // per-user placement for v1).
  landscapeControlsRoot: {position: 'absolute', top: 0, left: 0, right: 0, bottom: 0},
  landscapeShoulderLeft: {position: 'absolute', top: 8, left: 12},
  landscapeShoulderRight: {position: 'absolute', top: 8, right: 12},
  landscapeSystemInner: {flexDirection: 'row', gap: 10},
  landscapeDpadWrap: {position: 'absolute', left: 20, width: 144, height: LANDSCAPE_DPAD_HEIGHT},
  landscapeActionsWrap: {position: 'absolute', right: 20, width: 140, height: LANDSCAPE_ACTIONS_HEIGHT},
  landscapeSystemRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: LANDSCAPE_SYSTEM_ROW_HEIGHT,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
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
  pillButtonSelect: {backgroundColor: 'rgba(58, 61, 71, 0.8)'},
  pillButtonStart: {backgroundColor: 'rgba(69, 64, 64, 0.8)'},
  pillButtonPressed: {opacity: 0.7},
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
