import { useCallback, useEffect, useState } from 'react';
import { useRefetchOnFocus } from '../navigation/useRefetchOnFocus';
import {
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import AlertBanner from '../components/AlertBanner';
import Chip from '../components/Chip';
import Icon from '../components/Icon';
import Button from '../components/Button';
import Card from '../components/Card';
import { apiRequest, ApiRequestError } from '../api/client';
import {
  fetchAddressedRecalls,
  markRecallAddressed,
  unmarkRecallAddressed,
  type AddressedRecall,
} from '../api/recalls';
import { Skeleton, SkeletonCard } from '../components/Skeleton';
import {
  PAGE_BODY,
  TARGET_MIN,
  border,
  radius,
  space,
  status,
  surface,
  text,
  type,
} from '../theme';
import {
  componentPlainName,
  hasRemedy,
  normaliseRecalls,
  type NormalisedRecall,
  type RecallSeverity,
} from '@crewchief/core/recalls';
import { healthClaim } from '@crewchief/core/health-claims';
import { interFace } from '../theme/fonts';

/**
 * Phase 5.6 — where a recall notification lands.
 *
 * Replaces the placeholder on `VehicleDetailScreen`, which said "Recall detail
 * is on the web for now."
 *
 * ── Why this exists rather than the advisor ─────────────────────────────────
 *
 * The notification used to open the advisor with the question pre-typed, and
 * that was a reasonable answer to "explain this". David's call on 7 Aug was that
 * the point of the alert is to drive an action, not only to explain — so the
 * destination is a screen with the notice, what it means, and what to do about
 * it, and the advisor is one of the things you can do from it.
 *
 * ── The severity banner is the whole reason this is not a list ──────────────
 *
 * NHTSA sends `parkIt` and `parkOutSide`. A `do-not-drive` recall is not a
 * maintenance item and must not be rendered as one — the banner is the first
 * thing on the screen, before the vehicle name, because someone who opens this
 * from a notification needs the instruction before the context.
 *
 * ── Absent fields, which are the normal case here ───────────────────────────
 *
 * The stored payloads predate `Remedy` — see `recalls.ts`. Every section asks
 * before it draws. A "How it gets fixed" heading over an empty box reads as
 * "nobody knows how to fix this", which is a worse claim than staying quiet.
 */

interface Props {
  vehicleId: string;
  title?: string;
  onAskAdvisor: (vehicleId: string, ask: string) => void;
  onSignOut: () => void;
  /**
   * Rendered as a **section of `HealthScreen`** rather than as its own screen —
   * R16.
   *
   * ⚠ Two things change and both are structural. The container becomes a `View`
   * so there is not a `ScrollView` inside a `ScrollView`, and the vehicle's name
   * is dropped: the host already names the car, and an H1 repeating it mid-page
   * reads as a second screen having started.
   */
  embedded?: boolean;
}

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'gone' }
  | {
      kind: 'loaded';
      name: string;
      /** The marque alone — all "find a dealer" is allowed to know. */
      make: string | null;
      recalls: NormalisedRecall[];
      /**
       * Whether an NHTSA lookup has ever run for this vehicle.
       *
       * ⚠ Separate from `recalls.length === 0`, and that is the entire point.
       * An empty list means "checked, nothing found". A missing `nhtsa_data`
       * row means "never checked". They arrive here as the same empty array
       * and they are not the same statement — see the render.
       */
      checked: boolean;
      /**
       * What this owner has already marked.
       *
       * ⚠ An empty array means "nothing marked", and a malformed embed means
       * the same thing. There is deliberately no "we could not check" state:
       * the marks arrive with the vehicle, so they cannot fail on their own,
       * and a missing field must leave a recall **showing** rather than hidden.
       * Suppressing an open safety notice because a field did not arrive is the
       * one outcome this screen must never produce.
       */
      addressed: AddressedRecall[];
    };

