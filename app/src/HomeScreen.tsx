import React from 'react';
import {ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View} from 'react-native';
import {CachedRom} from './RomLibraryNative';
import {IconAccount, IconCartridge, IconClose, IconFile, IconFolder, IconGlobe, IconLink} from './icons';

const SYSTEM_LABEL: Record<string, string> = {gb: 'GB', gbc: 'GBC', gba: 'GBA', nds: 'NDS', '3ds': '3DS'};
const SYSTEM_COLOR: Record<string, string> = {gb: '#4a90d9', gbc: '#5cb85c', gba: '#c2536a', nds: '#8e5cd9', '3ds': '#d9534f'};

// Same names and sizes as the desktop app's library (multiemu_exe
// src/renderer/library.js): the title inside a DS/3DS game, else the file
// name without its extension, a leading "1234 - " or anything in ( ) / [ ].
function gameName(rom: CachedRom): string {
  if (rom.title) return rom.title;
  const tidy = rom.label
    .replace(/\.[^.]+$/, '')
    .replace(/^\d+\s+-\s+/, '')
    .replace(/\s*[([][^)\]]*[)\]]/g, '')
    .trim();
  return tidy || rom.label;
}

// "2 GB", "16 MB", "65 KB": the largest unit with a whole number in front.
const sizeNumber = new Intl.NumberFormat('es', {maximumFractionDigits: 1});
function sizeText(bytes: number): string {
  for (const [unit, size] of [['GB', 1024 ** 3], ['MB', 1024 ** 2], ['KB', 1024]] as const) {
    if (bytes >= size) return `${sizeNumber.format(bytes / size)} ${unit}`;
  }
  return `${bytes} B`;
}

// A .gbc plays on the Game Boy core (system 'gb'), but it's a Game Boy Color game.
const badgeSystem = (rom: CachedRom) => (rom.system === 'gb' && /\.gbc$/i.test(rom.name) ? 'gbc' : rom.system);

interface Props {
  recentRoms: CachedRom[];
  onSelectRecent: (rom: CachedRom) => void;
  onDeleteRecent: (rom: CachedRom) => void;
  onPickFile: () => void;
  onPickFolder: () => void;
  onBrowseHub: () => void;
  onOpenLocalLink: () => void;
  lastFolder: {uri: string; name: string} | null;
  onOpenLastFolder: () => void;
  busy: boolean;
  username: string | null;
  onOpenAccount: () => void;
  onOpenFeedback: () => void;
}

/**
 * Landing screen: recently-loaded ROMs (cached on-device, see
 * RomLibraryModule.kt) for a one-tap reopen, plus the ways to get a new
 * one in. App.tsx only mounts the actual emulator screen once something
 * is loaded from here. Styled like a handheld's power-on screen (bezel
 * plate, power LED, speaker grill) rather than a plain settings-style
 * list, so it reads as "about to play a game" instead of a form.
 */
