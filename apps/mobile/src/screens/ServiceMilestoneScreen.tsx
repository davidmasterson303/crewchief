import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { apiRequest, ApiRequestError } from '../api/client';
import {
  evaluateSchedule,
  milestoneReason,
  nextMilestone,
  type Milestone,
  type ScheduleEntry,
  type ServiceDue,
} from '@crewchief/core/service-due';
import {
  SCHEDULE_BASIS_LABELS,
  SERVICE_BASIS_LABELS,
  milestoneBasis,
} from '@crewchief/core/service-provenance';
import { validateMileageUpdate } from '@crewchief/core/mileage-tracking';
import { wishlistItemIdentifier } from '@crewchief/core/wishlist-identifier';

/**
 * Phase 5.6 — where a service-due notification lands.
 *
 * ── Confirm, then assert, with provenance. All three ────────────────────────
 *
 * David's decision, 7 Aug. The schedule comes from a model and the odometer is
 * user-reported, so the screen opens on **the mileage it is about to reason
 * from** rather than asserting a milestone over an unverified number. Confirm
 * or correct, then the answer.
 *
 * That ordering is not politeness. Every figure below is derived from the
 * reading, so a stale odometer does not make the screen slightly wrong — it
 * makes it confidently wrong, which is the failure mode a notification cannot
 * afford.
 *
 * ── Why the provenance label is not decoration ──────────────────────────────
 *
 * This app has shipped unsubstantiated provenance claims twice, and
 * `provenance-claims.test.ts` exists because of it. Every label here derives
 * from `evaluateSchedule`'s own `basedOnHistory` flag, and a milestone reports
 * as *estimated* unless every service in it came from records — mixed evidence
 * takes the weaker claim, because a reader takes "from your service records" as
 * covering the lot.
 *
 * ── What is deliberately not here ───────────────────────────────────────────
 *
 * Nothing books an appointment. The wishlist is the action: it is what the
 * advisor prices, and adding a job to it is the step that actually leads
 * somewhere in this product.
 */

interface Props {
  vehicleId: string;
  onSignOut: () => void;
}

/**
 * `knowledge` is a **top-level sibling of `vehicle`**, not nested inside it.
 *
 * `/api/v1/load-vehicle` runs two queries and returns `{ vehicle, knowledge }`;
 * `VEHICLE_COLUMNS` embeds `nhtsa_data` and `vehicle_health_summary` but not the
 * knowledge base. Reading `vehicle.vehicle_knowledge_base` — the shape the
 * embedded siblings would suggest — is always `undefined`, which here would
 * render "no structured service schedule yet" on every car forever, with no
 * error anywhere.
 */
interface VehicleResponse {
  vehicle?: {
    year?: number | null;
    make?: string | null;
    model?: string | null;
    current_mileage?: number | null;
  };
  knowledge?: { maintenance_schedule?: unknown } | null;
}

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; name: string; mileage: number; schedule: ScheduleEntry[] };

const miles = new Intl.NumberFormat('en-US');

