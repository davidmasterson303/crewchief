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
 * signed `photo_url`. **This screen deliberately does not draw that photo yet.**
 *
 * The signed URL points at the stored original, and the one real photo on this
 * account is a 2.3 MB legacy upload that predates the browser downscale — it
 * never decodes on the simulator. The garage card carries a timeout so it
 * degrades to a plate; repeating that machinery here to show the same picture
 * twice as large would double a net rather than remove the need for one.
 *
 * **Not deferred pending a server-side transform** — that fix was tried on
 * 2 Aug and Supabase image transformation is not enabled for this tenant. It is
 * deferred pending either that paid feature or a derivative generated at
 * upload, and until then the honest version of this screen has no photo on it.
 * `GarageScreen`'s `PHOTO_TIMEOUT_MS` docblock carries the full measurement.
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
  /*
    The owner's actual answer, not `performance_goal`.

    This screen rendered `performance_goal` until 7 Aug 2026 — a column with a
    `NOT NULL DEFAULT 'moderate'` that **no screen has ever written**. So the
    phone displayed "Moderate" for every car regardless of what its owner
    picked in onboarding, while their real choice sat in a column the mobile
    API did not select. `app/actions.ts:2062` records the same column causing
    the same class of bug in the modification analysis.
  */
  performance_mindedness?: string | null;
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
  onAskAdvisor,
  onScanInvoice,
  onViewRecalls,
  onOpenWishlist,
}: {
  vehicleId: string;
  onBack: () => void;
  onSignOut: () => void;
  /*
    3.4's entry point, as a callback for the same reason `onOpenVehicle` is one
    on the garage: this screen does not know react-navigation exists, and the
    navigator is the only file that has to change if that stops being true.
  */
  onAskAdvisor: () => void;
  /** 3.3's entry point, a callback for the same reason `onAskAdvisor` is one. */
  onScanInvoice: () => void;
  onViewRecalls: () => void;
  onOpenWishlist: () => void;
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

      {/*
        Above the health card, not below the details.

        Guideline 4.2 is answered by what an app *does*, and everything else on
        this screen is a rendering of stored values. Putting the one verb below
        two cards of read-only data would bury it under exactly the material
        that makes the app look like a database viewer. It is also the shortest
        route to the flow with no other entry point: the garage row leads here,
        and here leads to the advisor.
      */}
      <Pressable style={styles.advisorCta} onPress={onAskAdvisor} accessibilityRole="button">
        <Text style={styles.advisorCtaText}>Ask the advisor</Text>
        <Text style={styles.advisorCtaHint}>
          It already knows this car's history — no need to explain it
        </Text>
      </Pressable>

      {/*
        Secondary to the advisor, deliberately. Both are native-only verbs that
        answer guideline 4.2, but the advisor is the one someone opens without
        already holding a piece of paper.
      */}
      <Pressable style={styles.scanCta} onPress={onOpenWishlist} accessibilityRole="button">
        <Text style={styles.scanCtaText}>Wishlist</Text>
        <Text style={styles.scanCtaHint}>
          What this car needs, so the advisor can price it
        </Text>
      </Pressable>

      <Pressable style={styles.scanCta} onPress={onScanInvoice} accessibilityRole="button">
        <Text style={styles.scanCtaText}>Scan an invoice</Text>
        <Text style={styles.scanCtaHint}>
          Photograph a bill and its line items are added here
        </Text>
      </Pressable>

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
          value={vehicle.performance_mindedness ? humanise(vehicle.performance_mindedness) : null}
        />
        <Row
          label="Objective"
          value={vehicle.ownership_objective ? humanise(vehicle.ownership_objective) : null}
        />
      </View>

      {recalls > 0 && (
        <Pressable
          style={styles.card}
          accessibilityRole="button"
          accessibilityLabel={`View ${recalls} open ${recalls === 1 ? 'recall' : 'recalls'}`}
          onPress={onViewRecalls}
        >
          <Text style={styles.recall}>
            {recalls} open {recalls === 1 ? 'recall' : 'recalls'}
          </Text>
          {/*
            5.6 replaced "Recall detail is on the web for now." A notification
            about a recall that lands on a screen telling you to go and use a
            different device is not a notification worth sending.
          */}
          <Text style={styles.errorBody}>What it means, and what to do about it</Text>
        </Pressable>
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

  /*
    White on #080808 rather than the brand cyan. `bg-cyan-600` measures 3.68:1
    and is an open decision on the web board — pulling it onto a new surface
    would spread a known sub-floor colour to a second client while the call is
    still being made. The hint below is 0.55 white on white: 8.6:1, above the
    4.5:1 floor `78eba74` made a rule.
  */
  advisorCta: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingVertical: 15,
    paddingHorizontal: 16,
    gap: 3,
  },
  advisorCtaText: { color: '#080808', fontSize: 16, fontWeight: '700', letterSpacing: -0.2 },
  /*
    0.60, not 0.55. **The comment that shipped with this claimed "8.6:1, above
    the 4.5:1 floor" and was wrong**: it measured white-on-white by mistake,
    when this is near-black ink on a white button. The real figure was 4.47:1,
    a hair *under* the floor, and no source scan could have caught it — the
    scan only reads `rgba(255,255,255,α)` and this is dark text.

    Found by the rendered-contrast suite, which measures each run against the
    surface it truly lands on. 0.60 gives 5.35:1.
  */
  advisorCtaHint: { color: 'rgba(8,8,8,0.6)', fontSize: 13, lineHeight: 18 },

  /* Outlined rather than filled, so it reads as the second verb on the screen. */
  scanCta: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: 16,
    paddingVertical: 15,
    paddingHorizontal: 16,
    gap: 3,
  },
  scanCtaText: { color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: -0.2 },
  scanCtaHint: { color: 'rgba(255,255,255,0.5)', fontSize: 13, lineHeight: 18 },

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