interface VehicleResponse {
  vehicle?: {
    year?: number | null;
    make?: string | null;
    model?: string | null;
    nhtsa_data?: { recalls?: unknown } | { recalls?: unknown }[] | null;
    /** Embedded by `load-vehicle`. A to-many embed, so always an array. */
    recall_actions?: Array<{ campaign_number?: unknown; addressed_at?: unknown }> | null;
  };
}

/**
 * The embed, read into the shape the screen uses.
 *
 * Trusts nothing: this is a third-party-shaped payload as far as the device is
 * concerned, and a row with no campaign number cannot be matched to a recall
 * anyway, so it is dropped rather than carried as a mark that matches nothing.
 */
function readMarks(
  rows: Array<{ campaign_number?: unknown; addressed_at?: unknown }> | null | undefined
): AddressedRecall[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) =>
    typeof row?.campaign_number === 'string'
      ? [
          {
            campaignNumber: row.campaign_number,
            addressedAt: typeof row.addressed_at === 'string' ? row.addressed_at : '',
          },
        ]
      : []
  );
}

function first<T>(value: T | T[] | null | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : (value ?? undefined);
}

/**
 * What the banner says, and it is deliberately an instruction rather than a
 * label. "Do not drive this vehicle" is what NHTSA means by `parkIt`; "Park
 * outside" without the reason reads as advice about parking.
 */
const SEVERITY_BANNER: Record<Exclude<RecallSeverity, 'standard'>, { title: string; body: string }> = {
  'do-not-drive': {
    title: 'Do not drive this vehicle',
    body: 'NHTSA has flagged this recall as do-not-drive. Contact your dealer before driving it again — the repair is free.',
  },
  'park-outside': {
    title: 'Park outside, away from buildings',
    body: 'NHTSA has flagged a fire risk while parked. Keep the vehicle away from structures until the recall work is done.',
  },
};

/**
 * `YYYY-MM-DD` as a person writes it, without the off-by-one.
 *
 * ⚠ **`formatCurrency`'s neighbour `formatDate` is wrong for this input**, and
 * quietly. It does `new Date('2026-08-23')`, which the spec parses as **UTC
 * midnight**, and then renders it in the device's local zone — so every user
 * west of Greenwich reads a date-only value as the day before. On "you marked
 * this repaired on…" that is a wrong date on a safety record, and it never
 * throws.
 *
 * Split on the hyphens instead. There is no timezone in a calendar date, so the
 * fix is to not involve one.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function calendarDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day || month < 1 || month > 12) return value;
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

/**
 * The recall's component, as a name rather than NHTSA's taxonomy string — R28.
 *
 * A thin wrapper so the screen never reaches for `recall.component` by
 * accident: the raw value is still rendered, once, at provenance weight, and
 * every other use on this screen goes through here — including the accessible
 * names, which is where a database enum would otherwise be *read out loud*.
 */
function plainComponent(recall: { component: string | null }): string | null {
  return componentPlainName(recall.component);
}

