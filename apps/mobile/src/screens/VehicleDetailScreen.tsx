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
import AlertBanner from '../components/AlertBanner';
import Button from '../components/Button';
import Card from '../components/Card';
import ClusterGauge from '../components/ClusterGauge';
import ListRow from '../components/ListRow';
import SectionHeader from '../components/SectionHeader';
import { border, radius, space, status, surface, text, type } from '../theme';
import { getHealthBandJudgement } from '@crewchief/core/health-band';

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
  onOpenHistory,
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
  /** Track 5.6 follow-on: the phone could write service history and not read it. */
  onOpenHistory: () => void;
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
        <ActivityIndicator color={text.muted} />
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
        <Button
          label="Back to garage"
          variant="outline"
          onPress={onBack}
          style={styles.stateAction}
        />
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
        <Button
          label={state.unauthorized ? 'Sign in again' : 'Try again'}
          variant="outline"
          onPress={() => (state.unauthorized ? onSignOut() : void load())}
          style={styles.stateAction}
        />
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
          tintColor={text.muted}
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
        ── The recall, first and as a banner ──────────────────────────────────

        It was a card at the very bottom of the screen, under five rows of
        read-only detail. A recall is the one thing here that can be
        time-critical, and burying it under the mileage inverted the screen's
        priorities. `AlertBanner` is opaque and measured, which a wash over an
        unknown backdrop is not.
      */}
      {recalls > 0 && (
        <Pressable
          onPress={onViewRecalls}
          accessibilityRole="button"
          accessibilityLabel={`View ${recalls} open ${recalls === 1 ? 'recall' : 'recalls'}`}
        >
          <AlertBanner
            tone="critical"
            headline={`${recalls} open ${recalls === 1 ? 'recall' : 'recalls'}`}
            body="What it means, and what to do about it"
          />
        </Pressable>
      )}

      {score !== null && band && (
        <Card>
          <SectionHeader title="Health" />
          {/*
            The hero instrument — step 4.

            One dial per screen, and on vehicle detail this is it. `ClusterGauge`
            carries the canonical `label` rather than the garage row's `short`,
            because the module sets both deliberately and this screen has the
            width; and it sweeps at ignition, which the garage row does not — a
            column of three dials all sweeping at once reads as noise.
          */}
          <View style={styles.heroDial}>
            <ClusterGauge score={score} />
          </View>
          {health?.summary ? <Text style={styles.summary}>{health.summary}</Text> : null}
        </Card>
      )}

      <Card>
        <SectionHeader title="Details" />
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
      </Card>

      {/*
        ── Three destinations, as rows rather than as cards ───────────────────

        These were three full-width bordered cards, each with a title and a
        hint, stacked above the health summary — four boxes competing to be the
        thing you press, on a screen whose actual job is to tell you about a
        car. As rows they read as what they are: places to go.
      */}
      <Card>
        <SectionHeader title="This car" />
        <ListRow label="Service history" onPress={onOpenHistory} value="" />
        <ListRow label="Wishlist" detail="What it needs, so the advisor can price it" onPress={onOpenWishlist} value="" />
        <ListRow label="Scan an invoice" detail="Photograph a bill and its lines are filed here" onPress={onScanInvoice} value="" />
      </Card>

      {/*
        ── The one filled primary ─────────────────────────────────────────────

        The advisor is the verb this screen exists to lead to, and it is now the
        only filled control on it. Everything above is either information or a
        destination.

        It keeps its place near the bottom rather than the top: the earlier
        version put it first to answer guideline 4.2, but 4.2 is answered by the
        app *having* the flow, not by where the button sits — and a primary
        above the health summary asked the question before showing the reason
        to ask it.
      */}
      <Button label="Ask the advisor" onPress={onAskAdvisor} style={styles.primaryAction} />
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
  body: { padding: space.lg, gap: space.md },

  headerBlock: { gap: 2 },
  name: { ...type.editorial, fontSize: 26, lineHeight: 32, color: text.primary, letterSpacing: -0.5 },
  trim: { ...type.body, color: text.muted },

  /* The same real surface step the garage cards now use — not a 5% wash. */
  card: {
    backgroundColor: surface.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: border.panel,
    padding: space.lg,
    gap: space.sm,
  },
  cardLabel: {
    ...type.label,
    fontSize: 11,
    color: text.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },

  heroDial: { alignItems: 'center', paddingVertical: space.sm },
  summary: { ...type.body, fontSize: 14, lineHeight: 20, color: text.secondary },

  row: { flexDirection: 'row', justifyContent: 'space-between', gap: space.lg },
  rowLabel: { ...type.body, fontSize: 14, color: text.muted },
  rowValue: { ...type.body, fontSize: 14, color: text.primary, flexShrink: 1, textAlign: 'right' },

  recall: { ...type.bodyStrong, color: status.attention },

  /*
    ⚠ **The colours in the two CTAs below are deliberately NOT tokenised.**

    They are measured values with a history. The white fill was chosen over the
    brand cyan because `bg-cyan-600` was a known 3.68:1 and an open decision on
    the web board, and the dark ink sat at 4.47:1 — a hair under the floor —
    behind a shipped comment that claimed 8.6:1 and had measured white-on-white
    by mistake. The rendered-contrast suite caught it; 0.60 gives 5.35:1.

    Substituting a token here would re-open a question that cost real time to
    close, and no source scan can catch it because this is dark text on light.
    Structure moves onto the system; these four colours do not.
  */
  advisorCta: {
    backgroundColor: surface.inverse,
    borderRadius: radius.card,
    paddingVertical: space.lg,
    paddingHorizontal: space.lg,
    gap: 3,
  },
  advisorCtaText: { color: text.onInverse, fontSize: 16, fontWeight: '700', letterSpacing: -0.2 },
  advisorCtaHint: { color: text.onInverseMuted, fontSize: 13, lineHeight: 18 },

  /* Outlined rather than filled, so it reads as the second verb on the screen. */
  scanCta: {
    borderWidth: 1,
    borderColor: border.field,
    borderRadius: radius.card,
    paddingVertical: space.lg,
    paddingHorizontal: space.lg,
    gap: 3,
  },
  scanCtaText: { ...type.title, fontSize: 16, fontWeight: '700', color: text.primary, letterSpacing: -0.2 },
  scanCtaHint: { ...type.value, color: text.muted },

  centred: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.h1,
    gap: space.sm,
  },
  errorTitle: { ...type.title, color: text.primary },
  errorBody: { ...type.body, color: text.muted, textAlign: 'center' },
  stateAction: { marginTop: space.md, paddingHorizontal: space.xxl },
  /* Full-bleed: the one thing on the screen that is a commitment, not a link. */
  primaryAction: { alignSelf: 'stretch', marginTop: space.xs },
});
