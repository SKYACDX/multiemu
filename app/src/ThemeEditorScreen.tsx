import React, {useState} from 'react';
import {ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import {IconChevronLeft} from './icons';
import {
  ACTION_BUTTON_PRESETS,
  DPAD_PRESETS,
  PALETTE_SWATCHES,
  SHOULDER_BUTTON_PRESETS,
  Theme,
  ThemePalette,
} from './theme';
import ThemePreview from './ThemePreview';

interface Props {
  theme: Theme;
  authToken: string | null;
  busy: boolean;
  onClose: () => void;
  onSave: (theme: Theme) => void;
  onPublish: (theme: Theme) => void;
}

const PALETTE_FIELDS: {key: keyof ThemePalette; label: string}[] = [
  {key: 'shellBorder', label: 'Borde de la consola'},
  {key: 'shellBackground', label: 'Fondo de la consola'},
  {key: 'screenBezel', label: 'Marco de pantalla'},
  {key: 'dpadColor', label: 'Cruceta'},
  {key: 'actionButtonColor', label: 'Botones A/B/X/Y'},
  {key: 'shoulderButtonColor', label: 'Botones L/R'},
];

/**
 * Create/edit a Theme for the current system -- colors from a curated
 * swatch grid (not a full picker, no new dependency needed for v1) plus
 * a shape preset per control cluster (see theme.ts's *_PRESETS). Preview
 * reuses ThemePreview so what you see here is exactly GameControls'
 * real rendering, not a mockup.
 */
export default function ThemeEditorScreen({theme: initial, authToken, busy, onClose, onSave, onPublish}: Props) {
  const [theme, setTheme] = useState<Theme>(initial);

  const setPaletteColor = (key: keyof ThemePalette, color: string) => {
    setTheme(t => ({...t, palette: {...t.palette, [key]: color}}));
  };

  const handlePublish = () => {
    if (!authToken) {
      Alert.alert('Inicia sesión', 'Necesitas una cuenta de RomHack Hub para publicar un tema.');
      return;
    }
    if (!theme.name.trim()) {
      Alert.alert('Falta un nombre', 'Ponle un nombre al tema antes de publicarlo.');
      return;
    }
    onPublish(theme);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={onClose} hitSlop={8}>
          <IconChevronLeft size={20} />
          <Text style={styles.link}>Cerrar</Text>
        </Pressable>
        <Text style={styles.title}>Editar tema</Text>
      </View>

      <View style={styles.previewWrap}>
        <ThemePreview theme={theme} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.sectionLabel}>Nombre</Text>
        <TextInput
          style={styles.input}
          placeholder="Mi tema"
          placeholderTextColor="#888"
          value={theme.name}
          onChangeText={name => setTheme(t => ({...t, name}))}
        />

        {PALETTE_FIELDS.map(field => (
          <View key={field.key} style={styles.fieldBlock}>
            <Text style={styles.sectionLabel}>{field.label}</Text>
            <View style={styles.swatchRow}>
              {PALETTE_SWATCHES.map(color => (
                <Pressable
                  key={color}
                  style={[
                    styles.swatch,
                    {backgroundColor: color},
                    theme.palette[field.key] === color && styles.swatchSelected,
                  ]}
                  onPress={() => setPaletteColor(field.key, color)}
                />
              ))}
            </View>
          </View>
        ))}

        <View style={styles.fieldBlock}>
          <Text style={styles.sectionLabel}>Forma de la cruceta</Text>
          <View style={styles.presetRow}>
            {DPAD_PRESETS.map(preset => (
              <Pressable
                key={preset.id}
                style={[styles.presetChip, theme.presets.dpad === preset.id && styles.presetChipActive]}
                onPress={() => setTheme(t => ({...t, presets: {...t.presets, dpad: preset.id}}))}>
                <Text style={[styles.presetLabel, theme.presets.dpad === preset.id && styles.presetLabelActive]}>
                  {preset.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.fieldBlock}>
          <Text style={styles.sectionLabel}>Forma de A/B/X/Y</Text>
          <View style={styles.presetRow}>
            {ACTION_BUTTON_PRESETS.map(preset => (
              <Pressable
                key={preset.id}
                style={[styles.presetChip, theme.presets.actionButtons === preset.id && styles.presetChipActive]}
                onPress={() => setTheme(t => ({...t, presets: {...t.presets, actionButtons: preset.id}}))}>
                <Text
                  style={[styles.presetLabel, theme.presets.actionButtons === preset.id && styles.presetLabelActive]}>
                  {preset.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.fieldBlock}>
          <Text style={styles.sectionLabel}>Forma de L/R</Text>
          <View style={styles.presetRow}>
            {SHOULDER_BUTTON_PRESETS.map(preset => (
              <Pressable
                key={preset.id}
                style={[styles.presetChip, theme.presets.shoulderButtons === preset.id && styles.presetChipActive]}
                onPress={() => setTheme(t => ({...t, presets: {...t.presets, shoulderButtons: preset.id}}))}>
                <Text
                  style={[
                    styles.presetLabel,
                    theme.presets.shoulderButtons === preset.id && styles.presetLabelActive,
                  ]}>
                  {preset.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.actionsRow}>
          <Pressable style={styles.saveButton} onPress={() => onSave(theme)} disabled={busy}>
            <Text style={styles.saveLabel}>Guardar (solo en este dispositivo)</Text>
          </Pressable>
          <Pressable style={styles.publishButton} onPress={handlePublish} disabled={busy}>
            {busy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.publishLabel}>Publicar</Text>}
          </Pressable>
        </View>
        {!authToken && <Text style={styles.hint}>Inicia sesión para publicar tu tema y que otros lo descarguen.</Text>}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#14151a', paddingTop: 16},
  header: {flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 8, gap: 12},
  backButton: {flexDirection: 'row', alignItems: 'center'},
  link: {color: '#7ab8ff', fontSize: 16},
  title: {color: '#fff', fontSize: 18, fontWeight: '700'},
  previewWrap: {alignItems: 'center', paddingVertical: 12, backgroundColor: '#0f1014'},
  scroll: {padding: 16, paddingBottom: 32},
  sectionLabel: {color: '#aaa', fontSize: 12, fontWeight: '700', marginBottom: 8},
  fieldBlock: {marginTop: 18},
  input: {
    backgroundColor: '#2a2a2a',
    color: '#fff',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  swatchRow: {flexDirection: 'row', flexWrap: 'wrap', gap: 10},
  swatch: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#333',
  },
  swatchSelected: {borderColor: '#fff'},
  presetRow: {flexDirection: 'row', gap: 8, flexWrap: 'wrap'},
  presetChip: {paddingVertical: 8, paddingHorizontal: 14, borderRadius: 16, backgroundColor: '#242526'},
  presetChipActive: {backgroundColor: '#4a90d9'},
  presetLabel: {color: '#aaa', fontSize: 13},
  presetLabelActive: {color: '#fff', fontWeight: '700'},
  actionsRow: {marginTop: 28, gap: 10},
  saveButton: {
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#2f5f8f',
    alignItems: 'center',
  },
  saveLabel: {color: '#fff', fontWeight: '700', fontSize: 13},
  publishButton: {
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#4a90d9',
    alignItems: 'center',
  },
  publishLabel: {color: '#fff', fontWeight: '700', fontSize: 13},
  hint: {color: '#777', fontSize: 11, textAlign: 'center', marginTop: 10},
});
