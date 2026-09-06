import React from 'react';
import {ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View} from 'react-native';
import {FolderFile} from './RomLibraryNative';
import {IconChevronLeft, IconFile} from './icons';

interface Props {
  folderName: string;
  files: FolderFile[];
  loading: boolean;
  /** A file from this list is being read/loaded into the emulator -- distinct from [loading] (listing the folder). */
  opening: boolean;
  onSelectFile: (file: FolderFile) => void;
  onClose: () => void;
}

/** Lists ROM files inside a folder the user picked (see HomeScreen's "Elegir carpeta"). */
export default function FolderScreen({folderName, files, loading, opening, onSelectFile, onClose}: Props) {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={onClose} hitSlop={8}>
          <IconChevronLeft size={20} />
          <Text style={styles.link}>Inicio</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {folderName}
        </Text>
      </View>

      {loading ? (
        <ActivityIndicator style={styles.spinner} color="#fff" />
      ) : (
        <FlatList
          data={files}
          keyExtractor={f => f.uri}
          contentContainerStyle={styles.list}
          renderItem={({item}) => (
            <Pressable style={styles.fileRow} onPress={() => onSelectFile(item)}>
              <View style={styles.fileIconCircle}>
                <IconFile size={16} color="#cfe3fa" />
              </View>
              <Text style={styles.fileName} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={styles.fileSize}>{(item.size / 1024 / 1024).toFixed(1)} MB</Text>
            </Pressable>
          )}
          ListEmptyComponent={
            <Text style={styles.empty}>No se encontraron ROMs (.gb/.gbc/.gba/.zip) en esta carpeta.</Text>
          }
        />
      )}

      {opening && (
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

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#14151a', paddingTop: 16},
  header: {flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 12, gap: 12},
  backButton: {flexDirection: 'row', alignItems: 'center'},
  link: {color: '#7ab8ff', fontSize: 16},
  title: {color: '#fff', fontSize: 18, fontWeight: '700', flexShrink: 1},
  spinner: {marginTop: 32},
  list: {paddingHorizontal: 16, paddingBottom: 24},
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
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
  fileName: {color: '#fff', fontSize: 15, flexShrink: 1, flexGrow: 1},
  fileSize: {color: '#888', fontSize: 12},
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