export function RecallDetailScreen({
  vehicleId,
  title,
  onAskAdvisor,
  onSignOut,
  embedded = false,
}: Props) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [refreshing, setRefreshing] = useState(false);

  /**
   * Which recalls have their full notice open — R30.
   *
   * ⚠ A set rather than a single id: two open recalls on one car is the common
   * case, and an accordion that closes one card to open another makes comparing
   * them impossible on a screen this long.
   *
   * Collapsed is the default and stays the default across a refresh. Nothing
   * here is hidden from a screen reader — the disclosure carries
   * `accessibilityState.expanded` and names what it opens.
   */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  const toggleExpanded = useCallback((key: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }, []);

  /*
    Which campaign is mid-write, and what went wrong if one did.

    Keyed by campaign number rather than a single boolean for the reason the
    garage keys its photo upload by vehicle id: this screen is a list, and a
    flag would put the spinner on every card at once.
  */
  const [busyCampaign, setBusyCampaign] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setState({ kind: 'loading' });

      try {
        /*
          No `/api/v1` here — `apiRequest` prepends `API_PREFIX`. Writing the
          full path produces `/api/v1/api/v1/…` and a 404 that looks like a
          missing vehicle rather than a bad URL.
        */
        /*
          One request. The marks ride on the vehicle payload as an embedded
          `recall_actions`, so there is no second lookup to fail and no "we
          could not check what you have marked" state to word — the first draft
          of this screen had both, and removing a failure mode beats handling
          one. `load-vehicle`'s column list carries why the embed is there.
        */
        const data = await apiRequest<VehicleResponse>(
          `/load-vehicle?vehicleId=${encodeURIComponent(vehicleId)}`
        );

        const vehicle = data.vehicle;
        const name =
          [vehicle?.year, vehicle?.make, vehicle?.model].filter(Boolean).join(' ') ||
          title ||
          'this vehicle';

        /*
          The row itself, not its contents. `first(...)` is undefined when no
          NHTSA record exists for this vehicle, and that is the only evidence
          in the payload that separates "we looked" from "we have not".
        */
        const nhtsa = first(vehicle?.nhtsa_data);

        setState({
          kind: 'loaded',
          name,
          make: vehicle?.make ?? null,
          recalls: normaliseRecalls(nhtsa?.recalls),
          checked: Boolean(nhtsa),
          addressed: readMarks(vehicle?.recall_actions),
        });
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
        if (error instanceof ApiRequestError && error.status === 404) {
          setState({ kind: 'gone' });
          return;
        }
        setState({
          kind: 'error',
          message: error instanceof Error ? error.message : 'Could not load recalls',
        });
      } finally {
        setRefreshing(false);
      }
    },
    [vehicleId, title, onSignOut]
  );

  useEffect(() => {
    void load();
  }, [load]);

  /*
    ── ⚠ MOB-09 · a write behind this screen used to be invisible ─────────────

    Nothing in this app refetched on focus. Every screen loaded once on mount
    and kept whatever it had — so adding to the wishlist, marking a recall
    repaired, confirming an odometer or scanning an invoice all succeeded and
    then returned to a screen that said they had not.

    `useRefetchOnFocus` carries the full argument, including why this runs on
    the first focus too rather than being clever about skipping it.
  */
  useRefetchOnFocus(load);

  /**
   * Record — or withdraw — the owner's claim that this campaign was seen to.
   *
   * ⚠ **The list is refetched rather than patched in place.** The same rule the
   * garage follows for a photo upload: the server owns `addressed_at`, this
   * screen would have to guess it, and a guessed date on a safety record that
   * then corrects itself on the next refresh is worse than a moment's wait.
   */
  const setAddressed = useCallback(
    async (campaignNumber: string, marked: boolean) => {
      setActionError(null);
      setBusyCampaign(campaignNumber);

      try {
        if (marked) await markRecallAddressed(vehicleId, campaignNumber);
        else await unmarkRecallAddressed(vehicleId, campaignNumber);

        const addressed = await fetchAddressedRecalls(vehicleId);
        setState((held) => (held.kind === 'loaded' ? { ...held, addressed } : held));
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
        setActionError(
          error instanceof Error ? error.message : 'That could not be saved. Try again.'
        );
      } finally {
        setBusyCampaign(null);
      }
    },
    [vehicleId, onSignOut]
  );

  /**
   * Dealers for this marque, in the phone's own maps app.
   *
   * ⚠ **The marque and nothing else.** No VIN, no campaign number, no vehicle
   * id — a maps query is a URL that leaves this app, gets logged by whatever
   * handles it, and can end up in a search history. The make is enough to find
   * a franchised dealer, which is the whole task, and it is the least this can
   * carry and still work.
   *
   * A failure is silent on purpose. The one thing that can go wrong is that no
   * app claims the URL, and an error box saying so is noise on a screen whose
   * next line already tells you the repair is free at a franchised dealer.
   */
  const findDealer = useCallback((make: string | null) => {
    const query = encodeURIComponent(make ? `${make} dealer` : 'car dealer');
    void Linking.openURL(`https://maps.apple.com/?q=${query}`).catch(() => {});
  }, []);

  if (state.kind === 'loading') {
    /*
      A banner-height block then recall cards. The banner is the first thing
      this screen says when it has something to say, so leaving its space
      unclaimed is what makes the arrival jump.
    */
    /*
      ⚠ **Embedded, this must not be a `ScrollView`** — see the container note
      below. Nor may the error states below keep `flex: 1`: inside a host's
      content container that collapses to zero height, and a section that
      vanishes while loading reads as a section that is not there.
    */
    return embedded ? (
      <View style={styles.embedded}>
        <Skeleton height={72} />
        <SkeletonCard lines={3} />
      </View>
    ) : (
      <ScrollView contentContainerStyle={styles.body}>
        <Skeleton height={72} />
        <SkeletonCard lines={3} />
      </ScrollView>
    );
  }

  if (state.kind === 'gone') {
    return (
      <View style={[styles.centre, embedded && styles.centreEmbedded]}>
        <Text style={styles.errorTitle}>This vehicle is no longer here</Text>
        <Text style={styles.errorBody}>It may have been removed from another device.</Text>
      </View>
    );
  }

  if (state.kind === 'error') {
    return (
      <View style={[styles.centre, embedded && styles.centreEmbedded]}>
        <Text style={styles.errorTitle}>Could not load recalls</Text>
        <Text style={styles.errorBody}>{state.message}</Text>
        <Pressable style={styles.button} onPress={() => void load()} accessibilityRole="button">
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  /*
    ── What "open" means on this screen ──────────────────────────────────────

    A recall the owner has marked is still a recall. It is not deleted, not
    hidden and not filtered out — it sinks to the bottom of the list and
    restyles, because the notice is a public safety record and this product's
    mark is one person's claim about one car. Hiding the first behind the
    second would be the app quietly agreeing that the claim settled the matter.

    ⚠ A malformed or absent embed reads as **nothing marked**. Erring the other
    way would suppress an open recall on the strength of a field that did not
    arrive.
  */
  const marks = new Map(state.addressed.map((m) => [m.campaignNumber, m.addressedAt]));
  const markOf = (recall: NormalisedRecall) =>
    recall.campaignNumber ? (marks.get(recall.campaignNumber) ?? null) : null;

  const ordered = [...state.recalls].sort(
    (a, b) => Number(Boolean(markOf(a))) - Number(Boolean(markOf(b)))
  );
  const openCount = ordered.filter((recall) => !markOf(recall)).length;
  const markedCount = ordered.length - openCount;

  /*
    The banner reads the worst **open** severity, not the worst on record. A
    do-not-drive instruction on a campaign whose owner has already had the work
    done is an instruction about a car that is fine, and this banner's whole
    value is that it is never routine.
  */
  const worst = ordered.find((recall) => !markOf(recall))?.severity;
  const banner = worst && worst !== 'standard' ? SEVERITY_BANNER[worst] : null;

  /*
    ── ⚠ R16 · a scroller, or a section inside somebody else's ───────────────

    Folded into `HealthScreen`, this renders inside **that** screen's
    `ScrollView`. Two scrollers on the same axis is a real defect on iOS rather
    than a cosmetic one — the inner one swallows the gesture and the outer one
    stops at the inner one's height — so the container is swapped rather than
    nested, and the pull-to-refresh goes with it: the host owns the gesture and
    the whole page refreshes together.
  */
  const Container = embedded ? View : ScrollView;
  const containerProps = embedded
    ? { style: styles.embedded }
    : {
        contentContainerStyle: styles.body,
        refreshControl: (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load(true)}
            tintColor={text.muted}
          />
        ),
      };

  return (
    <Container {...(containerProps as object)}>
      {/*
        Before the vehicle name, deliberately. Someone arriving from a
        notification needs the instruction before the context.
      */}
      {banner && (
        <View
          style={[styles.banner, worst === 'do-not-drive' ? styles.bannerSevere : styles.bannerWarn]}
          accessibilityRole="alert"
        >
          <Text style={styles.bannerTitle}>{banner.title}</Text>
          <Text style={styles.bannerBody}>{banner.body}</Text>
        </View>
      )}

      {/* The host names the car when embedded — see `Props.embedded`. */}
      {embedded ? null : <Text style={styles.name}>{state.name}</Text>}

      {/*
        ── R31 · a count of critical items is not meta ───────────────────────

        `2 open` rendered as unstyled quiet text under the car's name — the same
        treatment as a mileage or a trim. It is a count of open safety notices,
        and the system has a chip family that says exactly that.

        ⚠ The chip is only for the **open** count. "3 marked repaired" is the
        owner's own record and stays a quiet line: a critical chip on work
        somebody has already had done is the colour teaching itself to mean
        nothing.
      */}
      <View style={styles.countRow}>
        {state.recalls.length > 0 ? (
          <>
            {openCount > 0 ? (
              <Chip label={`${openCount} open`} tone="critical" />
            ) : (
              <Chip label="All marked repaired" tone="confirm" />
            )}
            {markedCount > 0 && openCount > 0 ? (
              <Text style={styles.count}>{markedCount} marked repaired</Text>
            ) : null}
          </>
        ) : (
          <Text style={styles.count}>
            {state.checked ? 'No recalls on record' : 'Recalls not checked yet'}
          </Text>
        )}
      </View>

      {actionError && (
        <AlertBanner tone="critical" headline="That was not saved" body={actionError} />
      )}

      {state.recalls.length === 0 && (
        <Card style={styles.cardGap}>
          {state.checked ? (
            /*
              Not "you have no recalls". This app reads NHTSA's list, and an
              empty list is a statement about that list rather than about the car.
            */
            <Text style={styles.body14}>
              NHTSA has no open recalls listed for this vehicle. That is their record, not a
              guarantee — a dealer can check against the VIN.
            </Text>
          ) : (
            /*
              ⚠ The web's 21 Aug defect, reached on mobile. Until now both
              branches rendered the sentence above — so a car whose NHTSA record
              had never been fetched was told "NHTSA has no open recalls listed
              for this vehicle", which is a claim about a lookup that never ran.

              The web copy was careful in one direction (an empty list is not a
              guarantee about the car) and silent in the other (an empty list
              might not be a list at all). `health-claims.ts` fixed that on the
              web with three states; this is the same fix, one platform over,
              on the screen a recall notification opens.
            */
            <Text style={styles.body14}>
              {healthClaim('recall', '', false).text} We fetch it from NHTSA shortly after a
              vehicle is added — open this screen again in a minute.
            </Text>
          )}
        </Card>
      )}

      {ordered.map((recall, index) => {
        const markedOn = markOf(recall);
        const working = busyCampaign !== null && busyCampaign === recall.campaignNumber;
        /* Same key the card is rendered under, so the disclosure state follows it. */
        const cardKey = recall.campaignNumber ?? `recall-${index}`;

        return (
        <Card
          key={recall.campaignNumber ?? `recall-${index}`}
          style={[styles.cardGap, markedOn ? styles.cardMarked : null]}
        >
          {/*
            ── R28 · the headline is a name, not NHTSA's enum ────────────────

            It rendered `AIR BAGS:SIDE/WINDOW:HEAD` — the taxonomy string,
            verbatim, in caps, as the title of the most serious card in the
            product. `componentPlainName` maps the system and lower-cases the
            qualifiers; the raw string survives at the foot of this card, beside
            the campaign number, because it is what a service desk recognises.
          */}
          {plainComponent(recall) ? (
            <Text style={styles.component}>{plainComponent(recall)}</Text>
          ) : null}

          {/*
            ── R30 · lead with the notice, then offer to act on it ───────────

            NHTSA's summary is a 90-word manufacturer paragraph, and it used to
            render in full alongside `What could happen` and `How it gets fixed`
            — three levels of prose at once, at low contrast, which is how a
            screen ends up read by nobody.

            Three lines here, expandable. Enough to know what is wrong before
            being asked to act on it, which is the whole of **R27**: this card
            used to offer "Mark as repaired" *above* any description of the
            defect.
          */}
          {recall.summary ? (
            <Text style={styles.summary} numberOfLines={expanded.has(cardKey) ? undefined : 3}>
              {recall.summary}
            </Text>
          ) : null}

          {/*
            ── The two actions ───────────────────────────────────────────────

            The recall spec is explicit that this card's "job is to drive an
            action, not to explain a notice", so they stay high — above the
            detail sections and the advisor row, and one line of summary below
            the name of the defect. That single line is the correction: the spec
            argues for prominence, and R27 is about **sequence**, and they are
            reconcilable.

            ⚠ Neither is `.btn-primary`. Both are outline controls, because a
            filled cyan button here would read as *the* recommended action — and
            this product does not know whether an owner should be booking a
            dealer or recording work they have already had done.
          */}
          {markedOn ? (
            /*
              The claim, in the owner's own terms, with the way back beside it.

              ⚠ Not "Repaired". Nothing here verified anything: NHTSA matches
              recalls on year/make/model rather than VIN, so the strongest true
              sentence is that *you said so, on this date*. §10, on the screen
              where overstating is most expensive.
            */
            <View style={styles.markedRow}>
              <Text style={styles.markedText}>
                You marked this repaired on {calendarDate(markedOn)}
              </Text>
              {/*
                ⚠ `Button`, not a hand-rolled `Pressable` that swaps its label
                for a spinner. That pattern loses the control's accessible name
                at the exact moment something is happening — RN derives the name
                from the `<Text>` descendants, so a busy control announces as
                bare "button". `mobile-busy-controls-named.test.ts` caught this
                one on its first draft; the primitive keeps the name and sets
                `accessibilityState.busy` alongside it.
              */}
              <Button
                label="Undo"
                variant="outline"
                busy={working}
                accessibilityLabel={`Undo marking the ${plainComponent(recall) ?? 'recall'} repaired`}
                onPress={() =>
                  recall.campaignNumber && void setAddressed(recall.campaignNumber, false)
                }
              />
            </View>
          ) : (
            <View style={styles.actions}>
              <Button
                label="Find a dealer"
                variant="outline"
                onPress={() => findDealer(state.make)}
                style={styles.action}
              />
              {/*
                Only offered when the campaign has a number. The mark is stored
                against `(vehicle_id, campaign_number)`, so a recall that
                arrived without one has nothing to key on — and a button that
                silently does nothing is worse than one that is not there.
              */}
              {recall.campaignNumber ? (
                <Button
                  label="Mark as repaired"
                  variant="outline"
                  busy={working}
                  onPress={() => void setAddressed(recall.campaignNumber!, true)}
                  style={styles.action}
                />
              ) : null}
            </View>
          )}

          {/*
            ── R30 · the detail, behind one disclosure ───────────────────────

            `What could happen` and `How it gets fixed` are the two questions an
            owner has after "what is wrong", and both are worth having — but
            rendering all of it at once is what made none of it read. One
            control opens the lot, including the rest of the summary above.
          */}
          {(recall.consequence || hasRemedy(recall)) && (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: expanded.has(cardKey) }}
              accessibilityLabel={`${expanded.has(cardKey) ? 'Hide' : 'Show'} the full notice for the ${
                plainComponent(recall) ?? 'recall'
              } recall`}
              onPress={() => toggleExpanded(cardKey)}
              style={styles.disclosure}
            >
              <Text style={styles.disclosureText}>
                {expanded.has(cardKey) ? 'Hide the full notice' : 'Read the full notice'}
              </Text>
              <Icon
                name={expanded.has(cardKey) ? 'chevron-up' : 'chevron-down'}
                size={16}
                color={text.muted}
              />
            </Pressable>
          )}

          {expanded.has(cardKey) && (
            <>
              {recall.consequence && (
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>What could happen</Text>
                  <Text style={styles.body14}>{recall.consequence}</Text>
                </View>
              )}

              {/*
                Asked, not assumed. The stored payloads predate this field, so on
                the demo cars this section is simply absent rather than empty.
              */}
              {hasRemedy(recall) && (
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>How it gets fixed</Text>
                  <Text style={styles.body14}>{recall.remedy}</Text>
                </View>
              )}
            </>
          )}

          {/*
            ── R28 · the raw string, kept where it belongs ───────────────────

            NHTSA's own component code is what a service desk will recognise and
            what a campaign lookup is done against, so it is not discarded — it
            sits here at provenance weight, beside the campaign number, rather
            than as the card's headline.
          */}
          <View style={styles.metaRow}>
            {recall.campaignNumber && (
              <Text style={styles.meta}>Campaign {recall.campaignNumber}</Text>
            )}
            {recall.reportedOn && (
              /* "Issued 14 Mar 2024", per the spec — not the raw ISO string. */
              <Text style={styles.meta}>Issued {calendarDate(recall.reportedOn)}</Text>
            )}
            {recall.component && <Text style={styles.meta}>{recall.component}</Text>}
          </View>

          {/*
            ── R32 · the differentiator, at the card's foot, on a divider ────

            It was the last thing on a long card with nothing separating it from
            the metadata above, so the one control that leads to what this
            product does best read as a footnote. A rule and a quiet row is the
            system's own treatment for an action that closes a card.

            It carries this specific recall as the question rather than opening
            an empty thread.
          */}
          <Pressable
            style={styles.askCta}
            accessibilityRole="button"
            accessibilityLabel={`Ask the advisor about the ${plainComponent(recall) ?? 'recall'} recall`}
            onPress={() =>
              onAskAdvisor(
                vehicleId,
                `What does this recall mean for my ${state.name}? ${recall.summary ?? recall.component ?? ''}`
              )
            }
          >
            <Text style={styles.askCtaText}>Ask the advisor about this</Text>
          </Pressable>
        </Card>
        );
      })}

      {state.recalls.length > 0 && (
        <Text style={styles.footnote}>
          Recall data from NHTSA. Repairs under an open recall are free at a franchised
          dealer, whatever the age of the vehicle.
        </Text>
      )}
    </Container>
  );
}

