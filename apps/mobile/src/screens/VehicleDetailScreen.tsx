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
import { uploadVehiclePhoto } from '../api/photos';
import type { InvoiceFile } from '../api/documents';
import type { HealthDriver } from '@crewchief/core/health-drivers';
import { buildPosition } from '@crewchief/core/build-progress';
import { nextRungs, showsModifications } from '@crewchief/core/mod-progression';
import AlertBanner from '../components/AlertBanner';
import Button from '../components/Button';
import Card from '../components/Card';
import ClusterGauge from '../components/ClusterGauge';
import HealthDrivers from '../components/HealthDrivers';
import HealthHistory, { type HealthReading } from '../components/HealthHistory';
import BuildGauge from '../components/BuildGauge';
import ProgressionLadder from '../components/ProgressionLadder';
import Plinth from '../components/Plinth';
import VehiclePlate from '../components/VehiclePlate';
import ListRow from '../components/ListRow';
import SectionHeader from '../components/SectionHeader';
import { border, radius, space, status, surface, text, type } from '../theme';
import { getHealthBandJudgement } from '@crewchief/core/health-band';

/** The board's hero height for the photograph on this screen. */
const PHOTO_HERO = 196;

/**
 * Phase 3.2, second half — the detail behind a garage row.
 *
 * The list has existed since 1 Aug and its rows were not tappable, so this is
 * the half of 3.2 that was never built rather than a new idea.
 *
 * ── One request, and no photograph ──────────────────────────────────────────
 *
 * `GET /api/v1/load-vehicle?vehicleId=…` returns the vehicle, its knowledge
 * base, the computed health drivers and the score history in one round trip —
 * already stripped of `custom_image_url` and carrying a signed `photo_url`.
 *
 * ── The photograph, which this screen used to decline to draw ───────────────
 *
 * It did, and the reason was sound at the time: the signed URL points at the
 * stored original, the one real photo on this account is a 2.3 MB legacy upload
 * that never decodes on a device, and repeating the garage card's timeout
 * machinery here would have doubled a net rather than removed the need for one.
 *
 * All three parts of that changed on 15 Aug. The net is now **one component** —
 * `VehiclePlate` owns the timeout, the two exits from loading and the fallback,
 * so the hero reuses it rather than copying it. And the plate is no longer a
 * dead end: `/api/v1/upload-photo` means a car that falls back to it can be
 * given a picture from this screen.
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
  /**
   * The signed URL, resolved from `custom_image_url` by the route.
   *
   * ⚠ It has been on this payload since `2eb172a` — the roadmap listed it as a
   * missing API field on 15 Aug and it was already there. The screen simply
   * declared it and never drew it.
   */
  photo_url?: string | null;
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

/**
 * The slice of the knowledge base this screen reads.
 *
 * Deliberately not the whole dossier's type. `load-vehicle` returns
 * `vehicle_knowledge_base` with `select('*')`, and declaring every column here
 * would make the screen's contract a mirror of that table — the exact problem
 * `VEHICLE_COLUMNS` was written to stop on the route side.
 */
interface Knowledge {
  common_mods?: Array<{ name: string; purpose?: string; difficulty?: string }> | null;
}

