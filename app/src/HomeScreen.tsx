import React from 'react';
import {FlatList, Pressable, StyleSheet, Text, View} from 'react-native';
import {CachedRom} from './RomLibraryNative';
import {IconCartridge, IconClose, IconFile, IconFolder, IconGlobe} from './icons';

const SYSTEM_LABEL: Record<string, string> = {gb: 'GB', gbc: 'GBC', gba: 'GBA'};
const SYSTEM_COLOR: Record<string, string> = {gb: '#4a90d9', gbc: '#5cb85c', gba: '#c2536a'};

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
          <View style={[styles.actionIconCircle, {backgroundColor: '#254a70'}]}>
            <IconFolder size={20} color="#cfe3fa" />
          </View>
          <Text style={styles.actionLabel}>Elegir carpeta</Text>
        </Pressable>
        <Pressable style={styles.actionButton} onPress={onBrowseHackRoms}>
          <View style={[styles.actionIconCircle, {backgroundColor: '#254a70'}]}>
            <IconGlobe size={20} color="#cfe3fa" />
          </View>
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
            <View style={[styles.romAccent, {backgroundColor: SYSTEM_COLOR[item.system] ?? '#555'}]} />
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
              <IconClose size={16} color="#777" />
            </Pressable>
          </Pressable>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <IconCartridge size={40} color="#444" />
            <Text style={styles.emptyText}>Todavía no has cargado ninguna ROM.{'\n'}Usa una de las opciones de arriba.</Text>
          </View>
        }
      />
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
  actions: {flexDirection: 'row', gap: 10, marginBottom: 28},
  actionButton: {
    flex: 1,
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
  sectionTitle: {color: '#888', fontSize: 12, fontWeight: '700', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5},
  list: {paddingBottom: 24},
  romRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e2027',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    gap: 12,
    overflow: 'hidden',
    ...CARD_SHADOW,
  },
  romAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
  },
  systemBadge: {borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, marginLeft: 4},
  systemBadgeLabel: {color: '#fff', fontSize: 11, fontWeight: '800'},
  romInfo: {flex: 1},
  romLabel: {color: '#fff', fontSize: 14, fontWeight: '600'},
  romMeta: {color: '#888', fontSize: 11, marginTop: 2},
  empty: {alignItems: 'center', marginTop: 32, gap: 12},
  emptyText: {color: '#666', textAlign: 'center', paddingHorizontal: 12, fontSize: 13, lineHeight: 19},
});
