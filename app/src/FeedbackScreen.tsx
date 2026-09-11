import React, {useState} from 'react';
import {ActivityIndicator, Image, Platform, Pressable, StyleSheet, Text, TextInput, View} from 'react-native';
import {IconChevronLeft} from './icons';
import {sendFeedback, uploadFeedbackScreenshot} from './api/romHackHubAccount';
import {ImagePickerCancelledError, ImageTooLargeError, PickedImage, pickImage} from './ImagePicker';
import {base64ToBytes} from './base64';

interface Props {
  authToken: string | null;
  appVersion: string;
  onClose: () => void;
}

/** See docs/feedback-api.md -- same form/endpoints the web uses, screenshot attachment included. */
export default function FeedbackScreen({authToken, appVersion, onClose}: Props) {
  const [body, setBody] = useState('');
  const [guestName, setGuestName] = useState('');
  const [image, setImage] = useState<PickedImage | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const handlePickImage = async () => {
    setError(null);
    try {
      setImage(await pickImage());
    } catch (e) {
      if (e instanceof ImagePickerCancelledError) return;
      if (e instanceof ImageTooLargeError) {
        setError('La imagen pesa más de 8MB, elige una más ligera.');
        return;
      }
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // Android-only app (see App.tsx's own Platform.OS check) -- these two
  // fields exist on Android's PlatformConstants but aren't in RN's
  // cross-platform type, hence the cast.
  const androidConstants = Platform.constants as {Manufacturer?: string; Model?: string};
  const deviceInfo = `${androidConstants.Manufacturer ?? ''} ${androidConstants.Model ?? ''}, Android ${Platform.Version}`.trim();

  const handleSend = async () => {
    if (!body.trim()) return;
    setSending(true);
    setError(null);
    try {
      let imageKey: string | undefined;
      if (image) {
        imageKey = await uploadFeedbackScreenshot(base64ToBytes(image.base64), image.name, image.mimeType, authToken ?? undefined);
      }
      await sendFeedback(
        {
          body: body.trim(),
          deviceInfo,
          appVersion,
          imageKey,
          guestName: authToken ? undefined : guestName.trim() || undefined,
        },
        authToken ?? undefined,
      );
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  if (sent) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Pressable style={styles.backButton} onPress={onClose} hitSlop={8}>
            <IconChevronLeft size={20} />
            <Text style={styles.link}>Cerrar</Text>
          </Pressable>
          <Text style={styles.title}>Comentarios</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>¡Gracias!</Text>
          <Text style={styles.hint}>Tu comentario fue enviado.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={onClose} hitSlop={8}>
          <IconChevronLeft size={20} />
          <Text style={styles.link}>Cerrar</Text>
        </Pressable>
        <Text style={styles.title}>Comentarios</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Reporta un problema o sugerencia</Text>
        <TextInput
          style={styles.textArea}
          placeholder="¿Qué pasó, o qué te gustaría ver?"
          placeholderTextColor="#777"
          value={body}
          onChangeText={setBody}
          multiline
          numberOfLines={6}
          maxLength={2000}
        />
        {!authToken && (
          <>
            <TextInput
              style={styles.input}
              placeholder="Tu nombre (opcional)"
              placeholderTextColor="#777"
              value={guestName}
              onChangeText={setGuestName}
              maxLength={60}
            />
            <Text style={styles.hint}>Inicia sesión en Cuenta para que le demos seguimiento a tu reporte.</Text>
          </>
        )}

        {image ? (
          <View style={styles.imagePreviewRow}>
            <Image source={{uri: `data:${image.mimeType};base64,${image.base64}`}} style={styles.imagePreview} />
            <Text style={styles.imageName} numberOfLines={1}>
              {image.name}
            </Text>
            <Pressable onPress={() => setImage(null)} hitSlop={8}>
              <Text style={styles.link}>Quitar</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable style={styles.attachButton} onPress={handlePickImage}>
            <Text style={styles.attachLabel}>Adjuntar captura de pantalla (opcional)</Text>
          </Pressable>
        )}

        {error && <Text style={styles.errorText}>{error}</Text>}
        <Pressable style={[styles.submitButton, !body.trim() && styles.submitButtonDisabled]} disabled={sending || !body.trim()} onPress={handleSend}>
          {sending ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitLabel}>Enviar</Text>}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#14151a', paddingTop: 16},
  header: {flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 16, gap: 12},
  backButton: {flexDirection: 'row', alignItems: 'center'},
  link: {color: '#7ab8ff', fontSize: 16},
  title: {color: '#fff', fontSize: 18, fontWeight: '700'},
  card: {
    marginHorizontal: 20,
    backgroundColor: '#1e2027',
    borderRadius: 16,
    padding: 20,
  },
  cardTitle: {color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 10},
  hint: {color: '#888', fontSize: 12, marginBottom: 16, lineHeight: 17},
  textArea: {
    backgroundColor: '#2a2a2a',
    color: '#fff',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
    minHeight: 120,
    textAlignVertical: 'top',
  },
  input: {
    backgroundColor: '#2a2a2a',
    color: '#fff',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
  },
  errorText: {color: '#ff6b6b', fontSize: 12, marginBottom: 10},
  attachButton: {
    backgroundColor: '#2a2a2a',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 10,
  },
  attachLabel: {color: '#7ab8ff', fontSize: 13, fontWeight: '600'},
  imagePreviewRow: {flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10},
  imagePreview: {width: 44, height: 44, borderRadius: 6, backgroundColor: '#2a2a2a'},
  imageName: {color: '#ccc', fontSize: 12, flex: 1},
  submitButton: {
    backgroundColor: '#2f5f8f',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  submitButtonDisabled: {opacity: 0.5},
  submitLabel: {color: '#fff', fontWeight: '700', fontSize: 14},
});
