import { useCallback, useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import AlertBanner from '../components/AlertBanner';
import Button from '../components/Button';
import Field from '../components/Field';
import Icon from '../components/Icon';
import ListGroup from '../components/ListGroup';
import { SkeletonCard } from '../components/Skeleton';
import { apiRequest, ApiRequestError } from '../api/client';
import { USAGE_PROFILES, type UsageProfile } from '@wellkept/core/usage-profile';
import {
  MINDEDNESS,
  MINDEDNESS_LABELS,
  OBJECTIVE_MAX,
  validateProfileUpdate,
  type Mindedness,
} from '@wellkept/core/vehicle-profile';
import { TARGET_MIN, border, brand, radius, space, surface, text, type } from '../theme';

/**
 * The four answers, editable.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * They were rendered read-only on the vehicle screen under "What you told us".
 * David, 23 Aug: *"why are we showing these details with no option to update?
 * all should be editable."*
 *
 * The reason they were not is worth keeping: **nothing in the product could
 * write them.** `PATCH /api/v1/vehicles` took `currentMileage` and nothing
 * else, so the screen displayed four values with no write path at any layer.
 * Showing a fact and refusing to let somebody correct it reads as the product
 * knowing better than the owner.
 *
 * ── ⚠ One of these turns a whole surface back on ────────────────────────────
 *
 * `performance_mindedness` gates the modifications surface — `showsModifications`
 * is false for `stock`, which hides the Build route entirely. `mod-progression.ts`
 * says that answer *"owes the owner a way to turn it back on"*, and until this
 * screen there was none: somebody who answered "not for me" during add-a-car
 * had made a permanent decision in sixty seconds.
 *
 * That is why this is a route rather than four inline edits. Changing it makes
 * a navigation row appear on the screen behind, and that deserves a deliberate
 * save rather than happening under a finger.
 *
 * ── Saved as a partial ──────────────────────────────────────────────────────
 *
 * Only fields that actually changed are sent. `validateProfileUpdate` treats
 * `undefined` as "leave it alone" and refuses an empty update outright, so a
 * body the server did not understand cannot come back as a cheerful 200.
 */

interface Props {
  vehicleId: string;
  onSignOut: () => void;
  /** Called after a successful save so the screen behind can refetch. */
  onSaved: () => void;
}

interface Answers {
  avgMilesPerMonth: string;
  vehicleStatus: UsageProfile | null;
  performanceMindedness: Mindedness | null;
  ownershipObjective: string;
}

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'loaded'; initial: Answers };

const USAGE_ORDER = Object.keys(USAGE_PROFILES) as UsageProfile[];

