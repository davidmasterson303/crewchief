import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { apiRequest, ApiRequestError } from '../api/client';
import { getHealthBandJudgement, healthBandHex } from '@crewchief/core/health-band';

/**
 * Phase 3.2, second half — the detail behind a garage row.
 *
 * The list has existed since 1 Aug and its rows were not tappable, so this is
 * the half of 3.2 that was never built rather than a new idea.
 *
 * ── One request, and no photograph ──────────────────────────────────────────
 *
 * `GET /api/v1/load-vehicle?vehicleId=…` returns the vehicle and its knowledge
 * base in one round trip, already stripped of `custom_image_url` and carrying a
 * signed `photo_url`. **This screen deliberately does not draw that photo.**
 * The garage card documents why at length: the signed URL points at the
 * original upload — 3000×4000, 2.3 MB on this account — which never decodes on
 * the simulator and costs a real phone 2.3 MB of someone's data allowance. The
 * card carries a timeout so it degrades to a plate. Repeating that machinery
 * here to show the same picture twice as large would double a known defect
 * rather than work around it. The photo belongs here once the server signs a
 * transformed URL; the row above already says so.
 *
 * ── States, and which ones are not errors ───────────────────────────────────
 *
 * Loading, loaded, and the two that get skipped. **401** is not an error box:
 * `App.tsx` swaps to sign-in the moment the session clears, so this reports it
 * plainly and calls `onSignOut`. **404** is its own state and not a crash — a
 * vehicle deleted on the web while this screen sat open is an ordinary race,
 * and the honest answer is that it is gone, with a way back.
 *
 * ── Why the shared health band, again ───────────────────────────────────────
 *
 * Same reasoning as the garage: `@crewchief/core/health-band` holds the
 * thresholds and the wording, the web dashboard reads it, and a local copy of
 * "80 is good" drifts silently. This screen and the row it came from must
 * agree, and the only way to guarantee that is to not have a second opinion.
 */

interface HealthSummary {
  health_score?: number | null;
  summary?: string | null;
  red_flags?: unknown[] | null;
}

interface Vehicle {
  id: string;
  year?: number | null;
  make?: string | null;
  model?: string | null;
  trim?: string | null;
  color?: string | null;
  current_mileage?: number | null;
  avg_miles_per_month?: number | null;
  vehicle_status?: string | null;
  performance_goal?: string | null;
  ownership_objective?: string | null;
  /* Both embedded shapes accepted, for the reason GarageScreen sets out. */
  vehicle_health_summary?: HealthSummary | HealthSummary[] | null;
  nhtsa_data?: { recalls?: unknown[] | null } | { recalls?: unknown[] | null }[] | null;
}

function first<T>(value: T | T[] | null | undefined): T | undefined {
  if (Array.isArray(value)) return value[0];
  return value ?? undefined;
}

const miles = new Intl.NumberFormat('en-US');

