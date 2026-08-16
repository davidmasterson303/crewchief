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

import Button from '../components/Button';
import Field from '../components/Field';
import { apiRequest, ApiRequestError } from '../api/client';
import { validateMileageUpdate } from '@crewchief/core/mileage-tracking';
import { radius, status, surface, text } from '../theme';
import {
  BASELINE_AGE_OPTIONS,
  type BaselineAge,
} from '@crewchief/core/onboarding-baseline';

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
 * ── A handful of fields, where the web wizard asks fourteen ─────────────────
 *
 * `createVehicle` gathers VIN, colour, drivetrain, transmission, usage profile,
 * driving style and more across five steps. This asks what identifies the car,
 * what the odometer reads, the one question the product actually branches on,
 * and — since Track A2a — one optional question about its history. Everything
 * else has a sensible default and is editable later.
 *
 * A first-run flow that demands a VIN before showing anything is a first-run
 * flow people abandon — and the dossier the model generates does not need one.
 *
 * ── The history question, and why it names the oil change ───────────────────
 *
 * A used car arrives with a past this product cannot see. Without a baseline,
 * every time-based service reports `unknown` and every mileage-based one counts
 * from the odometer rather than from the work.
 *
 * It asks about the **oil change** rather than "the last service" for a
 * mechanical reason as well as a human one: `categoryFor('service')` is `null`,
 * so a vague answer matches no scheduled item and the question would be pure
 * cost. `onboarding-baseline.ts` carries the full argument, including why every
 * "roughly when" answer resolves to the *oldest* end of its range.
 *
 * Both fields are optional and nothing gates on them. There is no skip button
 * precisely because there is nothing to skip — a button would imply a gate that
 * does not exist.
 *
 * ── Behaviour tests: the gap is closed ─────────────────────────────────────
 *
 * `AddVehicleScreen.test.tsx` covers what this screen *sends* — the mileage
 * rule refusing a bad reading before a round trip, the absence of a `user_id`
 * in the body, the mods answer, the A2a baseline fields, and a 401 signing out
 * where a 500 does not. `contrast.test.tsx` separately mounts it and measures
 * its colours.
 *
 * An earlier attempt was written and deleted rather than left broken, and the
 * reason is worth carrying — in its corrected form, because the note that
 * stood here until 15 Aug 2026 blamed the wrong thing. It said `fireEvent`
 * "does not work against this form and fails silently". What actually fails is
 * an **un-awaited** `fireEvent`: RNTL 14's `render`, `fireEvent` and
 * `userEvent` are all async, and dropping the `await` leaves React's act scope
 * open, which stops every later render in that file from committing. It cost
 * `contrast.test.tsx` a week of measuring nothing in green — `jest.setup.js`
 * carries the mechanism and now fails on it.
 *
 * **Use `userEvent` for every interaction in this app's screen tests, and
 * await it.** It is RNTL 14's async API for React 19's concurrent render and
 * it models a real press rather than a synthetic prop call.
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
  const [serviceMileage, setServiceMileage] = useState('');
  const [serviceAge, setServiceAge] = useState<BaselineAge | null>(null);
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
          /*
            Both optional and both independently useful — a mileage with no
            date still lets every mileage-based service count from it. `null`
            rather than 0 for an untouched field: 0 is a legitimate reading and
            the route must be able to tell them apart.
          */
          lastServiceMileage: serviceMileage.trim()
            ? Number(serviceMileage.replace(/[^0-9]/g, ''))
            : null,
          lastServiceAge: serviceAge,
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

        {/*
          `Field`, and the visible labels are the upgrade.

          This form asked for six values through placeholders alone, so every
          label vanished the moment someone typed — on the one screen a new user
          cannot skip. The accessible names are unchanged because the primitive
          takes the label it speaks, and `hint` now carries "optional" into that
          name rather than showing it only to people who can see it.

          The two-column row wraps each field rather than styling it: `Field`'s
          `style` reaches the input, and it is the **wrapper** that has to flex.
        */}
        <View style={styles.row}>
          <View style={styles.year}>
            <Field
              label="Model year"
              value={year}
              onChangeText={setYear}
              keyboardType="number-pad"
              maxLength={4}
              editable={!busy}
            />
          </View>
          <View style={styles.grow}>
            <Field
              label="Make"
              value={make}
              onChangeText={setMake}
              autoCapitalize="words"
              editable={!busy}
            />
          </View>
        </View>

        <Field
          label="Model"
          value={model}
          onChangeText={setModel}
          autoCapitalize="words"
          editable={!busy}
        />

        <Field
          label="Trim"
          hint="optional"
          value={trim}
          onChangeText={setTrim}
          autoCapitalize="words"
          editable={!busy}
        />

        <Field
          label="Current mileage"
          value={mileage}
          onChangeText={setMileage}
          keyboardType="number-pad"
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

        {/*
          Track A2a. One question, and it names the work rather than asking
          about "the last service" — see `onboarding-baseline.ts` for why
          "service" is unanswerable *and* unmatchable. Both fields are optional
          and the screen submits perfectly well with neither touched.
        */}
        <View style={styles.modsBlock}>
          <Text style={styles.modsQuestion}>When was its last oil change?</Text>
          <Text style={styles.modsHint}>
            Optional, and a rough answer is genuinely useful — it is what lets us
            count from the work rather than guess from the odometer.
          </Text>

          <Field
            label="Mileage at last oil change"
            hint="optional"
            value={serviceMileage}
            onChangeText={setServiceMileage}
            keyboardType="number-pad"
            editable={!busy}
          />

          <View style={styles.ageGrid}>
            {BASELINE_AGE_OPTIONS.map((option) => (
              <Pressable
                key={option.value}
                accessibilityRole="button"
                accessibilityState={{ selected: serviceAge === option.value }}
                style={[styles.age, serviceAge === option.value && styles.choiceOn]}
                onPress={() =>
                  setServiceAge((held) => (held === option.value ? null : option.value))
                }
                disabled={busy}
              >
                <Text
                  style={[styles.ageText, serviceAge === option.value && styles.choiceTextOn]}
                >
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </View>

          {/*
            The skip is a statement, not a control, and that is deliberate.
            Nothing here is required, so a "skip" button would imply the block
            above is a gate it is not — and the invoice scanner is reachable
            from the car itself the moment it exists, which is a better moment
            to offer it than before the car has been created.
          */}
          <Text style={styles.footnote}>
            Or leave this blank — you can scan your receipts later and we will read
            the dates off them.
          </Text>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {/*
          The inverse CTA from the primitive — the sixth and last private copy
          of a treatment four tokens existed for and no component owned.
        */}
        <Button
          label="Add to my garage"
          variant="inverse"
          onPress={() => void submit()}
          disabled={!canSubmit}
          busy={busy}
        />

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
  container: { flex: 1, backgroundColor: surface.page },
  body: { padding: 24, gap: 12 },

  title: { color: text.primary, fontSize: 26, fontWeight: '700', letterSpacing: -0.5 },
  subtitle: { color: text.secondary, fontSize: 14, marginBottom: 6 },

  row: { flexDirection: 'row', gap: 10 },
  grow: { flex: 1 },
  year: { width: 96 },


  modsBlock: { gap: 8, marginTop: 8 },
  modsQuestion: { color: text.primary, fontSize: 16, fontWeight: '600' },
  modsHint: { color: text.secondary, fontSize: 13, lineHeight: 18 },

  choice: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: surface.raised,
  },
  ageGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  age: {
    minHeight: 44,
    paddingHorizontal: 14,
    justifyContent: 'center',
    borderRadius: radius.button,
    backgroundColor: surface.raised,
  },
  ageText: { color: text.secondary, fontSize: 14, fontWeight: '600' },

  choiceOn: { backgroundColor: surface.inverse },
  choiceText: { color: text.secondary, fontSize: 15, fontWeight: '600' },
  choiceTextOn: { color: text.onInverse },

  error: { color: status.dangerText, fontSize: 13, lineHeight: 18 },

  /* An explicit fill, never `opacity` — the contrast audit cannot composite a
     parent alpha, so a faded control is an unmeasured one. See WishlistScreen. */

  footnote: { color: text.secondary, fontSize: 12, lineHeight: 18, marginTop: 4 },
});
