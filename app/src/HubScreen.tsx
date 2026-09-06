import React, {useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {Hack, Patch, RomHackHubFile} from './api/romHackHub';
import RomLibraryScreen from './RomLibraryScreen';
import FilesScreen from './FilesScreen';
import {IconChevronLeft} from './icons';

type Tab = 'hacks' | 'files';

interface Props {
  initialTab: Tab;
  onSelectPatch: (hack: Hack, patch: Patch) => void;
  onSelectFile: (file: RomHackHubFile) => void;
  downloadingFile: boolean;
  onClose: () => void;
}

/** One screen, two tabs onto RomHack Hub's content: patches (HackRoms) and public files (Archivos). */
export default function HubScreen({initialTab, onSelectPatch, onSelectFile, downloadingFile, onClose}: Props) {
  const [tab, setTab] = useState<Tab>(initialTab);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={onClose} hitSlop={8}>
          <IconChevronLeft size={20} />
          <Text style={styles.link}>Cerrar</Text>
        </Pressable>
        <View style={styles.tabRow}>
          <Pressable style={[styles.tab, tab === 'hacks' && styles.tabActive]} onPress={() => setTab('hacks')}>
            <Text style={[styles.tabLabel, tab === 'hacks' && styles.tabLabelActive]}>HackRoms</Text>
          </Pressable>
          <Pressable style={[styles.tab, tab === 'files' && styles.tabActive]} onPress={() => setTab('files')}>
            <Text style={[styles.tabLabel, tab === 'files' && styles.tabLabelActive]}>Archivos</Text>
          </Pressable>
        </View>
      </View>

      {tab === 'hacks' ? (
        <RomLibraryScreen embedded onSelectPatch={onSelectPatch} onClose={onClose} />
      ) : (
        <FilesScreen embedded onSelectFile={onSelectFile} onClose={onClose} downloading={downloadingFile} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#14151a', paddingTop: 16},
  header: {paddingHorizontal: 16, marginBottom: 8, gap: 10},
  backButton: {flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start'},
  link: {color: '#7ab8ff', fontSize: 16},
  tabRow: {flexDirection: 'row', gap: 8},
  tab: {flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: '#242526', alignItems: 'center'},
  tabActive: {backgroundColor: '#2f5f8f'},
  tabLabel: {color: '#999', fontSize: 13, fontWeight: '600'},
  tabLabelActive: {color: '#fff', fontWeight: '700'},
});
