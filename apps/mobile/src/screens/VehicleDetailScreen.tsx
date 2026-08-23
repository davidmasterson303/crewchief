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
import { Skeleton, SkeletonCard } from '../components/Skeleton';
import { uploadVehiclePhoto } from '../api/photos';
import type { InvoiceFile } from '../api/documents';
import type { HealthDriver } from '@crewchief/core/health-drivers';
import { buildPosition } from '@crewchief/core/build-progress';
import { showsModifications } from '@crewchief/core/mod-progression';
import { UNKNOWN_TIMING, describeNextService, localToday } from '@crewchief/core/garage-next-service';
import { normaliseRecalls } from '@crewchief/core/recalls';
import AlertBanner from '../components/AlertBanner';
import Button from '../components/Button';
import Card from '../components/Card';
import ClusterGauge, { CARD_SIZE } from '../components/ClusterGauge';
import { type HealthReading } from '../components/HealthHistory';
import Plinth from '../components/Plinth';
import VehiclePlate from '../components/VehiclePlate';
import NavRow from '../components/NavRow';
import SectionHeader from '../components/SectionHeader';
import { space, text, type } from '../theme';
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
  /**
   * The stored next-service columns, written by the nightly sweep.
   *
   * ⚠ These are **applied in the live database** and were simply not in
   * `VEHICLE_COLUMNS` until 23 Aug, so the schedule row rendered its unknown
   * branch on every car in the product. `GarageBay` still carried a docblock
   * saying the migration had not been applied. §1: verify against the artefact.
   *
   * Still optional at the type level, because the sweep has not written a row
   * for every car — an absent value is "we have not worked it out", which
   * `describeNextService` words rather than hides.
   */
  next_service_label?: string | null;
  next_service_at_miles?: number | null;
  next_service_due_on?: string | null;
  /**
   * Campaigns this owner has marked repaired, embedded by the route.
   *
   * ⚠ It rides on the vehicle rather than coming from `/api/v1/recalls`, and
   * that is a deliberate simplification of the first draft. A separate request
   * meant a fourth round trip **and** a fourth failure mode — a "could not
   * check the marks" state this screen had to word and could not avoid. The
   * embed costs nothing extra: `vehicle-detail-not-poorer.test.ts` requires
   * this route to ask for everything the garage list asks for, so the join was
   * already being paid for.
   */
  recall_actions?: Array<{ campaign_number?: string | null }> | null;
}

/**
 * The wishlist row: how many, and what they add up to.
 *
 * ⚠ **The total and the count must come from the same array**, and that is a
 * rule with a history — `specs/native-wishlist.spec.html` records this system
 * shipping "Wishlist · 4 items" over three rows, and says why it matters: *"a
 * count that disagrees with what is on screen is the fastest way to lose a
 * user's trust in every other number."*
 *
 * Parts and labour are summed because that is what the wishlist screen totals.
 * A row with neither contributes 0 to the money and 1 to the count, which is
 * honest: it is a real item whose price nobody has estimated yet.
 */
function summariseWishlist(
  items: Array<Record<string, unknown>> | undefined
): { count: number; total: number } | null {
  if (!Array.isArray(items)) return null;

  const money = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

  return {
    count: items.length,
    total: items.reduce(
      (sum, item) => sum + money(item.estimated_cost_parts) + money(item.estimated_cost_labor),
      0
    ),
  };
}

function first<T>(value: T | T[] | null | undefined): T | undefined {
  if (Array.isArray(value)) return value[0];
  return value ?? undefined;
}

const miles = new Intl.NumberFormat('en-US');

/**
 * Whole dollars, for the wishlist total on the hub row.
 *
 * No cents: these are estimates built from estimates, and rendering
 * "$4,980.00" against a number the product itself calls a range would be
 * inventing two digits of precision. `advice-range.ts` carries the standing
 * argument; this is the smallest place it applies.
 */
const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

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

/**
 * What the hub's rows say is behind them.
 *
 * ── ⚠ Every field is nullable, and `null` means "we could not ask" ──────────
 *
 * Not zero. `NavRow` renders nothing for a missing count and *something* for a
 * present one, and the difference is a claim: "Wishlist" with nothing beside it
 * is a place, "Wishlist 0" says the place is empty. A failed request must never
 * be able to make the second statement.
 *
 * The three come from three separate endpoints alongside the vehicle itself,
 * fetched with `allSettled`, so any one of them failing costs its own count and
 * nothing else. A hub that will not draw because a wishlist total timed out is
 * a worse screen than one with a row that does not carry a number.
 */