export function ServiceMilestoneScreen({ vehicleId, onSignOut }: Props) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [confirmed, setConfirmed] = useState(false);
  const [reading, setReading] = useState('');
  const [saving, setSaving] = useState(false);
  const [added, setAdded] = useState<string[]>([]);

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const body = await apiRequest<VehicleResponse>(
        `/load-vehicle?vehicleId=${encodeURIComponent(vehicleId)}`
      );

      const vehicle = body.vehicle;
      const mileage = typeof vehicle?.current_mileage === 'number' ? vehicle.current_mileage : 0;
      const rawSchedule = body.knowledge?.maintenance_schedule;

      setState({
        kind: 'ready',
        name: [vehicle?.year, vehicle?.make, vehicle?.model].filter(Boolean).join(' ') || 'this car',
        mileage,
        schedule: Array.isArray(rawSchedule) ? (rawSchedule as ScheduleEntry[]) : [],
      });
      setReading(String(mileage));
    } catch (error) {
      const apiError = error as ApiRequestError;
      if (apiError.status === 401) {
        onSignOut();
        return;
      }
      setState({ kind: 'error', message: apiError.message ?? 'Could not load this car' });
    }
  }, [vehicleId, onSignOut]);

  useEffect(() => {
    void load();
  }, [load]);

  const confirm = useCallback(async () => {
    if (state.kind !== 'ready' || saving) return;

    const next = Number(reading.replace(/[^0-9]/g, ''));
    const decision = validateMileageUpdate({ current: state.mileage, next });

    if (!decision.ok) {
      /*
        The rule's own message, not one written here. It is phrased for the
        person who typed the number — "that is below the 60,000 already
        recorded. Correcting an earlier mistake?" — and rewording it at each
        call site is how two surfaces start explaining the same refusal
        differently.
      */
      Alert.alert('Check that reading', decision.message ?? 'That does not look right.');
      return;
    }

    // Unchanged is the common answer and costs nothing to skip.
    if (next === state.mileage) {
      setConfirmed(true);
      return;
    }

    setSaving(true);
    try {
      await apiRequest('/vehicles', {
        method: 'PATCH',
        body: { vehicleId, currentMileage: next },
      });
      setState({ ...state, mileage: next });
      setConfirmed(true);
    } catch (error) {
      const apiError = error as ApiRequestError;
      if (apiError.status === 401) {
        onSignOut();
        return;
      }
      Alert.alert('Could not save that', apiError.message ?? 'Try again in a moment.');
    } finally {
      setSaving(false);
    }
  }, [state, reading, saving, vehicleId, onSignOut]);

  const addToWishlist = useCallback(
    async (service: ServiceDue) => {
      try {
        await apiRequest('/wishlist', {
          method: 'POST',
          body: {
            vehicleId,
            itemType: 'maintenance',
            itemName: service.service,
            itemIdentifier: wishlistItemIdentifier('maintenance', service.service),
            description: service.description || null,
          },
        });
        setAdded((prev) => [...prev, service.service]);
      } catch (error) {
        const apiError = error as ApiRequestError;
        if (apiError.status === 401) {
          onSignOut();
          return;
        }
        // 409 means it is already there, which is the outcome the button wanted.
        if (apiError.status === 409) {
          setAdded((prev) => [...prev, service.service]);
          return;
        }
        Alert.alert('Could not add that', apiError.message ?? 'Try again in a moment.');
      }
    },
    [vehicleId, onSignOut]
  );

  if (state.kind === 'loading') {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color="rgba(255,255,255,0.6)" />
      </View>
    );
  }

  if (state.kind === 'error') {
    return (
      <View style={styles.centre}>
        <Text style={styles.errorTitle}>Could not load this car</Text>
        <Text style={styles.errorBody}>{state.message}</Text>
        <Pressable style={styles.button} onPress={() => void load()} accessibilityRole="button">
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  /*
    The mileage gate. Rendered before anything derived from the reading, because
    everything below is derived from the reading.
  */
  if (!confirmed) {
    return (
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.name}>{state.name}</Text>
        <Text style={styles.gateLead}>
          Still around {miles.format(state.mileage)} miles?
        </Text>
        <Text style={styles.gateBody}>
          What is due depends on the odometer, so it is worth a second before the answer.
        </Text>

        <TextInput
          style={styles.input}
          value={reading}
          onChangeText={setReading}
          keyboardType="number-pad"
          accessibilityLabel="Current mileage"
          returnKeyType="done"
          onSubmitEditing={() => void confirm()}
        />

        <Pressable
          style={styles.primaryCta}
          accessibilityRole="button"
          onPress={() => void confirm()}
        >
          <Text style={styles.primaryCtaText}>{saving ? 'Saving…' : 'That is right'}</Text>
        </Pressable>
      </ScrollView>
    );
  }

  const services = evaluateSchedule({ schedule: state.schedule, currentMileage: state.mileage });
  const milestone = nextMilestone(services, { horizonMiles: 5_000 });
  const unknowns = services.filter((service) => service.status === 'unknown');

  return (
    <ScrollView contentContainerStyle={styles.body}>
      <Text style={styles.name}>{state.name}</Text>
      <Text style={styles.mileageLine}>{miles.format(state.mileage)} miles</Text>

      {milestone ? (
        <MilestoneBlock
          milestone={milestone}
          currentMileage={state.mileage}
          added={added}
          onAdd={addToWishlist}
        />
      ) : (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Nothing due right now</Text>
          <Text style={styles.body14}>
            {services.length === 0
              ? 'This car has no structured service schedule yet, so nothing can be worked out from its mileage.'
              : 'The next service is far enough out that it is not worth a trip.'}
          </Text>
        </View>
      )}

      {/*
        Surfaced, not hidden. A time-based service with no recorded date cannot
        be placed on the odometer — and dropping it silently is how brake fluid
        went missing from every car in the product.
      */}
      {unknowns.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Timed by date, not mileage</Text>
          <Text style={styles.body14}>
            Nothing on record says when these were last done, so there is no due date to work
            out. Scanning the invoice would fix that.
          </Text>
          {unknowns.map((service) => (
            <Text key={service.service} style={styles.unknownItem}>
              · {service.service}
              {service.intervalMonths ? ` — every ${service.intervalMonths} months` : ''}
            </Text>
          ))}
        </View>
      )}

      <Text style={styles.footnote}>{SCHEDULE_BASIS_LABELS['generated-schedule']}</Text>
    </ScrollView>
  );
}

