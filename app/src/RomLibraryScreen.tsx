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
import {Game, Hack, Patch, listGames, listHacks} from './api/romHackHub';
import {IconChevronLeft} from './icons';
import PlatformMenu from './PlatformMenu';

const PLATFORMS = [
  {slug: 'gb', label: 'Game Boy'},
  {slug: 'gbc', label: 'Game Boy Color'},
  {slug: 'gba', label: 'Game Boy Advance'},
];

type Mode = 'games' | 'hacks';

interface Props {
  onSelectPatch: (hack: Hack, patch: Patch) => void;
  onClose: () => void;
  /** True when shown as a tab inside HubScreen, which already renders its own header/close button. */
  embedded?: boolean;
}

/**
 * Browses RomHack Hub's public catalog (see src/api/romHackHub.ts) and
 * lets the user pick a patch to apply. It never handles ROMs -- only
 * patch metadata and, once picked, the patch bytes -- App.tsx is
 * responsible for supplying the user's own base ROM and running the
 * patcher.
 *
 * Two ways in, both ending at the same hack -> patch list: browse by
 * game (the flow the API's own docs describe: platform -> games ->
 * hacks) or search hacks directly by title, for when you already know
 * the hack's name.
 */
export default function RomLibraryScreen({onSelectPatch, onClose, embedded}: Props) {
  const [mode, setMode] = useState<Mode>('games');
  const [platform, setPlatform] = useState('gb');
  const [query, setQuery] = useState('');
  const [games, setGames] = useState<Game[]>([]);
  const [selectedGame, setSelectedGame] = useState<Game | null>(null);
  const [hacks, setHacks] = useState<Hack[]>([]);
  const [selectedHack, setSelectedHack] = useState<Hack | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const searchGames = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const {games: results} = await listGames({platform, q: query || undefined, limit: 30});
      setGames(results);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [platform, query]);

  const searchHacks = useCallback(
    async (gameSlug?: string) => {
      setLoading(true);
      setError(null);
      try {
        const {hacks: results} = await listHacks({
          platform,
          game: gameSlug,
          q: gameSlug ? undefined : query || undefined,
          limit: 30,
        });
        setHacks(results);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [platform, query],
  );

  useEffect(() => {
    if (selectedHack) return;
    if (selectedGame) {
      searchHacks(selectedGame.slug);
    } else if (mode === 'games') {
      searchGames();
    } else {
      searchHacks();
    }
  }, [mode, selectedGame, selectedHack, searchGames, searchHacks]);

  // Patch list for a selected hack.
  if (selectedHack) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Pressable style={styles.backButton} onPress={() => setSelectedHack(null)} hitSlop={8}>
            <IconChevronLeft size={20} />
            <Text style={styles.link}>Volver</Text>
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

  // Hack list, either for a chosen game or a direct text search.
  if (selectedGame || mode === 'hacks') {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Pressable
            style={styles.backButton}
            onPress={() => (selectedGame ? setSelectedGame(null) : setMode('games'))}
            hitSlop={8}>
            <IconChevronLeft size={20} />
            <Text style={styles.link}>Volver</Text>
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>
            {selectedGame ? selectedGame.title : 'Buscar por nombre'}
          </Text>
        </View>

        {!selectedGame && (
          <TextInput
            style={styles.searchInput}
            placeholder="Buscar hacks por título..."
            placeholderTextColor="#888"
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => searchHacks()}
            returnKeyType="search"
          />
        )}

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
            ListEmptyComponent={<Text style={styles.empty}>No hay HackRoms publicados todavía aquí.</Text>}
          />
        )}
      </View>
    );
  }

  // Default: browse games for the selected platform.
  return (
    <View style={styles.container}>
      {!embedded && (
        <View style={styles.header}>
          <Pressable style={styles.backButton} onPress={onClose} hitSlop={8}>
            <IconChevronLeft size={20} />
            <Text style={styles.link}>Cerrar</Text>
          </Pressable>
          <Text style={styles.title}>HackRoms</Text>
        </View>
      )}

      <View style={styles.modeRow}>
        <Pressable style={[styles.modeTab, styles.modeTabActive]} onPress={() => {}}>
          <Text style={styles.modeLabelActive}>Por juego</Text>
        </Pressable>
        <Pressable style={styles.modeTab} onPress={() => setMode('hacks')}>
          <Text style={styles.modeLabel}>Buscar por nombre</Text>
        </Pressable>
      </View>

      <View style={styles.platformRow}>
        <PlatformMenu platforms={PLATFORMS} value={platform} onChange={setPlatform} />
      </View>

      <TextInput
        style={styles.searchInput}
        placeholder="Buscar juego..."
        placeholderTextColor="#888"
        value={query}
        onChangeText={setQuery}
        onSubmitEditing={searchGames}
        returnKeyType="search"
      />

      {loading ? (
        <ActivityIndicator style={styles.spinner} color="#fff" />
      ) : error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : (
        <FlatList
          data={games}
          keyExtractor={g => g.id}
          contentContainerStyle={styles.list}
          renderItem={({item}) => (
            <Pressable style={styles.hackRow} onPress={() => setSelectedGame(item)}>
              <Text style={styles.hackTitle}>{item.title}</Text>
              <Text style={styles.hackMeta}>{item.hackCount} hack(s) publicado(s)</Text>
            </Pressable>
          )}
          ListEmptyComponent={
            <Text style={styles.empty}>
              No hay juegos publicados todavía para {PLATFORMS.find(p => p.slug === platform)?.label}.
            </Text>
          }
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
  title: {color: '#fff', fontSize: 18, fontWeight: '700', flexShrink: 1},
  subtitle: {color: '#aaa', paddingHorizontal: 16, marginBottom: 8},
  description: {color: '#ccc', paddingHorizontal: 16, marginBottom: 8},
  modeRow: {flexDirection: 'row', paddingHorizontal: 16, gap: 8, marginBottom: 12},
  modeTab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#242526',
    alignItems: 'center',
  },
  modeTabActive: {backgroundColor: '#2f5f8f'},
  modeLabel: {color: '#999', fontSize: 13, fontWeight: '600'},
  modeLabelActive: {color: '#fff', fontSize: 13, fontWeight: '700'},
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
  hackRow: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#1e2027',
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  hackTitle: {color: '#fff', fontSize: 16, fontWeight: '600'},
  hackMeta: {color: '#999', fontSize: 13, marginTop: 2},
  patchRow: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#1e2027',
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  patchTitle: {color: '#fff', fontSize: 15, fontWeight: '600'},
  patchMeta: {color: '#999', fontSize: 13, marginTop: 2},
  releaseNotes: {color: '#bbb', fontSize: 13, marginTop: 4, fontStyle: 'italic'},
  empty: {color: '#888', textAlign: 'center', marginTop: 32, paddingHorizontal: 24},
});
