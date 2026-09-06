import React from 'react';
import {ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View} from 'react-native';
import {FolderFile} from './RomLibraryNative';
import {IconChevronLeft, IconFile} from './icons';

interface Props {
  folderName: string;
  files: FolderFile[];
  loading: boolean;
  onSelectFile: (file: FolderFile) => void;
  onClose: () => void;
}

/** Lists ROM files inside a folder the user picked (see HomeScreen's "Elegir carpeta"). */
export default function FolderScreen({folderName, files, loading, onSelectFile, onClose}: Props) {
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
              <IconFile size={18} color="#889" />
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#1a1a1a', paddingTop: 16},
  header: {flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 12, gap: 12},
  backButton: {flexDirection: 'row', alignItems: 'center'},
  link: {color: '#7ab8ff', fontSize: 16},
  title: {color: '#fff', fontSize: 18, fontWeight: '700', flexShrink: 1},
  spinner: {marginTop: 32},
  list: {paddingHorizontal: 16, paddingBottom: 24},
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  fileName: {color: '#fff', fontSize: 15, flexShrink: 1, flexGrow: 1},
  fileSize: {color: '#888', fontSize: 12},
  empty: {color: '#888', textAlign: 'center', marginTop: 32, paddingHorizontal: 24},
});