export function VehicleProfileScreen({ vehicleId, onSignOut, onSaved }: Props) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [answers, setAnswers] = useState<Answers | null>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState({ kind: 'loading' });

    try {
      const body = await apiRequest<{
        vehicle?: {
          avg_miles_per_month?: number | null;
          vehicle_status?: string | null;
          performance_mindedness?: string | null;
          ownership_objective?: string | null;
        };
      }>(`/load-vehicle?vehicleId=${encodeURIComponent(vehicleId)}`);

      const vehicle = body.vehicle ?? {};
      const initial: Answers = {
        avgMilesPerMonth:
          typeof vehicle.avg_miles_per_month === 'number' ? String(vehicle.avg_miles_per_month) : '',
        vehicleStatus:
          vehicle.vehicle_status && vehicle.vehicle_status in USAGE_PROFILES
            ? (vehicle.vehicle_status as UsageProfile)
            : null,
        performanceMindedness: (MINDEDNESS as readonly string[]).includes(
          vehicle.performance_mindedness ?? ''
        )
          ? (vehicle.performance_mindedness as Mindedness)
          : null,
        ownershipObjective: vehicle.ownership_objective ?? '',
      };

      setState({ kind: 'loaded', initial });
      setAnswers(initial);
    } catch (error) {
        /*
          ── ⚠ MOB-08 · a server 401 is not "you are signed out" ─────────────

          This forced a sign-out on **any** 401 and then `return`ed without
          setting a state — which is only safe if `onSignOut()` unmounts the
          screen, and it does not when the network call was the thing that
          failed. Result: offline with an expired token, this screen shows
          skeletons **forever** — no error, no retry, nothing to pull.

          `isLocallySignedOut` is the distinction the client already goes to
          trouble to make, with a docblock recording that a real tester hit this
          three times out of three on 5 Aug — and exactly **one** screen
          consumed it. A `device` 401 is genuinely signed out; a `server` 401
          may be a token the server would accept a second later, and destroying
          a working session over one response is how a spurious failure becomes
          a forced re-login.

          Falls through to the error state either way, so there is always
          something on screen and something to press.
        */
      if (error instanceof ApiRequestError && error.isLocallySignedOut) {
        onSignOut();
        return;
      }
      setState({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Could not load your answers',
      });
    }
  }, [vehicleId, onSignOut]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async () => {
    if (state.kind !== 'loaded' || !answers || saving) return;

    /*
      Only what moved. A PATCH carrying every field would rewrite three columns
      to their own values on every save — harmless today, and exactly the shape
      that makes an audit log useless later.
    */
    const changed: Record<string, unknown> = { vehicleId };
    if (answers.avgMilesPerMonth !== state.initial.avgMilesPerMonth) {
      changed.avgMilesPerMonth = Number(answers.avgMilesPerMonth.replace(/[^0-9]/g, '') || '0');
    }
    if (answers.vehicleStatus !== state.initial.vehicleStatus) {
      changed.vehicleStatus = answers.vehicleStatus;
    }
    if (answers.performanceMindedness !== state.initial.performanceMindedness) {
      changed.performanceMindedness = answers.performanceMindedness;
    }
    if (answers.ownershipObjective.trim() !== state.initial.ownershipObjective.trim()) {
      changed.ownershipObjective = answers.ownershipObjective;
    }

    /*
      Checked here as well as on the route, and that is the split this codebase
      already uses for mileage: the rule lives in core so the phone can refuse a
      bad value without a round trip, and the server refuses it regardless
      because a client is not a guarantee.
    */
    const { vehicleId: _id, ...fields } = changed;
    const decision = validateProfileUpdate(fields);

    if (!decision.ok) {
      // "Nothing to change" is not an error worth showing — it is a no-op.
      if (Object.keys(fields).length === 0) {
        onSaved();
        return;
      }
      setProblem(decision.message ?? 'Check those answers.');
      return;
    }

    setProblem(null);
    setSaving(true);

    try {
      await apiRequest('/vehicles', { method: 'PATCH', body: changed });
      onSaved();
    } catch (error) {
        /*
          ── ⚠ MOB-08 · a server 401 is not "you are signed out" ─────────────

          This forced a sign-out on **any** 401 and then `return`ed without
          setting a state — which is only safe if `onSignOut()` unmounts the
          screen, and it does not when the network call was the thing that
          failed. Result: offline with an expired token, this screen shows
          skeletons **forever** — no error, no retry, nothing to pull.

          `isLocallySignedOut` is the distinction the client already goes to
          trouble to make, with a docblock recording that a real tester hit this
          three times out of three on 5 Aug — and exactly **one** screen
          consumed it. A `device` 401 is genuinely signed out; a `server` 401
          may be a token the server would accept a second later, and destroying
          a working session over one response is how a spurious failure becomes
          a forced re-login.

          Falls through to the error state either way, so there is always
          something on screen and something to press.
        */
      if (error instanceof ApiRequestError && error.isLocallySignedOut) {
        onSignOut();
        return;
      }
      setProblem(error instanceof Error ? error.message : 'That could not be saved.');
    } finally {
      setSaving(false);
    }
  }, [state, answers, saving, vehicleId, onSaved, onSignOut]);

  if (state.kind === 'loading') {
    return (
      <ScrollView contentContainerStyle={styles.body}>
        <SkeletonCard lines={2} />
        <SkeletonCard lines={3} />
      </ScrollView>
    );
  }

  if (state.kind === 'error') {
    return (
      <View style={styles.centre}>
        <Text style={styles.errorTitle}>Could not load your answers</Text>
        <Text style={styles.errorBody}>{state.message}</Text>
        <Button label="Try again" variant="outline" onPress={() => void load()} />
      </View>
    );
  }

  if (!answers) return null;

  const set = <K extends keyof Answers>(key: K, value: Answers[K]) =>
    setAnswers((held) => (held ? { ...held, [key]: value } : held));

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {problem && <AlertBanner tone="critical" headline="Not saved" body={problem} />}

        <Text style={styles.lead}>
          These are the answers the dossier and the advisor are written against. Change them any
          time — they are what this car is for, not what it is.
        </Text>

        <Field
          label="Average per month"
          hint="miles"
          value={answers.avgMilesPerMonth}
          onChangeText={(next) => set('avgMilesPerMonth', next.replace(/[^0-9]/g, ''))}
          keyboardType="number-pad"
          editable={!saving}
        />

        <View style={styles.block}>
          <Text style={styles.question}>How do you use it?</Text>
          <View style={styles.choices}>
            {USAGE_ORDER.map((value) => (
              <Pressable
                key={value}
                onPress={() => set('vehicleStatus', value)}
                disabled={saving}
                accessibilityRole="button"
                accessibilityState={{ selected: answers.vehicleStatus === value }}
                accessibilityLabel={`Use: ${USAGE_PROFILES[value].label}`}
                style={[styles.choice, answers.vehicleStatus === value && styles.choiceOn]}
              >
                <Text
                  style={[
                    styles.choiceText,
                    answers.vehicleStatus === value && styles.choiceTextOn,
                  ]}
                >
                  {USAGE_PROFILES[value].label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.block}>
          <Text style={styles.question}>What do you want from it?</Text>
          {/*
            ⚠ This one turns a whole surface on and off. `stock` hides the Build
            route, and until this screen existed that was a permanent decision
            made in sixty seconds during add-a-car. The hint says so plainly
            rather than letting somebody discover it by losing a screen.
          */}
          <Text style={styles.hint}>
            “Keep it stock” hides the modifications side of the app. You can turn it back on here
            whenever you like.
          </Text>
          <View style={styles.choices}>
            {MINDEDNESS.map((value) => (
              <Pressable
                key={value}
                onPress={() => set('performanceMindedness', value)}
                disabled={saving}
                accessibilityRole="button"
                accessibilityState={{ selected: answers.performanceMindedness === value }}
                accessibilityLabel={`Goal: ${MINDEDNESS_LABELS[value]}`}
                style={[styles.choice, answers.performanceMindedness === value && styles.choiceOn]}
              >
                <Text
                  style={[
                    styles.choiceText,
                    answers.performanceMindedness === value && styles.choiceTextOn,
                  ]}
                >
                  {MINDEDNESS_LABELS[value]}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <Field
          label="What you want out of it"
          hint={`${answers.ownershipObjective.trim().length} / ${OBJECTIVE_MAX}`}
          value={answers.ownershipObjective}
          onChangeText={(next) => set('ownershipObjective', next)}
          multiline
          maxLength={OBJECTIVE_MAX}
          editable={!saving}
          style={styles.objective}
        />

        <Button label="Save" onPress={() => void save()} busy={saving} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: surface.page },
  body: { padding: space.lg, gap: space.lg, paddingBottom: space.h2 },
  centre: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.h1,
    gap: space.sm,
  },
  errorTitle: { ...type.title, color: text.primary },
  errorBody: { ...type.body, color: text.muted, textAlign: 'center' },

  lead: { ...type.body, color: text.secondary },
  block: { gap: space.sm },
  question: { ...type.bodyStrong, color: text.primary },
  hint: { ...type.value, color: text.muted, lineHeight: 19 },

  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  choice: {
    minHeight: TARGET_MIN,
    paddingHorizontal: space.md,
    justifyContent: 'center',
    borderRadius: radius.button,
    borderWidth: 1,
    borderColor: border.field,
    backgroundColor: surface.well,
  },
  /* An explicit fill, never an opacity — the contrast audit cannot composite one. */
  /*
    ⚠ The selected state is the brand fill, not white. It was `surface.inverse`
    until 23 Aug, which put a white fill on a screen whose primary button is
    cyan — the same two-filled-treatments conflict the retired `inverse` button
    variant caused, one control down. See `Button`'s docblock.
  */
  choiceOn: { backgroundColor: brand.primary, borderColor: brand.primary },
  choiceText: { ...type.uiStrong, color: text.secondary },
  choiceTextOn: { color: text.onPrimary },

  objective: { minHeight: 96, paddingTop: space.md, textAlignVertical: 'top' },
});
