import React, {useState} from 'react';
import {Modal, Pressable, StyleSheet, Text, View} from 'react-native';
import {IconMenu} from './icons';

export interface PlatformOption {
  slug: string;
  label: string;
}

interface Props {
  platforms: PlatformOption[];
  value: string;
  onChange: (slug: string) => void;
}

/**
 * Hamburger-menu replacement for a row of platform pills -- used by
 * FilesScreen and RomLibraryScreen, both of which used to lay every
 * platform out as its own always-visible Pressable. A dropdown reads
 * better once there are more than 3-4 platforms (NDS made FilesScreen's
 * row start wrapping/crowding), and scales to more without redesigning
 * the row again.
 */
export default function PlatformMenu({platforms, value, onChange}: Props) {
  const [open, setOpen] = useState(false);
  const current = platforms.find(p => p.slug === value);

  return (
    <>
      <Pressable style={styles.trigger} onPress={() => setOpen(true)}>
        <IconMenu size={15} />
        <Text style={styles.triggerLabel}>{current?.label ?? 'Plataforma'}</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <View style={styles.menu}>
            {platforms.map(p => (
              <Pressable
                key={p.slug}
                style={[styles.item, p.slug === value && styles.itemActive]}
                onPress={() => {
                  onChange(p.slug);
                  setOpen(false);
                }}>
                <Text style={[styles.itemLabel, p.slug === value && styles.itemLabelActive]}>{p.label}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: '#242526',
    alignSelf: 'flex-start',
  },
  triggerLabel: {color: '#fff', fontSize: 13, fontWeight: '700'},
  backdrop: {flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center'},
  menu: {backgroundColor: '#1e2027', borderRadius: 14, paddingVertical: 8, width: 240},
  item: {paddingVertical: 12, paddingHorizontal: 18},
  itemActive: {backgroundColor: '#2f5f8f'},
  itemLabel: {color: '#ccc', fontSize: 14},
  itemLabelActive: {color: '#fff', fontWeight: '700'},
});
