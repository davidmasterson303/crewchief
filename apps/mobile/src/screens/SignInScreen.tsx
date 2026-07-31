import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { signIn } from '../auth/session';

/**
 * Sign in.
 *
 * Email and password only — Phase 1's account layer, and deliberately still
 * only that. Adding Google or Facebook login triggers Apple's Sign in with
 * Apple requirement (4.8), which is a submission-scope decision and not one to
 * make by adding a button.
 */
export function SignInScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canSubmit = email.trim().length > 0 && password.length > 0 && !busy;

  async function handleSubmit() {
    if (!canSubmit) return;

    setBusy(true);
    setError(null);

    const result = await signIn(email, password);

    // No success branch: a successful sign-in fires onAuthStateChange, and the
    // root swaps this screen out. Setting state here would be a write to an
    // unmounted component.
    if (!result.ok) {
      setError(result.error ?? 'Could not sign in.');
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.form}>
        <Text style={styles.title}>CrewChief</Text>
        <Text style={styles.subtitle}>Sign in to your garage</Text>

        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          placeholder="Email"
          placeholderTextColor="rgba(255,255,255,0.3)"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="username"
          editable={!busy}
        />

        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          placeholder="Password"
          placeholderTextColor="rgba(255,255,255,0.3)"
          secureTextEntry
          autoCapitalize="none"
          // Lets the iOS keychain offer a saved password rather than
          // encouraging people to type one they will pick badly.
          textContentType="password"
          editable={!busy}
          onSubmitEditing={handleSubmit}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          style={[styles.button, !canSubmit && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={!canSubmit}
        >
          {busy ? (
            <ActivityIndicator color="#080808" />
          ) : (
            <Text style={styles.buttonText}>Sign in</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080808', justifyContent: 'center' },
  form: { padding: 28, gap: 14 },
  title: { color: '#fff', fontSize: 30, fontWeight: '700', letterSpacing: -0.5 },
  subtitle: { color: 'rgba(255,255,255,0.45)', fontSize: 15, marginBottom: 14 },
  input: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: '#fff',
    fontSize: 16,
  },
  error: { color: '#f87171', fontSize: 13 },
  button: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 6,
  },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: '#080808', fontSize: 16, fontWeight: '600' },
});