export default function HomeScreen({
  recentRoms,
  onSelectRecent,
  onDeleteRecent,
  onPickFile,
  onPickFolder,
  onBrowseHub,
  onOpenLocalLink,
  lastFolder,
  onOpenLastFolder,
  busy,
  username,
  onOpenAccount,
  onOpenFeedback,
}: Props) {
  return (
    <View style={styles.container}>
      <Pressable style={styles.feedbackButton} onPress={onOpenFeedback} hitSlop={8}>
        <Text style={styles.feedbackLabel}>Comentarios</Text>
      </Pressable>
      <Pressable style={styles.accountButton} onPress={onOpenAccount} hitSlop={8}>
        <IconAccount size={18} color={username ? '#a0ffe8' : '#888'} />
        {username && <Text style={styles.accountLabel} numberOfLines={1}>{username}</Text>}
      </Pressable>

      <View style={styles.titlePlate}>
        <View style={styles.titlePlateHighlight} />
        <View style={styles.powerRow}>
          <View style={styles.powerLed} />
          <Text style={styles.powerLabel}>ON</Text>
        </View>
        <Text style={styles.title}>multiemu</Text>
        <View style={styles.titleAccent} />
        <Text style={styles.subtitle}>Game Boy · Game Boy Color · Game Boy Advance</Text>
        <View style={styles.grill}>
          {[0, 1, 2, 3, 4, 5, 6].map(i => (
            <View key={i} style={styles.grillHole} />
          ))}
        </View>
      </View>

      <View style={styles.actions}>
        <Pressable style={[styles.actionButton, {borderColor: '#254a70'}]} onPress={onPickFile}>
          <View style={styles.actionButtonHighlight} />
          <View style={[styles.actionIconCircle, {backgroundColor: '#254a70'}]}>
            <IconFile size={20} color="#cfe3fa" />
          </View>
          <Text style={styles.actionLabel}>Cargar un archivo</Text>
        </Pressable>
        <Pressable style={[styles.actionButton, {borderColor: '#6a4a1e'}]} onPress={onPickFolder}>
          <View style={styles.actionButtonHighlight} />
          <View style={[styles.actionIconCircle, {backgroundColor: '#6a4a1e'}]}>
            <IconFolder size={20} color="#ffd9a0" />
          </View>
          <Text style={styles.actionLabel}>{lastFolder ? 'Cambiar carpeta' : 'Elegir carpeta'}</Text>
        </Pressable>
        <Pressable style={[styles.actionButton, {borderColor: '#3f2a5c'}]} onPress={onBrowseHub}>
          <View style={styles.actionButtonHighlight} />
          <View style={[styles.actionIconCircle, {backgroundColor: '#3f2a5c'}]}>
            <IconGlobe size={20} color="#d9c6ff" />
          </View>
          <Text style={styles.actionLabel}>HackRoms y Archivos</Text>
        </Pressable>
        <Pressable style={[styles.actionButton, {borderColor: '#1e5c4f'}]} onPress={onOpenLocalLink}>
          <View style={styles.actionButtonHighlight} />
          <View style={[styles.actionIconCircle, {backgroundColor: '#1e5c4f'}]}>
            <IconLink size={20} color="#a0ffe8" />
          </View>
          <Text style={styles.actionLabel}>Link local (beta)</Text>
        </Pressable>
      </View>

      {lastFolder && (
        <Pressable style={styles.folderShortcut} onPress={onOpenLastFolder}>
          <View style={[styles.actionIconCircle, {backgroundColor: '#6a4a1e'}]}>
            <IconFolder size={18} color="#ffd9a0" />
          </View>
          <View style={styles.folderShortcutInfo}>
            <Text style={styles.folderShortcutTitle} numberOfLines={1}>
              {lastFolder.name}
            </Text>
            <Text style={styles.folderShortcutMeta}>Tu carpeta de ROMs · toca para ver</Text>
          </View>
        </Pressable>
      )}

      <Text style={styles.sectionTitle}>Recientes</Text>
      <FlatList
        data={recentRoms}
        keyExtractor={r => r.id}
        numColumns={2}
        columnWrapperStyle={styles.slotColumnWrapper}
        contentContainerStyle={styles.list}
        renderItem={({item}) => (
          <Pressable style={styles.slotCard} onPress={() => onSelectRecent(item)}>
            <View style={[styles.slotCardAccent, {backgroundColor: SYSTEM_COLOR[badgeSystem(item)] ?? '#555'}]} />
            <View style={styles.slotCardTop}>
              <View style={[styles.systemBadge, {backgroundColor: SYSTEM_COLOR[badgeSystem(item)] ?? '#555'}]}>
                <Text style={styles.systemBadgeLabel}>{SYSTEM_LABEL[badgeSystem(item)] ?? item.system.toUpperCase()}</Text>
              </View>
              <Pressable hitSlop={10} onPress={() => onDeleteRecent(item)}>
                <IconClose size={14} color="#777" />
              </Pressable>
            </View>
            <Text style={styles.romLabel} numberOfLines={2}>
              {gameName(item)}
            </Text>
            <Text style={styles.romMeta} numberOfLines={1}>
              {sizeText(item.size)}
            </Text>
          </Pressable>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <IconCartridge size={40} color="#444" />
            <Text style={styles.emptyText}>Todavía no has cargado ninguna ROM.{'\n'}Usa una de las opciones de arriba.</Text>
          </View>
        }
      />

      {busy && (
        <View style={styles.busyOverlay}>
          <View style={styles.busyCard}>
            <ActivityIndicator size="large" color="#7ab8ff" />
            <Text style={styles.busyText}>Cargando ROM…</Text>
          </View>
        </View>
      )}
    </View>
  );
}

const CARD_SHADOW = {
  shadowColor: '#000',
  shadowOffset: {width: 0, height: 3},
  shadowOpacity: 0.3,
  shadowRadius: 5,
  elevation: 4,
};

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#14151a', paddingTop: 56, paddingHorizontal: 20},
  feedbackButton: {
    position: 'absolute',
    top: 14,
    left: 16,
    backgroundColor: '#1e2027',
    borderRadius: 14,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  feedbackLabel: {color: '#888', fontSize: 12, fontWeight: '600'},
  accountButton: {
    position: 'absolute',
    top: 14,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1e2027',
    borderRadius: 14,
    paddingVertical: 6,
    paddingHorizontal: 10,
    maxWidth: 140,
    zIndex: 1,
  },
  accountLabel: {color: '#a0ffe8', fontSize: 11, fontWeight: '700'},
  // A console-shell "plate" around the logo/subtitle, styled like the
  // in-game consoleShell (App.tsx) so the very first thing you see
  // already reads as hardware, not a settings screen.
  titlePlate: {
    alignItems: 'center',
    backgroundColor: '#1a1c22',
    borderRadius: 22,
    borderWidth: 2,
    borderColor: '#2c2f38',
    paddingTop: 18,
    paddingBottom: 14,
    marginBottom: 18,
    overflow: 'hidden',
    ...CARD_SHADOW,
  },
  titlePlateHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '38%',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  powerRow: {flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10},
  powerLed: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#5cff9d',
    shadowColor: '#5cff9d',
    shadowOffset: {width: 0, height: 0},
    shadowOpacity: 0.9,
    shadowRadius: 4,
    elevation: 3,
  },
  powerLabel: {color: '#5cff9d', fontSize: 10, fontWeight: '800', letterSpacing: 1},
  title: {color: '#fff', fontSize: 30, fontWeight: '800', textAlign: 'center', letterSpacing: 0.5},
  titleAccent: {
    width: 48,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#4a90d9',
    marginTop: 6,
  },
  subtitle: {color: '#888', fontSize: 12, textAlign: 'center', marginTop: 10},
  grill: {flexDirection: 'row', gap: 7, marginTop: 14},
  grillHole: {width: 5, height: 5, borderRadius: 2.5, backgroundColor: '#33353c'},
  actions: {flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14},
  actionButton: {
    flexBasis: '47%',
    flexGrow: 1,
    backgroundColor: '#1e2027',
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 16,
    alignItems: 'center',
    gap: 8,
    overflow: 'hidden',
    ...CARD_SHADOW,
  },
  actionButtonHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '45%',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  actionIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: {color: '#ddd', fontSize: 11, fontWeight: '600', textAlign: 'center'},
  folderShortcut: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#1e2027',
    borderRadius: 12,
    padding: 12,
    marginBottom: 22,
    ...CARD_SHADOW,
  },
  folderShortcutInfo: {flex: 1},
  folderShortcutTitle: {color: '#fff', fontSize: 14, fontWeight: '700'},
  folderShortcutMeta: {color: '#888', fontSize: 11, marginTop: 2},
  sectionTitle: {color: '#888', fontSize: 12, fontWeight: '700', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5},
  list: {paddingBottom: 24},
  slotColumnWrapper: {gap: 10},
  slotCard: {
    flex: 1,
    backgroundColor: '#1e2027',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    minHeight: 92,
    overflow: 'hidden',
    ...CARD_SHADOW,
  },
  slotCardAccent: {position: 'absolute', top: 0, left: 0, bottom: 0, width: 4},
  slotCardTop: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8},
  systemBadge: {borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3},
  systemBadgeLabel: {color: '#fff', fontSize: 10, fontWeight: '800'},
  romLabel: {color: '#fff', fontSize: 13, fontWeight: '600', flex: 1},
  romMeta: {color: '#888', fontSize: 10, marginTop: 4},
  empty: {alignItems: 'center', marginTop: 32, gap: 12},
  emptyText: {color: '#666', textAlign: 'center', paddingHorizontal: 12, fontSize: 13, lineHeight: 19},
  busyOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(10,10,14,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
    // Android stacks by elevation, not render order -- the action/recent
    // cards below all carry CARD_SHADOW's elevation:4, which would sit on
    // top of this despite it being the last sibling.
    elevation: 20,
    zIndex: 20,
  },
  busyCard: {
    backgroundColor: '#1e2027',
    borderRadius: 16,
    paddingVertical: 24,
    paddingHorizontal: 32,
    alignItems: 'center',
    gap: 12,
  },
  busyText: {color: '#ddd', fontSize: 13, fontWeight: '600'},
});