interface HubCounts {
  services: number | null;
  wishlist: { count: number; total: number } | null;
}

type State =
  | { status: 'loading' }
  | {
      status: 'ok';
      vehicle: Vehicle;
      drivers: HealthDriver[];
      history: HealthReading[];
      knowledge: Knowledge | null;
      counts: HubCounts;
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
  onOpenHealth,
  onOpenBuild,
  onOpenMilestone,
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
  /*
    ── The three routes this screen gained on 23 Aug ────────────────────────

    Callbacks, like every other destination here, for the reason the header
    gives: this screen does not know react-navigation exists.

    `onOpenHealth` and `onOpenBuild` are where two instruments went. They were
    cards on this screen — a dial with three drivers and a chart, and a second
    dial with a five-rung ladder — and between them they were most of why the
    IA read as cluttered. `onOpenMilestone` was already a route and simply had
    no way in from here; it took a notification to reach it.
  */
  onOpenHealth: () => void;
  onOpenBuild: () => void;
  onOpenMilestone: () => void;
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
        /*
          ── Four requests, one of which may fail the screen ──────────────────

          The vehicle is the screen. The other three fill in the numbers beside
          the hub's rows, and `allSettled` is what keeps them subordinate: a
          wishlist total that times out costs the wishlist row its count and
          nothing else. `all` would reject the set and blank a car because a
          count was slow, which is the inversion this screen exists to avoid.

          They run together rather than in sequence, so the wait is the slowest
          one rather than the sum of four.
        */
        const [vehicleResult, servicesResult, wishlistResult] = await Promise.allSettled([
          apiRequest<{
            vehicle?: Vehicle;
            health_drivers?: HealthDriver[];
            health_history?: HealthReading[];
            knowledge?: Knowledge | null;
          }>(`/load-vehicle?vehicleId=${encodeURIComponent(vehicleId)}`),
          apiRequest<{ maintenanceLineItems?: unknown[] }>(
            `/load-maintenance-data?vehicleId=${encodeURIComponent(vehicleId)}`
          ),
          apiRequest<{ wishlistItems?: Array<Record<string, unknown>> }>(
            `/wishlist?vehicleId=${encodeURIComponent(vehicleId)}`
          ),
        ]);

        if (vehicleResult.status === 'rejected') throw vehicleResult.reason;
        const body = vehicleResult.value;

        if (!body.vehicle) {
          setState({ status: 'missing' });
          return;
        }

        const counts: HubCounts = {
          services:
            servicesResult.status === 'fulfilled' &&
            Array.isArray(servicesResult.value.maintenanceLineItems)
              ? servicesResult.value.maintenanceLineItems.length
              : null,
          wishlist:
            wishlistResult.status === 'fulfilled'
              ? summariseWishlist(wishlistResult.value.wishlistItems)
              : null,
        };
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
          counts,
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
    /*
      Shaped like the dossier that is coming, not a centred dot.

      This is the densest screen in the app and the one a recall notification
      opens, so it is the most likely to be met cold. A hero block then two
      cards mirrors what resolves — the photo, the health card, the
      destinations — which is what stops the fill-in reading as a jump.
    */
    return (
      <ScrollView contentContainerStyle={styles.body}>
        <Skeleton height={196} />
        <SkeletonCard lines={3} />
        <SkeletonCard lines={2} />
      </ScrollView>
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

  const { vehicle, counts } = state;

  const health = first(vehicle.vehicle_health_summary);
  const score = typeof health?.health_score === 'number' ? health.health_score : null;
  const band = score === null ? null : getHealthBandJudgement(score);

  /*
    ── The identity line, which is where the odometer belongs ────────────────

    The spec writes it "61,240 mi · xDrive". Mileage first because it is the
    number an owner checks, and it spent this screen's whole life five rows down
    in a "Details" card under two instruments.
  */
  const subtitle = [
    typeof vehicle.current_mileage === 'number'
      ? `${miles.format(vehicle.current_mileage)} mi`
      : null,
    vehicle.trim,
    vehicle.vehicle_status ? humanise(vehicle.vehicle_status) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  /*
    ── Open recalls, which is not the same number as recalls ─────────────────

    A campaign the owner has marked repaired is no longer counted here, and that
    is the point of the whole recall change: a badge that can never go down
    stops being read.

    ⚠ A missing or malformed `recall_actions` embed means **nothing is treated
    as marked**. Erring the other way would hide an open safety notice on the
    strength of a field that failed to arrive.
  */
  const allRecalls = normaliseRecalls(first(vehicle.nhtsa_data)?.recalls);
  const marked = new Set(
    (vehicle.recall_actions ?? []).flatMap((action) =>
      typeof action?.campaign_number === 'string' ? [action.campaign_number] : []
    )
  );
  const open = allRecalls.filter(
    (recall) => !recall.campaignNumber || !marked.has(recall.campaignNumber)
  );
  const openRecalls = open.length;

  /*
    The banner names the defect rather than describing itself.

    The spec's line is "One is a fuel pump that can cut power" — a banner that
    says "what it means, and what to do about it" is furniture, and one that
    names the worst open component is information. `component` is NHTSA's own
    short field; the summary would be a paragraph.
  */
  const worstRecall = open[0]?.component
    ? openRecalls === 1
      ? `${open[0].component}. Free to fix at a franchised dealer.`
      : `Worst: ${open[0].component}. Free to fix at a franchised dealer.`
    : null;

  /*
    ── Next service ──────────────────────────────────────────────────────────

    ⚠ The three `next_service_*` columns reached this payload on 23 Aug, and the
    reason they were absent is worth carrying: they were **applied in the
    database and missing from the route's column list**, so every car in the
    product rendered the honest-unknown branch. `GarageBay`'s docblock said the
    migration had not been applied; the live database said otherwise. §1.

    `describeNextService` is shared with the garage bay so the two cannot word
    the same schedule differently, and `localToday()` is read at render rather
    than held — "overdue since" and "due now" turn on exactly one day.
  */
  const nextService = describeNextService(
    {
      label: vehicle.next_service_label ?? null,
      atMiles: vehicle.next_service_at_miles ?? null,
      dueOn: vehicle.next_service_due_on ?? null,
    },
    vehicle.current_mileage ?? null,
    localToday()
  );

  /*
    ⚠ `completed` is empty and it is empty everywhere — `modification_tracking`
    holds no rows across the product, re-confirmed against the live database on
    23 Aug. So every car reads Stock. That is the honest state, and `BuildScreen`
    is where it is explained rather than merely displayed.
  */
  const buildLabel = buildPosition([]).label;

  /*
    ── What each row says is behind it ───────────────────────────────────────

    ⚠ `null` where the count could not be fetched, and `NavRow` renders nothing
    for it. Never "0": a row reading "Wishlist 0" claims the list is empty,
    which is a statement a failed request has not earned. See `HubCounts`.
  */
  const serviceDue =
    nextService.kind === 'known' ? `${nextService.service} · ${nextService.timing}` : UNKNOWN_TIMING;

  const historyCount =
    counts.services === null ? null : `${counts.services}`;

  const wishlistCount =
    counts.wishlist === null
      ? null
      : counts.wishlist.total > 0
        ? `${counts.wishlist.count} · ${money.format(counts.wishlist.total)}`
        : `${counts.wishlist.count}`;

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
        {/*
          ⚠ The spec's subtitle: **"61,240 mi · xDrive"** — the odometer first.

          Mileage used to live five rows down in a "Details" card, which put the
          single most-checked number about a car below two instruments and a
          list of links. It is identity, not detail: it is how an owner knows
          which car they are looking at and roughly what state it is in.
        */}
        {subtitle ? <Text style={styles.trim}>{subtitle}</Text> : null}
      </View>

      {/*
        ── The reading, and one way in to the account of it ────────────────────

        The 104pt **card** dial, not the hero. The board is explicit — *"Hero ·
        184pt … Garage bay and nothing else — one dial per screen"* — and a
        second hero here plus a sweep pushed everything this screen exists to
        lead to below the fold.

        What left this card on 23 Aug: the three drivers and the history chart.
        They are the *account* of the score rather than the score, they need
        room to explain themselves, and they were two of the reasons this screen
        read as a stack of instruments. `HealthScreen` is one tap down.
      */}
      {score !== null && band && (
        <Card>
          <Plinth>
            <ClusterGauge score={score} variant="card" size={CARD_SIZE} />
          </Plinth>
          {health?.summary ? <Text style={styles.summary}>{health.summary}</Text> : null}
          <NavRow label="What is driving this score" onPress={onOpenHealth} last />
        </Card>
      )}

      {/*
        ── The recall ─────────────────────────────────────────────────────────

        ⚠ **Below the dial, which is the design system's order and not the one
        that shipped.** `specs/native-vehicle-detail.spec.html` reads score,
        then "2 open recalls", then the hub. The shipped screen put it first on
        the argument that a recall is the one time-critical thing here — a good
        argument, and it is above the fold either way, so this follows the spec
        and the disagreement is written down for Design rather than settled
        unilaterally. See `docs/design-system-drift.md`.

        The body names the **worst open recall** instead of saying "what it
        means, and what to do about it". The spec's own line is *"One is a fuel
        pump that can cut power"*, and it is right: a banner that describes
        itself is furniture, and a banner that names the defect is information.
      */}
      {openRecalls > 0 && (
        <Pressable
          onPress={onViewRecalls}
          accessibilityRole="button"
          accessibilityLabel={`View ${openRecalls} open ${openRecalls === 1 ? 'recall' : 'recalls'}`}
        >
          <AlertBanner
            tone="critical"
            headline={`${openRecalls} open ${openRecalls === 1 ? 'recall' : 'recalls'}`}
            body={worstRecall ?? 'Free to fix at a franchised dealer, whatever the age.'}
          />
        </Pressable>
      )}

      {/*
        ── The hub ────────────────────────────────────────────────────────────

        Six places to go, as `NavRow`s rather than as `ListRow`s with an empty
        value. That swap is the whole of David's *"it's not clear that these are
        buttons I could tap"* — `NavRow`'s docblock carries the three signals
        that were pointing the wrong way.

        Each row carries what is behind it where the screen knows: 18 services,
        a wishlist total, the next service. Where it does not know, it carries
        **nothing** — never a zero, which would claim the place is empty.
      */}
      <Card>
        <SectionHeader title="This car" />
        <NavRow label="Service due" count={serviceDue} onPress={onOpenMilestone} />
        <NavRow label="Service history" count={historyCount} onPress={onOpenHistory} />
        <NavRow label="Wishlist" count={wishlistCount} onPress={onOpenWishlist} />
        {/*
          The build, now a route. It was a dial reading Stock and a five-rung
          scale with a marker on it, and nothing on that card could be pressed —
          `BuildScreen` carries what was wrong with it and what it does instead.

          Shown only when the owner has not answered "stock". `showsModifications`
          is the one genuine off switch, and it is "not now" rather than "never".
        */}
        {showsModifications(vehicle.performance_mindedness) && (
          <NavRow label="Build" count={buildLabel} onPress={onOpenBuild} />
        )}
        <NavRow
          label="Scan an invoice"
          detail="Photograph a bill and its lines are filed here"
          onPress={onScanInvoice}
          last
        />
      </Card>

      {/*
        ── The one filled primary ─────────────────────────────────────────────

        The advisor is the verb this screen exists to lead to, and it is the only
        filled control on it — the spec says so directly: *"one filled primary
        per screen, and it is this one; the recall banner is a card affordance,
        not a second CTA."*
      */}
      <Button label="Ask the advisor" onPress={onAskAdvisor} style={styles.primaryAction} />

      {/*
        ── What the owner told us ─────────────────────────────────────────────

        `ListRow`, not `NavRow`, and the difference is the point of having both:
        these are **facts** the product holds about the car, so the label is the
        caption and the value is the payload. Nothing here goes anywhere.

        ⚠ Mileage is deliberately absent — it moved into the identity line at the
        top of the screen. Repeating it here would be the card duplication this
        screen was cleaned up to remove.
      */}
      <Card>
        <SectionHeader title="What you told us" />
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

  buildDial: { alignItems: 'center' },
  summary: { ...type.body, fontSize: 14, lineHeight: 20, color: text.secondary },

  row: { flexDirection: 'row', justifyContent: 'space-between', gap: space.lg },
  rowLabel: { ...type.body, fontSize: 14, color: text.muted },
  rowValue: { ...type.body, fontSize: 14, color: text.primary, flexShrink: 1, textAlign: 'right' },


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

  /* Outlined rather than filled, so it reads as the second verb on the screen. */

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
