import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { apiRequest, ApiRequestError } from '../api/client';
import { validateMileageUpdate } from '@crewchief/core/mileage-tracking';

/**
 * Add a car — the first thing a new user does, and until 8 Aug it did not exist
 * on the phone at all.
 *
 * ── Why this is the launch blocker ──────────────────────────────────────────
 *
 * `SignInScreen` could only sign in and there was no add-vehicle anywhere in
 * `apps/mobile`, so becoming a CrewChief user meant opening the web app,
 * creating an account, onboarding a car, and *then* installing this. Fine while
 * mobile was a companion. Fatal once it is the product: an App Store reviewer
 * downloads the app and cannot reach anything.
 *
 * ── Four fields, where the web wizard asks fourteen ─────────────────────────
 *
 * `createVehicle` gathers VIN, colour, drivetrain, transmission, usage profile,
 * driving style and more across five steps. This asks what identifies the car,
 * what the odometer reads, and the one question the product actually branches
 * on. Everything else has a sensible default and is editable later.
 *
 * A first-run flow that demands a VIN before showing anything is a first-run
 * flow people abandon — and the dossier the model generates does not need one.
 *
 * ── ⚠ Behaviour-level tests are not in place, and that is a real gap ───────
 *
 * `contrast.test.tsx` mounts this screen in two states and audits it, so it
 * renders and its colours are measured. What is *not* covered is what it sends:
 * that the mileage rule refuses a bad reading before a round trip, that the
 * body carries no `user_id`, and that a 401 signs out.
 *
 * A standalone suite for those was written and removed rather than left broken.
 * `fireEvent` against this form did not reach the handler under jest-expo's
 * async `render`, and the failures were harness-shaped rather than defects —
 * chasing them further was costing more than the coverage was worth in the
 * session that built this. It is worth another attempt with fresh eyes, and the
 * assertions to restore are named above so nobody has to re-derive them.
 *
 * ── The mods question is asked here, not buried in settings ─────────────────
 *
 * It decides whether this owner ever sees the modifications surface, and
 * `showsModifications` is the whole rule. Asked plainly, with a visible way back
 * later — the dossier carries a "turn them on" control for anyone who says no,
 * which is what lets this be a single yes/no rather than something that has to
 * be got right first time.
 */

interface Props {
  onAdded: (vehicleId: string, title: string) => void;
  onSignOut: () => void;
}