/** `daily_driver` → `Daily Driver`. Same reason as the garage: it shipped raw once. */
function humanise(value: string): string {
  return value
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

type State =
  | { status: 'loading' }
  | { status: 'ok'; vehicle: Vehicle }
  | { status: 'missing' }
  | { status: 'error'; message: string; unauthorized: boolean };

export function VehicleDetailScreen({
  vehicleId,
  onBack,
  onSignOut,
}: {
  vehicleId: string;
  onBack: () => void;
  onSignOut: () => void;
}) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setState({ status: 'loading' });

      try {
        /*
          `encodeURIComponent` on an id that is always a uuid today. It is not
          defensive clutter: the id arrives as a navigation param, and the day
          something else routes here with a value that is not a uuid, a raw
          interpolation is a query-string injection rather than a 400.
        */
        const body = await apiRequest<{ vehicle?: Vehicle }>(
          `/load-vehicle?vehicleId=${encodeURIComponent(vehicleId)}`
        );
        if (!body.vehicle) {
          setState({ status: 'missing' });
          return;
        }
        setState({ status: 'ok', vehicle: body.vehicle });
      } catch (error) {
        const apiError = error as ApiRequestError;
        // 404 is a state, not a failure — see the header.
        if (apiError.status === 404) {
          setState({ status: 'missing' });
          return;
        }
        setState({
          status: 'error',
          message: apiError.message,
          unauthorized: apiError.status === 401,
        });
      } finally {
        setRefreshing(false);
      }
    },
    [vehicleId]
  );

  useEffect(() => {
    void load();
  }, [load]);

  if (state.status === 'loading') {
    return (
      <View style={styles.centred}>
        <ActivityIndicator color="rgba(255,255,255,0.5)" />
      </View>
    );
  }

  if (state.status === 'missing') {
    return (
      <View style={styles.centred}>
        <Text style={styles.errorTitle}>This vehicle is no longer here</Text>
        <Text style={styles.errorBody}>
          It may have been removed from another device.
        </Text>
        <Pressable style={styles.button} onPress={onBack}>
          <Text style={styles.buttonText}>Back to garage</Text>
        </Pressable>
      </View>
    );
  }

  if (state.status === 'error') {
    return (
      <View style={styles.centred}>
        <Text style={styles.errorTitle}>
          {state.unauthorized ? 'Your session ended' : 'Could not load this vehicle'}
        </Text>
        <Text style={styles.errorBody}>{state.message}</Text>
        <Pressable
          style={styles.button}
          onPress={() => (state.unauthorized ? onSignOut() : void load())}
        >
          <Text style={styles.buttonText}>
            {state.unauthorized ? 'Sign in again' : 'Try again'}
          </Text>
        </Pressable>
      </View>
    );
  }

  const { vehicle } = state;
  const health = first(vehicle.vehicle_health_summary);
  const score = typeof health?.health_score === 'number' ? health.health_score : null;
  const band = score === null ? null : getHealthBandJudgement(score);
  const recalls = first(vehicle.nhtsa_data)?.recalls?.length ?? 0;

  return (
    <ScrollView
      contentContainerStyle={styles.body}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void load(true)}
          tintColor="rgba(255,255,255,0.5)"
        />
      }
    >
      <View style={styles.headerBlock}>
        <Text style={styles.name}>
          {[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ')}
        </Text>
        {(vehicle.trim || vehicle.color) && (
          <Text style={styles.trim}>
            {[vehicle.trim, vehicle.color].filter(Boolean).join(' · ')}
          </Text>
        )}
      </View>

      {score !== null && band && (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Health</Text>
          <View style={styles.scoreRow}>
            <Text style={[styles.score, { color: healthBandHex(band) }]}>{score}</Text>
            <Text style={[styles.bandLabel, { color: healthBandHex(band) }]}>
              {/*
                `label` here, `short` on the garage row. The module sets both
                deliberately and says `label` is canonical — the row abbreviates
                because it has a card's width, and this screen does not have to.
              */}
              {band.label}
            </Text>
          </View>
          {health?.summary ? <Text style={styles.summary}>{health.summary}</Text> : null}
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Details</Text>
        <Row
          label="Mileage"
          value={
            typeof vehicle.current_mileage === 'number'
              ? `${miles.format(vehicle.current_mileage)} mi`
              : null
          }
        />
        <Row
          label="Average per month"
          value={
            typeof vehicle.avg_miles_per_month === 'number'
              ? `${miles.format(vehicle.avg_miles_per_month)} mi`
              : null
          }
        />
        <Row
          label="Use"
          value={vehicle.vehicle_status ? humanise(vehicle.vehicle_status) : null}
        />
        <Row
          label="Goal"
          value={vehicle.performance_goal ? humanise(vehicle.performance_goal) : null}
        />
        <Row
          label="Objective"
          value={vehicle.ownership_objective ? humanise(vehicle.ownership_objective) : null}
        />
      </View>

      {recalls > 0 && (
        <View style={styles.card}>
          <Text style={styles.recall}>
            {recalls} open {recalls === 1 ? 'recall' : 'recalls'}
          </Text>
          <Text style={styles.errorBody}>
            Recall detail is on the web for now.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

/**
 * A missing value renders as an em dash rather than vanishing. A row that
 * disappears makes the screen look like it loaded a different car; a dash says
 * the field exists and is empty, which is the true statement.
 */
function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value ?? '—'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: 20, gap: 14 },

  headerBlock: { gap: 2 },
  name: { color: '#fff', fontSize: 26, fontWeight: '700', letterSpacing: -0.5 },
  trim: { color: 'rgba(255,255,255,0.5)', fontSize: 14 },

  card: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    padding: 16,
    gap: 10,
  },
  cardLabel: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },

  scoreRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  score: { fontSize: 34, fontWeight: '700', lineHeight: 36 },
  bandLabel: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  summary: { color: 'rgba(255,255,255,0.7)', fontSize: 14, lineHeight: 20 },

  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 16 },
  rowLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 14 },
  rowValue: { color: '#fff', fontSize: 14, flexShrink: 1, textAlign: 'right' },

  recall: { color: '#e0a468', fontSize: 15, fontWeight: '600' },

  centred: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 8 },
  errorTitle: { color: '#fff', fontSize: 17, fontWeight: '600' },
  errorBody: { color: 'rgba(255,255,255,0.5)', fontSize: 14, textAlign: 'center' },
  button: {
    marginTop: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: 9,
    paddingVertical: 11,
    paddingHorizontal: 22,
  },
  buttonText: { color: '#fff', fontSize: 14 },
});