type State =
  | { status: 'loading' }
  | {
      status: 'ok';
      vehicle: Vehicle;
      drivers: HealthDriver[];
      history: HealthReading[];
      knowledge: Knowledge | null;
    }
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
  pickPhoto,
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
  /**
   * The picker seam — this screen never imports `expo-image-picker`.
   *
   * Same reasoning as `GarageScreen` and `InvoiceScanScreen`: it is a native
   * module, a build that lacks it crashes on launch the moment anything in the
   * graph imports it, and taking it as a prop is what lets this screen mount in
   * a test. Omitted means the plate has no control rather than a broken one.
   */
  pickPhoto?: () => Promise<InvoiceFile | null>;
  /** Track 5.6 follow-on: the phone could write service history and not read it. */
  onOpenHistory: () => void;
}) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [refreshing, setRefreshing] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setState({ status: 'loading' });

      // A photo error does not survive a reload — `AlertBanner` is an alert
      // rather than a dialog, so refresh is what dismisses it.
      setPhotoError(null);

      try {
        /*
          `encodeURIComponent` on an id that is always a uuid today. It is not
          defensive clutter: the id arrives as a navigation param, and the day
          something else routes here with a value that is not a uuid, a raw
          interpolation is a query-string injection rather than a 400.
        */
        const body = await apiRequest<{
          vehicle?: Vehicle;
          health_drivers?: HealthDriver[];
          health_history?: HealthReading[];
          knowledge?: Knowledge | null;
        }>(`/load-vehicle?vehicleId=${encodeURIComponent(vehicleId)}`);
        if (!body.vehicle) {
          setState({ status: 'missing' });
          return;
        }
        /*
          `health_drivers` is top level rather than folded into `vehicle`,
          because they are derived and the vehicle object is the row — mixing
          them would let a caller believe it could write one back.

          Defaulted to empty rather than assumed present: a deployment where the
          route predates this field should render a health card without drivers,
          not a screen that throws.
        */
        setState({
          status: 'ok',
          vehicle: body.vehicle,
          drivers: Array.isArray(body.health_drivers) ? body.health_drivers : [],
          history: Array.isArray(body.health_history) ? body.health_history : [],
          knowledge: body.knowledge ?? null,
        });
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
    [vehicleId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Add or replace this car's photograph.
   *
   * The same three outcomes the garage handles, and the same rule about which
   * of them is an error: **dismissal is not one.** The picker resolving `null`
   * returns the screen to idle silently — showing "cancelled" after a
   * deliberate tap on Cancel is how an app feels accusatory.
   *
   * Reloads rather than patching `photo_url` in place. The upload returns a
   * signed URL and the payload carries one the server signed its own way;
   * writing one into state the next refresh overwrites is the disagreement that
   * reads as a photo flickering back to the plate.
   */
  const onAddPhoto = useCallback(async () => {
    if (!pickPhoto) return;
    setPhotoError(null);

    try {
      const file = await pickPhoto();
      if (!file) return;

      setUploading(true);
      await uploadVehiclePhoto(vehicleId, file);
      await load(true);
    } catch (error) {
      setPhotoError(error instanceof Error ? error.message : 'That photo could not be saved.');
    } finally {
      setUploading(false);
    }
  }, [pickPhoto, vehicleId, load]);

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
        <Text style={styles.errorBody}>It may have been removed from another device.</Text>
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

  const { vehicle, drivers, history, knowledge } = state;

  /*
    ── The build dial and the ladder, from the knowledge base ─────────────────

    ⚠ `completed` is empty, and it is empty **everywhere**: `modification_tracking`
    holds no rows across the entire product — re-confirmed against the live
    database on 15 Aug. So every car reads Stock with the ladder on its first
    rung, and that is the honest state rather than a placeholder.

    `mod-progression.ts` makes the same argument for the ladder: with no
    history, the first step genuinely is the first step. The dial says the same
    thing in glass — a needle at rest is a car nobody has recorded work on, not
    a car in poor condition, which is why it never borrows the health ramp.
  */
  const completed: string[] = [];
  const build = buildPosition([]);
  const rungs = showsModifications(vehicle.performance_mindedness)
    ? nextRungs({
        mods: Array.isArray(knowledge?.common_mods) ? knowledge.common_mods : [],
        completed,
        mindedness: vehicle.performance_mindedness,
      })
    : [];
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
      {/*
        The 196pt photo hero — no longer deferred.

        Three things changed on 15 Aug and all three were prerequisites:
        `photo_url` turned out to have been on this payload since `2eb172a`;
        `VehiclePlate` moved the timeout and the fallback into one component, so
        showing a photo here reuses that net rather than doubling it; and
        `/api/v1/upload-photo` means a car that lands on the plate can be given
        a picture from this screen instead of being stuck there.

        ⚠ It will show the plate on this account until the M235i's 2.3 MB
        original is replaced — that file has never decoded on a device. That is
        the fallback working, not the hero failing, and the control to fix it is
        on the plate itself.
      */}
      {photoError && (
        <AlertBanner tone="critical" headline="That photo was not saved" body={photoError} />
      )}

      <VehiclePlate
        photo={vehicle.photo_url}
        year={vehicle.year}
        make={vehicle.make}
        model={vehicle.model}
        trim={vehicle.trim}
        height={PHOTO_HERO}
        onAddPhoto={pickPhoto ? () => void onAddPhoto() : undefined}
        busy={uploading}
      />

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
          {/*
            The dial stands on a plinth rather than on the card.

            A 184pt instrument dropped straight onto a panel is a picture of an
            instrument. The slab is what makes it an object — and it is the
            other half of what was deferred out of step 3 with the bay, for the
            same reason: both are shaped by the dial, so building them around a
            placeholder meant building them twice.
          */}
          <Plinth>
            <ClusterGauge score={score} />
          </Plinth>
          {health?.summary ? <Text style={styles.summary}>{health.summary}</Text> : null}

          {/*
            The three score drivers — the endpoint gained them on 15 Aug.

            ⚠ Below the summary rather than beside the dial, and that placement
            is the honest one: they explain the subject without adding up to the
            reading above them. Putting three numbers next to a total invites
            arithmetic that does not hold — `health_score` comes from the model
            and these are computed from the schedule, the recall list and
            mileage against age.
          */}
          <HealthDrivers drivers={drivers} />

          {/*
            Score over time.

            ⚠ **Renders nothing on this account today**, and that is correct:
            there is one recorded reading for the real car and a chart needs
            two. The sweep writes one per vehicle per run, so it fills in on its
            own — which is why the plumbing is here rather than waiting for the
            data to exist first.
          */}
          <HealthHistory history={history} />
        </Card>
      )}

      {/*
        ── The build, and why it is a second card rather than a second dial ────

        The board's screen 03 names these as "the two instruments web has and
        mobile does not". They are siblings, not variants: the health gauge is
        hardwired to health semantics and **a low build reading is stock, not a
        fault** — reusing it would render an unmodified car as a critical
        failure and announce it as one.

        Shown only when the owner has not said "stock". `showsModifications` is
        the one genuine off switch, and it is "not now" rather than "never".
      */}
      {showsModifications(vehicle.performance_mindedness) && (
        <Card>
          <SectionHeader title="Build" />
          <View style={styles.buildDial}>
            <BuildGauge position={build} />
          </View>

          {/*
            The ladder answers the question the dial does not: why this next,
            and not the turbo. A recommendation with no visible reasoning is a
            black box, and this product's whole argument is that it is not one.
          */}
          {rungs.length > 0 && <ProgressionLadder next={rungs[0].role} />}
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
        <Row label="Use" value={vehicle.vehicle_status ? humanise(vehicle.vehicle_status) : null} />
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
        <ListRow
          label="Wishlist"
          detail="What it needs, so the advisor can price it"
          onPress={onOpenWishlist}
          value=""
        />
        <ListRow
          label="Scan an invoice"
          detail="Photograph a bill and its lines are filed here"
          onPress={onScanInvoice}
          value=""
        />
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
  name: {
    ...type.editorial,
    fontSize: 26,
    lineHeight: 32,
    color: text.primary,
    letterSpacing: -0.5,
  },
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

  buildDial: { alignItems: 'center' },
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
  scanCtaText: {
    ...type.title,
    fontSize: 16,
    fontWeight: '700',
    color: text.primary,
    letterSpacing: -0.2,
  },
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
