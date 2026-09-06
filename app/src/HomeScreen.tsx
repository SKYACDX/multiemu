import React from 'react';
import {ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View} from 'react-native';
import {CachedRom} from './RomLibraryNative';
import {IconAccount, IconCartridge, IconClose, IconFile, IconFolder, IconGlobe} from './icons';

const SYSTEM_LABEL: Record<string, string> = {gb: 'GB', gbc: 'GBC', gba: 'GBA'};
const SYSTEM_COLOR: Record<string, string> = {gb: '#4a90d9', gbc: '#5cb85c', gba: '#c2536a'};

interface Props {
  recentRoms: CachedRom[];
  onSelectRecent: (rom: CachedRom) => void;
  onDeleteRecent: (rom: CachedRom) => void;
  onPickFile: () => void;
  onPickFolder: () => void;
  onBrowseHackRoms: () => void;
  onBrowseFiles: () => void;
  lastFolder: {uri: string; name: string} | null;
  onOpenLastFolder: () => void;
  busy: boolean;
  username: string | null;
  onOpenAccount: () => void;
}

/**
 * Landing screen: recently-loaded ROMs (cached on-device, see
 * RomLibraryModule.kt) for a one-tap reopen, plus the three ways to get
 * a new one in. App.tsx only mounts the actual emulator screen once
 * something is loaded from here.
 */
export default function HomeScreen({
  recentRoms,
  onSelectRecent,
  onDeleteRecent,
  onPickFile,
  onPickFolder,
  onBrowseHackRoms,
  onBrowseFiles,
  lastFolder,
  onOpenLastFolder,
  busy,
  username,
  onOpenAccount,
}: Props) {
  return (
    <View style={styles.container}>
      <Pressable style={styles.accountButton} onPress={onOpenAccount} hitSlop={8}>
        <IconAccount size={18} color={username ? '#a0ffe8' : '#888'} />
        {username && <Text style={styles.accountLabel} numberOfLines={1}>{username}</Text>}
      </Pressable>
      <View style={styles.titleRow}>
        <Text style={styles.title}>multiemu</Text>
        <View style={styles.titleAccent} />
      </View>
      <Text style={styles.subtitle}>Game Boy · Game Boy Color · Game Boy Advance</Text>

      <View style={styles.actions}>
        <Pressable style={styles.actionButton} onPress={onPickFile}>
          <View style={[styles.actionIconCircle, {backgroundColor: '#254a70'}]}>
            <IconFile size={20} color="#cfe3fa" />
          </View>
          <Text style={styles.actionLabel}>Cargar un archivo</Text>
        </Pressable>
        <Pressable style={styles.actionButton} onPress={onPickFolder}>
          <View style={[styles.actionIconCircle, {backgroundColor: '#6a4a1e'}]}>
            <IconFolder size={20} color="#ffd9a0" />
          </View>
          <Text style={styles.actionLabel}>{lastFolder ? 'Cambiar carpeta' : 'Elegir carpeta'}</Text>
        </Pressable>
        <Pressable style={styles.actionButton} onPress={onBrowseHackRoms}>
          <View style={[styles.actionIconCircle, {backgroundColor: '#3f2a5c'}]}>
            <IconGlobe size={20} color="#d9c6ff" />
          </View>
          <Text style={styles.actionLabel}>Buscar HackRoms</Text>
        </Pressable>
        <Pressable style={styles.actionButton} onPress={onBrowseFiles}>
          <View style={[styles.actionIconCircle, {backgroundColor: '#1e5c4f'}]}>
            <IconFile size={20} color="#a0ffe8" />
          </View>
          <Text style={styles.actionLabel}>Archivos</Text>
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
            <View style={styles.slotCardTop}>
              <View style={[styles.systemBadge, {backgroundColor: SYSTEM_COLOR[item.system] ?? '#555'}]}>
                <Text style={styles.systemBadgeLabel}>{SYSTEM_LABEL[item.system] ?? item.system.toUpperCase()}</Text>
              </View>
              <Pressable hitSlop={10} onPress={() => onDeleteRecent(item)}>
                <IconClose size={14} color="#777" />
              </Pressable>
            </View>
            <Text style={styles.romLabel} numberOfLines={2}>
              {item.label}
            </Text>
            <Text style={styles.romMeta} numberOfLines={1}>
              {(item.size / 1024 / 1024).toFixed(1)} MB
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
  },
  accountLabel: {color: '#a0ffe8', fontSize: 11, fontWeight: '700'},
  titleRow: {alignItems: 'center'},
  title: {color: '#fff', fontSize: 30, fontWeight: '800', textAlign: 'center', letterSpacing: 0.5},
  titleAccent: {
    width: 48,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#4a90d9',
    marginTop: 6,
  },
  subtitle: {color: '#888', fontSize: 12, textAlign: 'center', marginTop: 10, marginBottom: 26},
  actions: {flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14},
  actionButton: {
    flexBasis: '47%',
    flexGrow: 1,
    backgroundColor: '#1e2027',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    gap: 8,
    ...CARD_SHADOW,
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
    ...CARD_SHADOW,
  },
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
