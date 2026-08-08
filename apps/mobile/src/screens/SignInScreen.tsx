import { useEffect, useMemo, useRef, useState } from 'react';
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

import { signIn, signUp } from '../auth/session';
import { hasDevCredentials, signInWithDevCredentials } from '../auth/dev-session';
import { checkSharedCore } from '../core-check';

/**
 * Sign in.
 *
 * Email and password only — Phase 1's account layer, and deliberately still
 * only that. Adding Google or Facebook login triggers Apple's Sign in with
 * Apple requirement (4.8), which is a submission-scope decision and not one to
 * make by adding a button.
 *
 * ── Sign-up lives here rather than on its own screen ────────────────────────
 *
 * Added 8 Aug, when the product went mobile-first. Until then this screen could
 * only sign in, so the only way to become a user was the web app — fatal for
 * something sold on the App Store, where a reviewer downloads the app and has
 * no route to the product.
 *
 * One form, two modes, because the fields are identical and the difference is a
 * verb. A separate screen would duplicate the inputs, the keyboard handling and
 * the error surface to change one label and one call.
 */
export function SignInScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'in' | 'up'>('in');

  const isNew = mode === 'up';
  const canSubmit = email.trim().length > 0 && password.length > 0 && !busy;

  async function handleSubmit() {
    if (!canSubmit) return;

    setBusy(true);
    setError(null);
    setNotice(null);

    const result = isNew ? await signUp(email, password) : await signIn(email, password);

    if (!result.ok) {
      setError(result.error ?? (isNew ? 'Could not create your account.' : 'Could not sign in.'));
      setBusy(false);
      return;
    }

    /*
      A successful sign-in — and a sign-up on a project with confirmation off —
      fires `onAuthStateChange` and the root swaps this screen out, so there is
      nothing to do and setting state would write to an unmounted component.

      Confirmation being *on* is the case that needs handling: the account
      exists, there is no session, and nothing swaps. Without this the screen
      sits there looking like the button did nothing.
    */
    if (isNew && 'needsConfirmation' in result && result.needsConfirmation) {
      setNotice('Account created. Check your email for a confirmation link, then sign in.');
      setMode('in');
      setPassword('');
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
        <Text style={styles.subtitle}>
          {isNew ? 'Create your garage' : 'Sign in to your garage'}
        </Text>

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
          /*
            `newPassword` on sign-up so the keychain offers to generate and save
            a strong one, rather than nudging someone to invent a weak one they
            will reuse. `password` on sign-in so it offers what is already
            saved, which is why this was here before sign-up existed.
          */
          textContentType={isNew ? 'newPassword' : 'password'}
          editable={!busy}
          onSubmitEditing={handleSubmit}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}

        <Pressable
          style={[styles.button, !canSubmit && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={!canSubmit}
        >
          {busy ? (
            <ActivityIndicator color="#080808" />
          ) : (
            <Text style={styles.buttonText}>{isNew ? 'Create account' : 'Sign in'}</Text>
          )}
        </Pressable>

        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setMode(isNew ? 'in' : 'up');
            setError(null);
            setNotice(null);
          }}
          disabled={busy}
          style={styles.switchMode}
        >
          <Text style={styles.switchModeText}>
            {isNew ? 'Already have an account? Sign in' : 'New here? Create an account'}
          </Text>
        </Pressable>

        <DevAutoSignIn />
        <DevCoreCheck />
      </View>
    </KeyboardAvoidingView>
  );
}

/**
 * Sign a development build in without anyone typing a password.
 *
 * ── Why it is automatic ─────────────────────────────────────────────────────
 *
 * A button would not help. The reason this exists is that automated retests
 * stall the moment the session lapses, and there is nobody there to tap — the
 * session died mid-test on 5 Aug and blocked a verification run outright.
 *
 * It runs **once per launch**, only in a dev build, and only when
 * `apps/mobile/.env` supplies credentials. Absent that file, nothing here does
 * anything and this screen is exactly what it always was.
 *
 * ── It is never silent ──────────────────────────────────────────────────────
 *
 * An app that signs itself in with no explanation is indistinguishable from one
 * that ignored a sign-out, so it says what it is doing and reports a failure
 * with the reason. A wrong password in `.env` and an unreachable auth server
 * look identical otherwise, and nobody is watching to tell them apart.
 *
 * To test the real sign-in form, remove the two variables from `.env`.
 */
function DevAutoSignIn() {
  const [note, setNote] = useState<string | null>(null);
  const attempted = useRef(false);

  useEffect(() => {
    if (!hasDevCredentials() || attempted.current) return;
    // A ref, not state: React 18 mounts effects twice in development, and a
    // second sign-in attempt races the first one's auth state change.
    attempted.current = true;

    setNote('Dev credentials found — signing in…');

    void signInWithDevCredentials().then((result) => {
      /*
        No success branch. A successful sign-in fires `onAuthStateChange` and
        the root swaps this screen out, so setting state here writes to an
        unmounted component — the same reason `handleSubmit` above has none.
      */
      if (result.status === 'failed') setNote(`Dev sign-in failed — ${result.error}`);
      if (result.status === 'unavailable') setNote(null);
    });
  }, []);

  if (!__DEV__ || !note) return null;

  return <Text style={styles.devCheckOk}>{note}</Text>;
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
  subtitle: { color: 'rgba(255,255,255,0.5)', fontSize: 15, marginBottom: 14 },
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
  /*
    An explicit fill, not `opacity` — the same defect the advisor's "Ask"
    button carried, on the first screen anyone sees.

    `opacity: 0.4` on a white button with a near-black label measures about
    1.85:1 against a 4.5 floor, and it is the state the screen *opens in*: the
    form is empty, so the button is disabled before a single keystroke. Nothing
    caught it because both contrast guards were blind — the source scan reads
    colour literals and sees none here, and no test mounts this screen at all.
    A render test now does.
  */
  buttonDisabled: { backgroundColor: '#b8b8b8' },
  notice: { color: '#7dd3a0', fontSize: 13, lineHeight: 18 },
  switchMode: { minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  switchModeText: { color: 'rgba(255,255,255,0.7)', fontSize: 14 },
  buttonText: { color: '#080808', fontSize: 16, fontWeight: '600' },

  devCheck: { marginTop: 18, gap: 4 },
  /*
    Quiet when it passes — it is a diagnostic sitting under a product screen and
    should not compete with the sign-in button. #4ade80 and #f87171 both clear
    the AA floor on #080808 that `78eba74` made a rule.
  */
  devCheckOk: { color: 'rgba(255,255,255,0.5)', fontSize: 12, textAlign: 'center' },
  devCheckFail: { color: '#f87171', fontSize: 13, fontWeight: '700', textAlign: 'center' },
  devCheckDetail: { color: '#f87171', fontSize: 11, textAlign: 'center' },
});
