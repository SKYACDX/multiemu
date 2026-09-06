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
import {Hack, Patch, listHacks} from './api/romHackHub';

const PLATFORMS = [
  {slug: 'gb', label: 'Game Boy'},
  {slug: 'gbc', label: 'Game Boy Color'},
  {slug: 'gba', label: 'Game Boy Advance'},
];

interface Props {
  onSelectPatch: (hack: Hack, patch: Patch) => void;
  onClose: () => void;
}

/**
 * Browses RomHack Hub's public catalog (see src/api/romHackHub.ts) and
 * lets the user pick a patch to apply. It never handles ROMs -- only
 * patch metadata and, once picked, the patch bytes -- App.tsx is
 * responsible for supplying the user's own base ROM and running the
 * patcher.
 */
export default function RomLibraryScreen({onSelectPatch, onClose}: Props) {
  const [platform, setPlatform] = useState('gb');
  const [query, setQuery] = useState('');
  const [hacks, setHacks] = useState<Hack[]>([]);
  const [selectedHack, setSelectedHack] = useState<Hack | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const {hacks: results} = await listHacks({platform, q: query || undefined, limit: 30});
      setHacks(results);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [platform, query]);

  useEffect(() => {
    search();
  }, [search]);

  if (selectedHack) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={() => setSelectedHack(null)}>
            <Text style={styles.link}>{'‹ Volver'}</Text>
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>
            {selectedHack.title}
          </Text>
        </View>
        <Text style={styles.subtitle}>
          {selectedHack.game.title} · por {selectedHack.author}
        </Text>
        {selectedHack.description ? <Text style={styles.description}>{selectedHack.description}</Text> : null}
        <FlatList
          data={selectedHack.patches}
          keyExtractor={p => p.id}
          contentContainerStyle={styles.list}
          renderItem={({item}) => (
            <Pressable style={styles.patchRow} onPress={() => onSelectPatch(selectedHack, item)}>
              <Text style={styles.patchTitle}>
                v{item.version} · {item.formatLabel}
              </Text>
              <Text style={styles.patchMeta}>
                {item.originalName} · {(item.fileSize / 1024).toFixed(0)} KB
              </Text>
              {item.releaseNotes ? <Text style={styles.releaseNotes}>{item.releaseNotes}</Text> : null}
            </Pressable>
          )}
          ListEmptyComponent={<Text style={styles.empty}>Este HackRom no tiene parches publicados.</Text>}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={onClose}>
          <Text style={styles.link}>{'‹ Cerrar'}</Text>
        </Pressable>
        <Text style={styles.title}>HackRoms</Text>
      </View>

      <View style={styles.platformRow}>
        {PLATFORMS.map(p => (
          <Pressable
            key={p.slug}
            style={[styles.platformTab, platform === p.slug && styles.platformTabActive]}
            onPress={() => setPlatform(p.slug)}>
            <Text style={[styles.platformLabel, platform === p.slug && styles.platformLabelActive]}>
              {p.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <TextInput
        style={styles.searchInput}
        placeholder="Buscar por título..."
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
          data={hacks}
          keyExtractor={h => h.id}
          contentContainerStyle={styles.list}
          renderItem={({item}) => (
            <Pressable style={styles.hackRow} onPress={() => setSelectedHack(item)}>
              <Text style={styles.hackTitle}>{item.title}</Text>
              <Text style={styles.hackMeta}>
                {item.game.title} · {item.patches.length} parche(s) · por {item.author}
              </Text>
            </Pressable>
          )}
          ListEmptyComponent={
            <Text style={styles.empty}>
              No hay HackRoms publicados todavía para {PLATFORMS.find(p => p.slug === platform)?.label}.
            </Text>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#1a1a1a', paddingTop: 16},
  header: {flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 8, gap: 12},
  link: {color: '#7ab8ff', fontSize: 16},
  title: {color: '#fff', fontSize: 18, fontWeight: '700', flexShrink: 1},
  subtitle: {color: '#aaa', paddingHorizontal: 16, marginBottom: 8},
  description: {color: '#ccc', paddingHorizontal: 16, marginBottom: 8},
  platformRow: {flexDirection: 'row', paddingHorizontal: 16, gap: 8, marginBottom: 8},
  platformTab: {paddingVertical: 6, paddingHorizontal: 14, borderRadius: 16, backgroundColor: '#333'},
  platformTabActive: {backgroundColor: '#4a90d9'},
  platformLabel: {color: '#ccc', fontSize: 13},
  platformLabelActive: {color: '#fff', fontWeight: '700'},
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
  hackRow: {paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#333'},
  hackTitle: {color: '#fff', fontSize: 16, fontWeight: '600'},
  hackMeta: {color: '#999', fontSize: 13, marginTop: 2},
  patchRow: {paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#333'},
  patchTitle: {color: '#fff', fontSize: 15, fontWeight: '600'},
  patchMeta: {color: '#999', fontSize: 13, marginTop: 2},
  releaseNotes: {color: '#bbb', fontSize: 13, marginTop: 4, fontStyle: 'italic'},
  empty: {color: '#888', textAlign: 'center', marginTop: 32, paddingHorizontal: 24},
});
