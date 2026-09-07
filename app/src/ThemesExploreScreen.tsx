import React, {useCallback, useEffect, useState} from 'react';
import {ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View} from 'react-native';
import {listThemes} from './api/themes';
import {IconChevronLeft, IconCloud} from './icons';
import {ThemeSystem, Theme} from './theme';
import ThemePreview from './ThemePreview';

interface Props {
  system: ThemeSystem;
  onApply: (theme: Theme) => void;
  onClose: () => void;
}

/** Browses public themes for the current system (see docs/themes-api.md's GET /api/v1/themes). */
export default function ThemesExploreScreen({system, onApply, onClose}: Props) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'downloads' | 'newest'>('downloads');
  const [themes, setThemes] = useState<Theme[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const {themes: results} = await listThemes({system, q: query || undefined, sort, limit: 30});
      setThemes(results);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [system, query, sort]);

  useEffect(() => {
    search();
  }, [search]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={onClose} hitSlop={8}>
          <IconChevronLeft size={20} />
          <Text style={styles.link}>Cerrar</Text>
        </Pressable>
        <Text style={styles.title}>Explorar temas</Text>
      </View>

      <View style={styles.sortRow}>
        <Pressable style={[styles.sortChip, sort === 'downloads' && styles.sortChipActive]} onPress={() => setSort('downloads')}>
          <Text style={[styles.sortLabel, sort === 'downloads' && styles.sortLabelActive]}>Más descargados</Text>
        </Pressable>
        <Pressable style={[styles.sortChip, sort === 'newest' && styles.sortChipActive]} onPress={() => setSort('newest')}>
          <Text style={[styles.sortLabel, sort === 'newest' && styles.sortLabelActive]}>Nuevos</Text>
        </Pressable>
      </View>

      <TextInput
        style={styles.searchInput}
        placeholder="Buscar tema..."
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
          data={themes}
          keyExtractor={t => t.id ?? t.slug}
          contentContainerStyle={styles.list}
          renderItem={({item}) => (
            <View style={styles.card}>
              <ThemePreview theme={item} />
              <View style={styles.cardInfo}>
                <Text style={styles.themeName} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.themeMeta} numberOfLines={1}>
                  por {item.author ?? '?'} · {item.downloads ?? 0} descargas
                </Text>
                <Pressable style={styles.applyButton} onPress={() => onApply(item)}>
                  <IconCloud size={13} color="#a0ffe8" />
                  <Text style={styles.applyLabel}>Aplicar</Text>
                </Pressable>
              </View>
            </View>
          )}
          ListEmptyComponent={<Text style={styles.empty}>No hay temas públicos todavía para este sistema.</Text>}
        />
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
  sortRow: {flexDirection: 'row', paddingHorizontal: 16, gap: 8, marginBottom: 8},
  sortChip: {paddingVertical: 6, paddingHorizontal: 14, borderRadius: 16, backgroundColor: '#333'},
  sortChipActive: {backgroundColor: '#4a90d9'},
  sortLabel: {color: '#ccc', fontSize: 13},
  sortLabelActive: {color: '#fff', fontWeight: '700'},
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
  card: {
    flexDirection: 'row',
    gap: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#1e2027',
    marginBottom: 12,
    alignItems: 'center',
  },
  cardInfo: {flex: 1, gap: 6},
  themeName: {color: '#fff', fontSize: 15, fontWeight: '700'},
  themeMeta: {color: '#888', fontSize: 11},
  applyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    backgroundColor: '#1e5c4f',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    marginTop: 4,
  },
  applyLabel: {color: '#a0ffe8', fontSize: 11, fontWeight: '700'},
  empty: {color: '#888', textAlign: 'center', marginTop: 32, paddingHorizontal: 24},
});