const styles = StyleSheet.create({
  /*
    ── The two actions, and the marked state ─────────────────────────────────

    Side by side and equal, because the product does not know which one an
    owner needs — booking the work and recording work already done are the same
    size of decision from here.
  */
  actions: { flexDirection: 'row', gap: space.sm },
  action: { flex: 1 },
  /*
    A marked card keeps its border and loses its emphasis. Not hidden and not
    collapsed: the recall is still a public safety record, and the owner's mark
    is a claim about their own car — see the sort comment in the render.
  */
  cardMarked: { borderColor: border.panel, backgroundColor: surface.nav },
  markedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  markedText: { ...type.value, color: text.secondary, flex: 1 },

  body: { ...PAGE_BODY },
  /* Embedded: the host owns the gutter and the tail. Only the rhythm is ours. */
  embedded: { gap: PAGE_BODY.gap },
  /*
    ⚠ `flex: 0` and a real height. `centre` is `flex: 1`, which fills a screen
    and collapses to nothing inside a scroll container — so an embedded error
    state would render as an empty gap rather than as a message.
  */
  centreEmbedded: { flex: 0, paddingVertical: space.h1 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 10 },

  /*
    ── R7 · this screen's one serif role ────────────────────────────────────

    The system offers two editorial roles — (a) a name, (b) a single hero
    numeral — and says one per screen, never two. Eight screens were spending
    neither, so the typographic signature existed on exactly one surface and
    read as an accident of that surface rather than as a system.

    Here it is role (a). The car is what the open recalls are *about*, the nav
    only carries "Recalls", and there is no numeral on this screen competing
    for it.
  */
  name: { ...type.editorial, color: text.primary, letterSpacing: -0.5 },
  count: { color: text.muted, fontSize: 14, marginTop: -10 },

  banner: { borderRadius: radius.card, padding: 16, gap: 6, borderWidth: 1 },
  /*
    Solid fills rather than tinted transparency. These two carry the only
    instructions on the screen that are time-critical, and a wash over an
    unknown backdrop is exactly where the 4.47:1 contrast defect came from on
    the advisor CTA. Both are measured in `mobile-text-contrast`.
  */
  bannerSevere: { backgroundColor: status.criticalFill, borderColor: status.criticalBorder },
  bannerWarn: { backgroundColor: status.attentionFill, borderColor: status.attentionBorder },
  bannerTitle: { color: text.primary, fontSize: 17, fontFamily: interFace('700'), fontWeight: '700', letterSpacing: -0.2 },
  bannerBody: { color: text.secondary, fontSize: 14, lineHeight: 20 },

  /**
   * The card, on the ladder rather than beside it.
   *
   * ⚠ This was a **private copy** — `surface.raised` with no border, where the
   * `Card` primitive is `surface.card` with `border.panel`. `raised` is the
   * ladder's step for bars, tab strips and chips; a card painted on it sits one
   * step off from every other card in the app, which is precisely the "twelve
   * slightly different containers" the primitive set was built to end.
   *
   * The gap is kept as it was. Padding and gaps across this app want a pass
   * with a designer's eye rather than a find-and-replace — see the note in
   * `mobile-radius-scale.test.ts` on why that rule was scoped to radius.
   */
  cardGap: { gap: 10 },
  component: {
    color: status.attention,
    fontSize: 12,
    fontFamily: interFace('700'), fontWeight: '700',
    letterSpacing: 0.6,
  },
  summary: { color: text.primary, fontSize: 15, lineHeight: 21 },

  section: { gap: 4 },
  sectionLabel: {
    color: text.muted,
    fontSize: 12,
    fontFamily: interFace('600'), fontWeight: '600',
    letterSpacing: 0.4,
  },
  body14: { color: text.secondary, fontSize: 14, lineHeight: 20 },

  countRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  /*
    ── R32 · the disclosure and the advisor row ────────────────────────────
  */
  disclosure: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: TARGET_MIN,
  },
  disclosureText: { ...type.uiStrong, color: text.secondary },

  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  meta: { color: text.muted, fontSize: 12 },

  askCta: {
    backgroundColor: surface.raised,
    borderRadius: radius.button,
    paddingVertical: 12,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  askCtaText: { color: text.primary, fontSize: 14, fontFamily: interFace('600'), fontWeight: '600' },

  footnote: { color: text.muted, fontSize: 12, lineHeight: 18 },

  errorTitle: { color: text.primary, fontSize: 17, fontFamily: interFace('600'), fontWeight: '600' },
  errorBody: { color: text.muted, fontSize: 14, textAlign: 'center' },
  button: {
    marginTop: 6,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: radius.button,
    backgroundColor: surface.raised,
    minHeight: 44,
    justifyContent: 'center',
  },
  buttonText: { color: text.primary, fontSize: 14 },
});
