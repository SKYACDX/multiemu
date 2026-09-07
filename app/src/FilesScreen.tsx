import React, {useCallback, useEffect, useState} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {listFiles, RomHackHubFile} from './api/romHackHub';
import {IconChevronLeft, IconFile} from './icons';
import PlatformMenu from './PlatformMenu';

const PLATFORMS = [
  {slug: 'gb', label: 'Game Boy'},
  {slug: 'gbc', label: 'Game Boy Color'},
  {slug: 'gba', label: 'Game Boy Advance'},
  {slug: 'nds', label: 'Nintendo DS'},
];

// This endpoint isn't restricted to emulator-loadable files the way
// /hacks is (RomHack Hub's own docs describe it as "arbitrary public
// files" -- cover art, docs, etc.) -- only show ones this app can
// actually do something with.
const COMPATIBLE_EXTENSIONS = ['zip', 'gb', 'gbc', 'gba', 'nds'];

function isCompatible(file: RomHackHubFile): boolean {
  const ext = file.originalName.split('.').pop()?.toLowerCase() ?? '';
  return COMPATIBLE_EXTENSIONS.includes(ext);
}

interface Props {
  onSelectFile: (file: RomHackHubFile) => void;
  onClose: () => void;
  downloading: boolean;
  /** True when shown as a tab inside HubScreen, which already renders its own header/close button. */
  embedded?: boolean;
}

/** Browses RomHack Hub's public "files" catalog (see api/romHackHub.ts's listFiles), filtered by platform. */
export default function FilesScreen({onSelectFile, onClose, downloading, embedded}: Props) {
  const [platform, setPlatform] = useState('gb');
  const [query, setQuery] = useState('');
  const [files, setFiles] = useState<RomHackHubFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const {files: results} = await listFiles({platform, q: query || undefined, limit: 40});
      setFiles(results.filter(isCompatible));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [platform, query]);

  useEffect(() => {
    search();
  }, [search]);

  return (
    <View style={styles.container}>
      {!embedded && (
        <View style={styles.header}>
          <Pressable style={styles.backButton} onPress={onClose} hitSlop={8}>
            <IconChevronLeft size={20} />
            <Text style={styles.link}>Cerrar</Text>
          </Pressable>
          <Text style={styles.title}>Archivos</Text>
        </View>
      )}

      <View style={styles.platformRow}>
        <PlatformMenu platforms={PLATFORMS} value={platform} onChange={setPlatform} />
      </View>

      <TextInput
        style={styles.searchInput}
        placeholder="Buscar por título o juego..."
        placeholderTextColor="#888"
        value={query}
        onChangeText={setQuery}
        onSubmitEditing={search}
        returnKeyType="search"
      />

      {loading ? (
        <ActivityIndicator style={styles.spinner} color="#fff" />
      ) : error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : (
        <FlatList
          data={files}
          keyExtractor={f => f.id}
          contentContainerStyle={styles.list}
          renderItem={({item}) => (
            <Pressable style={styles.fileRow} onPress={() => onSelectFile(item)}>
              <View style={styles.fileIconCircle}>
                <IconFile size={16} color="#cfe3fa" />
              </View>
              <View style={styles.fileInfo}>
                <Text style={styles.fileName} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={styles.fileMeta} numberOfLines={1}>
                  {item.gameTitle ?? item.originalName} · {(item.fileSize / 1024 / 1024).toFixed(1)} MB · por{' '}
                  {item.uploader}
                </Text>
              </View>
            </Pressable>
          )}
          ListEmptyComponent={
            <Text style={styles.empty}>
              No hay archivos compatibles (.gb/.gbc/.gba/.nds/.zip) para {PLATFORMS.find(p => p.slug === platform)?.label}.
            </Text>
          }
        />
      )}

      {downloading && (
        <View style={styles.busyOverlay}>
          <View style={styles.busyCard}>
            <ActivityIndicator size="large" color="#7ab8ff" />
            <Text style={styles.busyText}>Descargando…</Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#14151a', paddingTop: 16},
  header: {flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 8, gap: 12},
  backButton: {flexDirection: 'row', alignItems: 'center'},
  link: {color: '#7ab8ff', fontSize: 16},
  title: {color: '#fff', fontSize: 18, fontWeight: '700'},
  platformRow: {paddingHorizontal: 16, marginBottom: 8},
  searchInput: {
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: '#2a2a2a',
    color: '#fff',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  spinner: {marginTop: 24},
  errorText: {color: '#ff6b6b', paddingHorizontal: 16},
  list: {paddingHorizontal: 16, paddingBottom: 24},
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#1e2027',
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  fileIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#254a70',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileInfo: {flex: 1},
  fileName: {color: '#fff', fontSize: 14, fontWeight: '600'},
  fileMeta: {color: '#888', fontSize: 11, marginTop: 2},
  empty: {color: '#888', textAlign: 'center', marginTop: 32, paddingHorizontal: 24},
  busyOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(10,10,14,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
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