function MilestoneBlock({
  milestone,
  currentMileage,
  added,
  onAdd,
}: {
  milestone: Milestone;
  currentMileage: number;
  added: string[];
  onAdd: (service: ServiceDue) => void;
}) {
  const basis = milestoneBasis(milestone.services);

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>
        {milestone.mileage === null
          ? 'Next service'
          : `The ${miles.format(milestone.mileage)} service`}
      </Text>
      <Text style={styles.reason}>{milestoneReason(milestone, currentMileage)}</Text>

      {/*
        The provenance claim, derived rather than asserted. `milestoneBasis`
        reports the weaker of the two whenever the evidence is mixed.
      */}
      <Text style={styles.basis}>{SERVICE_BASIS_LABELS[basis]}</Text>

      {milestone.services.map((service) => {
        const isAdded = added.includes(service.service);

        return (
          <View key={service.service} style={styles.service}>
            <View style={styles.serviceHead}>
              <Text style={styles.serviceName}>{service.service}</Text>
              {service.status === 'overdue' && <Text style={styles.overdue}>Overdue</Text>}
            </View>

            {service.description ? (
              <Text style={styles.body14}>{service.description}</Text>
            ) : null}

            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: isAdded }}
              accessibilityLabel={
                isAdded
                  ? `${service.service} is on the wishlist`
                  : `Add ${service.service} to the wishlist`
              }
              style={[styles.addCta, isAdded && styles.addCtaDone]}
              onPress={() => !isAdded && onAdd(service)}
            >
              <Text style={[styles.addCtaText, isAdded && styles.addCtaDoneText]}>
                {isAdded ? 'On the wishlist' : 'Add to wishlist'}
              </Text>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: 20, gap: 14, paddingBottom: 40 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 10 },

  name: { color: '#fff', fontSize: 24, fontWeight: '700', letterSpacing: -0.5 },
  mileageLine: { color: 'rgba(255,255,255,0.5)', fontSize: 14, marginTop: -10 },

  gateLead: { color: '#fff', fontSize: 18, fontWeight: '600' },
  gateBody: { color: 'rgba(255,255,255,0.7)', fontSize: 14, lineHeight: 20 },
  input: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 16,
    color: '#fff',
    minHeight: 48,
  },

  primaryCta: {
    backgroundColor: '#fff',
    borderRadius: 12,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryCtaText: { color: '#080808', fontSize: 16, fontWeight: '700', letterSpacing: -0.2 },

  card: { backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 14, padding: 16, gap: 10 },
  cardTitle: { color: '#fff', fontSize: 17, fontWeight: '700', letterSpacing: -0.2 },
  reason: { color: 'rgba(255,255,255,0.7)', fontSize: 14, lineHeight: 20 },
  basis: { color: 'rgba(255,255,255,0.5)', fontSize: 12 },

  service: {
    gap: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  serviceHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  serviceName: { color: '#fff', fontSize: 15, fontWeight: '600', flexShrink: 1 },
  overdue: { color: '#e0a468', fontSize: 12, fontWeight: '700' },
  body14: { color: 'rgba(255,255,255,0.7)', fontSize: 14, lineHeight: 20 },

  addCta: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 10,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /* An explicit fill, never `opacity` — see WishlistScreen: the contrast audit
     cannot see a parent alpha, so a faded control is an unmeasured one. */
  addCtaDone: { backgroundColor: 'rgba(255,255,255,0.04)' },
  addCtaText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  addCtaDoneText: { color: 'rgba(255,255,255,0.6)' },

  unknownItem: { color: 'rgba(255,255,255,0.7)', fontSize: 14, lineHeight: 20 },
  footnote: { color: 'rgba(255,255,255,0.5)', fontSize: 12, lineHeight: 18 },

  errorTitle: { color: '#fff', fontSize: 17, fontWeight: '600' },
  errorBody: { color: 'rgba(255,255,255,0.5)', fontSize: 14, textAlign: 'center' },
  button: {
    marginTop: 6,
    paddingHorizontal: 18,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.1)',
    minHeight: 44,
    justifyContent: 'center',
  },
  buttonText: { color: '#fff', fontSize: 14 },
});
