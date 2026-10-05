import React, {useState} from 'react';
import {ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View} from 'react-native';
import {IconChevronLeft} from './icons';

interface Props {
  username: string | null;
  onLogin: (email: string, password: string, label: string) => Promise<{needsTotp: boolean}>;
  onVerifyTotp: (code: string) => Promise<void>;
  onLogout: () => void;
  onClose: () => void;
}

/**
 * Login (+2FA) for RomHack Hub's cloud save sync -- App.tsx owns the
 * actual session (token/username, persisted via RomLibraryNative), this
 * just renders whichever step is current. Device management/revocation
 * lives on the RomHack Hub website (/me/security), not here.
 */
export default function AccountScreen({username, onLogin, onVerifyTotp, onLogout, onClose}: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [awaitingTotp, setAwaitingTotp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      const {needsTotp} = await onLogin(email, password, 'multiemu Android');
      setAwaitingTotp(needsTotp);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    setLoading(true);
    setError(null);
    try {
      await onVerifyTotp(code);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={onClose} hitSlop={8}>
          <IconChevronLeft size={20} />
          <Text style={styles.link}>Cerrar</Text>
        </Pressable>
        <Text style={styles.title}>Cuenta</Text>
      </View>

      {username ? (
        <View style={styles.card}>
          <Text style={styles.connectedTitle}>Conectado como</Text>
          <Text style={styles.username}>{username}</Text>
          <Text style={styles.hint}>
            El guardado de tus juegos de GBA, DS y 3DS se sincroniza solo con la nube, y los estados se suben desde el menú del juego, en Guardado.
          </Text>
          <Pressable style={styles.logoutButton} onPress={onLogout}>
            <Text style={styles.logoutLabel}>Cerrar sesión</Text>
          </Pressable>
        </View>
      ) : awaitingTotp ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Verificación en dos pasos</Text>
          <Text style={styles.hint}>Ingresa el código de tu app de autenticación.</Text>
          <TextInput
            style={styles.input}
            placeholder="Código de 6 dígitos"
            placeholderTextColor="#777"
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            autoFocus
          />
          {error && <Text style={styles.errorText}>{error}</Text>}
          <Pressable style={styles.submitButton} onPress={handleVerify} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitLabel}>Verificar</Text>}
          </Pressable>
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Iniciar sesión en RomHack Hub</Text>
          <Text style={styles.hint}>Para sincronizar tus guardados de GBA, DS y 3DS entre dispositivos.</Text>
          <TextInput
            style={styles.input}
            placeholder="Correo"
            placeholderTextColor="#777"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <TextInput
            style={styles.input}
            placeholder="Contraseña"
            placeholderTextColor="#777"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
          {error && <Text style={styles.errorText}>{error}</Text>}
          <Pressable style={styles.submitButton} onPress={handleLogin} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitLabel}>Entrar</Text>}
          </Pressable>
        </View>
      )}
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
  cardTitle: {color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 6},
  connectedTitle: {color: '#888', fontSize: 12, fontWeight: '600', textTransform: 'uppercase'},
  username: {color: '#fff', fontSize: 20, fontWeight: '800', marginTop: 4, marginBottom: 12},
  hint: {color: '#888', fontSize: 12, marginBottom: 16, lineHeight: 17},
  input: {
    backgroundColor: '#2a2a2a',
    color: '#fff',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
  },
  errorText: {color: '#ff6b6b', fontSize: 12, marginBottom: 10},
  submitButton: {
    backgroundColor: '#2f5f8f',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  submitLabel: {color: '#fff', fontWeight: '700', fontSize: 14},
  logoutButton: {
    backgroundColor: '#4a2a2a',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  logoutLabel: {color: '#ffb3b3', fontWeight: '700', fontSize: 14},
});
