import { useMemo, useState } from 'react';
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
import { checkSharedCore } from '../core-check';

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

        <DevCoreCheck />
      </View>
    </KeyboardAvoidingView>
  );
}

/**
 * `checkSharedCore()` run where it can actually fail — on the device.
 *
 * ── Why it lives here and not on the garage ─────────────────────────────────
 *
 * It was orphaned when Phase 3.2's `GarageScreen` replaced the 3.1
 * `SignedInScreen` that used to render it, and it sat as dead code until
 * 5 Aug. This screen is the right home precisely because it is the one that
 * renders **before** a session exists: none of what core computes depends on
 * being signed in, so gating the probe behind sign-in would have made it
 * unrunnable exactly when a bundle is most broken.
 *
 * ── Why a summary line and not a list ───────────────────────────────────────
 *
 * A permanently-expanded panel of green rows is furniture — it stops being read
 * within a day, which is how the *previous* home stopped being noticed. One
 * line that says `4/4` is glanceable, and a failure is the only thing that
 * needs detail, so a failure expands itself and cannot be collapsed away.
 *
 * ── `__DEV__` only, same rule as `DevToken` ─────────────────────────────────
 *
 * A diagnostic, not a product surface. A release build compiles this out, and
 * `mobile-core-check-wired.test.ts` holds both that gate and the fact that this
 * is rendered at all — being deleted from the tree is how it became dead code
 * the first time.
 */
function DevCoreCheck() {
  /*
    Memoised because this component re-renders on **every keystroke** in the
    form above it, and the probe parses uuids through zod and formats numbers
    through Intl. Cheap individually, pointless repeatedly — and the answer
    cannot change without a new bundle, which remounts everything anyway.

    The hook runs before the `__DEV__` return so it is called unconditionally,
    which is the rule; `__DEV__` is a build constant, so the branch inside it
    costs nothing in a release build.
  */
  const checks = useMemo(() => (__DEV__ ? checkSharedCore() : []), []);

  if (!__DEV__) return null;

  const failed = checks.filter((check) => !check.ok);
  const ok = failed.length === 0;

  return (
    <View style={styles.devCheck}>
      <Text style={ok ? styles.devCheckOk : styles.devCheckFail}>
        Shared core {checks.length - failed.length}/{checks.length}
        {ok ? ' ok' : ' — FAILING'}
      </Text>

      {/*
        Only failures render their detail, and they render unconditionally.
        A check that has gone red is the entire reason this exists, so it must
        not be behind a tap that nobody thinks to make.
      */}
      {failed.map((check) => (
        <Text key={check.label} style={styles.devCheckDetail}>
          {check.label} — {check.detail}
        </Text>
      ))}
    </View>
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

  devCheck: { marginTop: 18, gap: 4 },
  /*
    Quiet when it passes — it is a diagnostic sitting under a product screen and
    should not compete with the sign-in button. #4ade80 and #f87171 both clear
    the AA floor on #080808 that `78eba74` made a rule.
  */
  devCheckOk: { color: 'rgba(255,255,255,0.35)', fontSize: 12, textAlign: 'center' },
  devCheckFail: { color: '#f87171', fontSize: 13, fontWeight: '700', textAlign: 'center' },
  devCheckDetail: { color: '#f87171', fontSize: 11, textAlign: 'center' },
});
