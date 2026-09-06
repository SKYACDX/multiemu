import React from 'react';
import {FlatList, Pressable, StyleSheet, Text, View} from 'react-native';
import {CachedRom} from './RomLibraryNative';

const SYSTEM_LABEL: Record<string, string> = {gb: 'GB', gbc: 'GBC', gba: 'GBA'};
const SYSTEM_COLOR: Record<string, string> = {gb: '#4a90d9', gbc: '#5cb85c', gba: '#a8465a'};

interface Props {
  recentRoms: CachedRom[];
  onSelectRecent: (rom: CachedRom) => void;
  onDeleteRecent: (rom: CachedRom) => void;
  onPickFile: () => void;
  onPickFolder: () => void;
  onBrowseHackRoms: () => void;
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
}: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>multiemu</Text>
      <Text style={styles.subtitle}>Game Boy · Game Boy Color · Game Boy Advance</Text>

      <View style={styles.actions}>
        <Pressable style={styles.actionButton} onPress={onPickFile}>
          <Text style={styles.actionIcon}>📄</Text>
          <Text style={styles.actionLabel}>Cargar un archivo</Text>
        </Pressable>
        <Pressable style={styles.actionButton} onPress={onPickFolder}>
          <Text style={styles.actionIcon}>📁</Text>
          <Text style={styles.actionLabel}>Elegir carpeta</Text>
        </Pressable>
        <Pressable style={styles.actionButton} onPress={onBrowseHackRoms}>
          <Text style={styles.actionIcon}>🌐</Text>
          <Text style={styles.actionLabel}>Buscar HackRoms</Text>
        </Pressable>
      </View>

      <Text style={styles.sectionTitle}>Recientes</Text>
      <FlatList
        data={recentRoms}
        keyExtractor={r => r.id}
        contentContainerStyle={styles.list}
        renderItem={({item}) => (
          <Pressable style={styles.romRow} onPress={() => onSelectRecent(item)}>
            <View style={[styles.systemBadge, {backgroundColor: SYSTEM_COLOR[item.system] ?? '#555'}]}>
              <Text style={styles.systemBadgeLabel}>{SYSTEM_LABEL[item.system] ?? item.system.toUpperCase()}</Text>
            </View>
            <View style={styles.romInfo}>
              <Text style={styles.romLabel} numberOfLines={1}>
                {item.label}
              </Text>
              <Text style={styles.romMeta} numberOfLines={1}>
                {item.name} · {(item.size / 1024 / 1024).toFixed(1)} MB
              </Text>
            </View>
            <Pressable hitSlop={12} onPress={() => onDeleteRecent(item)}>
              <Text style={styles.deleteIcon}>✕</Text>
            </Pressable>
          </Pressable>
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>Todavía no has cargado ninguna ROM -- usa una de las opciones de arriba.</Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#1a1a1a', paddingTop: 56, paddingHorizontal: 20},
  title: {color: '#fff', fontSize: 28, fontWeight: '800', textAlign: 'center'},
  subtitle: {color: '#888', fontSize: 12, textAlign: 'center', marginTop: 4, marginBottom: 24},
  actions: {flexDirection: 'row', gap: 10, marginBottom: 28},
  actionButton: {
    flex: 1,
    backgroundColor: '#2f5f8f',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  actionIcon: {fontSize: 22, marginBottom: 6},
  actionLabel: {color: '#fff', fontSize: 12, fontWeight: '600', textAlign: 'center'},
  sectionTitle: {color: '#aaa', fontSize: 13, fontWeight: '700', marginBottom: 8, textTransform: 'uppercase'},
  list: {paddingBottom: 24},
  romRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#242424',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    gap: 12,
  },
  systemBadge: {borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4},
  systemBadgeLabel: {color: '#fff', fontSize: 11, fontWeight: '800'},
  romInfo: {flex: 1},
  romLabel: {color: '#fff', fontSize: 14, fontWeight: '600'},
  romMeta: {color: '#888', fontSize: 11, marginTop: 2},
  deleteIcon: {color: '#777', fontSize: 16, paddingHorizontal: 4},
  empty: {color: '#666', textAlign: 'center', marginTop: 24, paddingHorizontal: 12, fontSize: 13},
});