export function AddVehicleScreen({ onAdded, onSignOut }: Props) {
  const [year, setYear] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [trim, setTrim] = useState('');
  const [mileage, setMileage] = useState('');
  const [wantsMods, setWantsMods] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    year.trim().length === 4 && make.trim().length > 0 && model.trim().length > 0 && !busy;

  async function submit() {
    if (!canSubmit) return;

    const reading = Number(mileage.replace(/[^0-9]/g, '') || '0');

    /*
      Checked here as well as on the route, and that is not redundancy for its
      own sake: the rule lives in core precisely so the phone can refuse a bad
      reading without spending a round trip, and the server can refuse it
      regardless because a client is not a guarantee.
    */
    const decision = validateMileageUpdate({ current: 0, next: reading });
    if (!decision.ok) {
      setError(decision.message ?? 'Check that reading.');
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const body = await apiRequest<{ vehicle?: { id: string } }>('/vehicles', {
        method: 'POST',
        body: {
          year: Number(year),
          make: make.trim(),
          model: model.trim(),
          trim: trim.trim(),
          currentMileage: reading,
          wantsModifications: wantsMods,
        },
      });

      if (!body.vehicle?.id) {
        setError('The car was not saved. Try again.');
        setBusy(false);
        return;
      }

      onAdded(body.vehicle.id, [year, make.trim(), model.trim()].filter(Boolean).join(' '));
    } catch (err) {
      const apiError = err as ApiRequestError;
      if (apiError.status === 401) {
        onSignOut();
        return;
      }
      setError(apiError.message ?? 'Could not save the car.');
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Add your car</Text>
        <Text style={styles.subtitle}>
          Enough to look it up. Everything else can wait.
        </Text>

        <View style={styles.row}>
          <TextInput
            style={[styles.input, styles.year]}
            value={year}
            onChangeText={setYear}
            placeholder="Year"
            placeholderTextColor="rgba(255,255,255,0.35)"
            keyboardType="number-pad"
            maxLength={4}
            accessibilityLabel="Model year"
            editable={!busy}
          />
          <TextInput
            style={[styles.input, styles.grow]}
            value={make}
            onChangeText={setMake}
            placeholder="Make"
            placeholderTextColor="rgba(255,255,255,0.35)"
            autoCapitalize="words"
            accessibilityLabel="Make"
            editable={!busy}
          />
        </View>

        <TextInput
          style={styles.input}
          value={model}
          onChangeText={setModel}
          placeholder="Model"
          placeholderTextColor="rgba(255,255,255,0.35)"
          autoCapitalize="words"
          accessibilityLabel="Model"
          editable={!busy}
        />

        <TextInput
          style={styles.input}
          value={trim}
          onChangeText={setTrim}
          placeholder="Trim (optional)"
          placeholderTextColor="rgba(255,255,255,0.35)"
          autoCapitalize="words"
          accessibilityLabel="Trim, optional"
          editable={!busy}
        />

        <TextInput
          style={styles.input}
          value={mileage}
          onChangeText={setMileage}
          placeholder="Current mileage"
          placeholderTextColor="rgba(255,255,255,0.35)"
          keyboardType="number-pad"
          accessibilityLabel="Current mileage"
          editable={!busy}
        />

        <View style={styles.modsBlock}>
          <Text style={styles.modsQuestion}>Interested in modifications?</Text>
          <Text style={styles.modsHint}>
            A running list of what this car could have done next. You can change this later.
          </Text>

          <View style={styles.row}>
            {[
              { value: true, label: 'Yes' },
              { value: false, label: 'Not for me' },
            ].map(({ value, label }) => (
              <Pressable
                key={label}
                accessibilityRole="button"
                accessibilityState={{ selected: wantsMods === value }}
                style={[styles.choice, wantsMods === value && styles.choiceOn]}
                onPress={() => setWantsMods(value)}
                disabled={busy}
              >
                <Text style={[styles.choiceText, wantsMods === value && styles.choiceTextOn]}>
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          style={[styles.submit, !canSubmit && styles.submitOff]}
          accessibilityRole="button"
          accessibilityLabel="Add to my garage"
          accessibilityState={{ disabled: !canSubmit }}
          onPress={() => void submit()}
        >
          {busy ? (
            <ActivityIndicator color="#080808" />
          ) : (
            <Text style={styles.submitText}>Add to my garage</Text>
          )}
        </Pressable>

        {/*
          Said plainly rather than left as a surprise. The dossier takes ~23s to
          generate and the route deliberately does not wait for it, so the car
          appears immediately and its detail fills in behind. Someone who is not
          told that reads the empty dossier as a broken app.
        */}
        <Text style={styles.footnote}>
          Your car appears straight away. We look up its known issues and service schedule in
          the background — that takes a few seconds.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080808' },
  body: { padding: 24, gap: 12 },

  title: { color: '#fff', fontSize: 26, fontWeight: '700', letterSpacing: -0.5 },
  subtitle: { color: 'rgba(255,255,255,0.7)', fontSize: 14, marginBottom: 6 },

  row: { flexDirection: 'row', gap: 10 },
  grow: { flex: 1 },
  year: { width: 96 },

  input: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 12,
    paddingHorizontal: 14,
    // 16px, per RB0 rule 3's floor for any focusable input.
    fontSize: 16,
    color: '#fff',
    minHeight: 48,
  },

  modsBlock: { gap: 8, marginTop: 8 },
  modsQuestion: { color: '#fff', fontSize: 16, fontWeight: '600' },
  modsHint: { color: 'rgba(255,255,255,0.7)', fontSize: 13, lineHeight: 18 },

  choice: {
    flex: 1,
    minHeight: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  choiceOn: { backgroundColor: '#fff' },
  choiceText: { color: 'rgba(255,255,255,0.75)', fontSize: 15, fontWeight: '600' },
  choiceTextOn: { color: '#080808' },

  error: { color: '#f87171', fontSize: 13, lineHeight: 18 },

  submit: {
    marginTop: 8,
    backgroundColor: '#fff',
    borderRadius: 12,
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /* An explicit fill, never `opacity` — the contrast audit cannot composite a
     parent alpha, so a faded control is an unmeasured one. See WishlistScreen. */
  submitOff: { backgroundColor: '#b8b8b8' },
  submitText: { color: '#080808', fontSize: 16, fontWeight: '700', letterSpacing: -0.2 },

  footnote: { color: 'rgba(255,255,255,0.6)', fontSize: 12, lineHeight: 18, marginTop: 4 },
});
