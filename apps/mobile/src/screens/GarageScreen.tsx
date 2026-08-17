import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import { apiRequest, ApiRequestError } from '../api/client';
import Button from '../components/Button';
import AlertBanner from '../components/AlertBanner';
import Chip from '../components/Chip';
import EmptyState from '../components/EmptyState';
import FirstRun from '../components/FirstRun';
import GarageBay from '../components/GarageBay';
import Logo from '../components/Logo';
import { SkeletonCard } from '../components/Skeleton';
import { radius, space, status, surface, text, type, TARGET_MIN } from '../theme';
import { AccountScreen } from './AccountScreen';
import { PushPrimer } from '../notifications/PushPrimer';
import {
  currentPushPermission,
  primerDismissedOn,
  recordPrimerDismissed,
  registerForPush,
} from '../notifications/register';
import { shouldShowPushPrimer } from '@crewchief/core/push-priming';
import { shouldShowFirstRun } from '@crewchief/core/first-run';
import { everHadVehicle, recordEverHadVehicle } from '../onboarding/first-run-storage';
import { uploadVehiclePhoto } from '../api/photos';
import type { InvoiceFile } from '../api/documents';
import { getHealthBandJudgement } from '@crewchief/core/health-band';
import { localToday } from '@crewchief/core/garage-next-service';
import { interFace } from '../theme/fonts';

/**
 * Phase 3.2 — the garage, read only.
 *
 * One request to `GET /api/v1/vehicles`, which already returns everything this
 * screen draws: the declared garage columns, a **signed** `photo_url`, the
 * health summary and the recall list. No second call, and nothing derived on
 * the device that the server already knows.
 *
 * ── Why the health band is imported and not written here ────────────────────
 *
 * `@crewchief/core/health-band` holds the thresholds and the wording. The web
 * dashboard reads the same module. A local copy of "80 is good" would drift
 * from the web silently — the two-components bug that produced that module in
 * the first place, at two-clients scale, where nobody notices until a phone and
 * a laptop are held side by side.
 *
 * Since step 4 this screen no longer paints a score itself. `ClusterGauge`'s
 * row variant owns the presentation and reads the band internally; the band is
 * still resolved here because the card needs to know whether there *is* a
 * score at all — a missing score is not a zero, and banding one would paint the
 * card red about a condition nobody measured.
 *
 * ── The states this has to render ───────────────────────────────────────────
 *
 * Four, and the last two are the ones usually skipped. Loading and loaded are
 * obvious. **401** means the session died under us and the answer is not an
 * error box — `App.tsx` will swap to the sign-in screen the moment the session
 * clears, so this reports it plainly and lets that happen. **Empty** is not a
 * failure: an account with no cars is the ordinary first-run state, and showing
 * "something went wrong" there is how a working app looks broken.
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
  current_mileage?: number | null;
  vehicle_status?: string | null;
  photo_url?: string | null;
  /*
    PostgREST returns an embedded one-to-one as an object, and an embedded
    one-to-many as an array. These two are declared one-to-one in the select but
    arrive either way depending on how the relationship is inferred, so both
    shapes are accepted rather than assumed — a wrong guess here renders a blank
    health band and looks like missing data instead of a shape mismatch.
  */
  vehicle_health_summary?: HealthSummary | HealthSummary[] | null;
  nhtsa_data?: { recalls?: unknown[] | null } | { recalls?: unknown[] | null }[] | null;
}

function first<T>(value: T | T[] | null | undefined): T | undefined {
  if (Array.isArray(value)) return value[0];
  return value ?? undefined;
}

const miles = new Intl.NumberFormat('en-US');

/**
 * `vehicle_status` is a database enum — `daily_driver`, `weekend_car`. It
 * reached the screen raw on the first render, reading "daily_driver" under the
 * car's name.
 *
 * Caught by looking at it. It typechecks, and a snapshot test written by the
 * same person who forgot to format it would have snapshotted the underscore.
 */
function humanise(value: string): string {
  return value
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * One bay, wired to a row from the garage payload.
 *
 * ── Why this replaced the card ──────────────────────────────────────────────
 *
 * The board's line for this screen is *"Home. One car in a lit room, swiped
 * between."* A card list is a database browser. It was also the shape that had
 * nowhere to put a 184pt instrument, which is exactly why the bay and the
 * plinth were deferred out of step 3 rather than built around a placeholder and
 * then built a second time once the dial existed.
 *
 * What the card carried and this keeps: the formatted status (`vehicle_status`
 * reached the screen as "daily_driver" once, and only looking at it caught
 * that), the formatted mileage, and the recall count. They move from a meta row
 * into the identity subtitle and the footer, because a bay has one lockup
 * rather than a header and a body.
 */
function VehicleBay({
  vehicle,
  index,
  total,
  active,
  onOpen,
  onAddPhoto,
  uploading,
}: {
  vehicle: Vehicle;
  index: number;
  total: number;
  active: boolean;
  onOpen: () => void;
  onAddPhoto?: () => void;
  uploading?: boolean;
}) {
  const health = first(vehicle.vehicle_health_summary);
  const score = typeof health?.health_score === 'number' ? health.health_score : null;

  const recalls = first(vehicle.nhtsa_data)?.recalls;
  const recallCount = Array.isArray(recalls) ? recalls.length : 0;

  /*
    `Premium · Daily driver · 48,210 mi` — the board's subtitle, assembled here
    because only the screen knows which fields the payload actually carried.
    Each part is optional and the separator earns its place only when there is
    something on both sides of it.
  */
  const subtitle = [
    vehicle.trim,
    vehicle.vehicle_status ? humanise(vehicle.vehicle_status) : null,
    typeof vehicle.current_mileage === 'number'
      ? `${miles.format(vehicle.current_mileage)} mi`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <GarageBay
      vehicle={vehicle}
      /*
        Read at render rather than held in state. The garage is not open across
        midnight often, and a date frozen at mount would be quietly wrong for
        anyone who left the app on overnight — which is exactly the reader who
        would then see "overdue since" a day early.
      */
      today={localToday()}
      score={score}
      index={index}
      total={total}
      subtitle={subtitle}
      active={active}
      onOpen={onOpen}
      onAddPhoto={onAddPhoto}
      uploading={uploading}
      footer={
        recallCount > 0 ? (
          /*
            Recalls stay on the bay rather than moving to the detail screen.
            They are the one thing on this payload that can be time-critical,
            and a garage that shows a car's condition but not its open safety
            defect is showing the reassuring half.
          */
          <View style={styles.bayFooter}>
            <Chip label={`${recallCount} recall${recallCount === 1 ? '' : 's'}`} tone="critical" />
          </View>
        ) : null
      }
    />
  );
}

/**
 * The access token, readable off the device — moved here from `SignedInScreen`
 * rather than lost with it.
 *
 * `scripts/verify-mobile-contract.mjs` needs MOBILE_TEST_TOKEN, and without it
 * the bearer happy path, the unowned-vehicle 404 and the garage-list assertions
 * all `skip()`. They have skipped across five pieces of work. The affordance
 * exists because the roadmap claimed signing in closed that gap and it could
 * not: there was no way to get the value off the phone.
 *
 * Deleting it along with the proof screen would reopen the gap the moment 3.2
 * landed, so it travels with whatever the signed-in screen happens to be.
 *
 * `__DEV__` only. A bearer token is a password for the API until it expires,
 * and a shipping build must not render one where a screenshot or a shoulder can
 * take it. Expo Go is always `__DEV__`; a release build compiles this out.
 */
function DevToken({ token }: { token: string }) {
  if (!__DEV__) return null;
  return (
    <View style={styles.devBlock}>
      <Text style={styles.devHeading}>Access token — dev builds only</Text>
      <Text style={styles.errorBody}>
        Long-press to select and copy. Set as MOBILE_TEST_TOKEN to run the credentialed contract
        checks.
      </Text>
      <Text selectable style={styles.devToken}>
        {token}
      </Text>
    </View>
  );
}

export function GarageScreen({
  accessToken,
  email,
  onSignOut,
  onOpenVehicle,
  onAddVehicle,
  pickPhoto,
}: {
  accessToken: string;
  email: string | null;
  onSignOut: () => void;
  /** Title travels with the id so the detail header is right during the fetch. */
  onOpenVehicle: (vehicleId: string, title: string) => void;
  onAddVehicle: () => void;
  /**
   * The picker, injected — this screen never imports `expo-image-picker`.
   *
   * `src/media/pick-image.ts` is the one module that does, for the reason set
   * out there: it is a native module, and a build that lacks it crashes on
   * launch the moment anything in the graph imports it. Taking it as a prop is
   * the same seam `InvoiceScanScreen` uses, and it is what lets this screen
   * mount in a test.
   *
   * Omitted means no photo control at all rather than a control that fails.
   */
  pickPhoto?: () => Promise<InvoiceFile | null>;
}) {
  /*
    App Store 5.1.1(v). The account surface is one tap from here because the
    guideline requires deletion to be genuinely available rather than buried —
    and this is the only screen a signed-in user sees, so "buried" would be any
    number of taps greater than one.
  */
  const [accountOpen, setAccountOpen] = useState(false);
  const [deletedNotice, setDeletedNotice] = useState<string | null>(null);
  /*
    Which car's photo is uploading, and what went wrong if it did.

    Keyed by vehicle id rather than a single boolean: a garage is a list, and a
    flag would put the spinner on every plate at once.
  */
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  /*
    Which bay is on screen. Drives the batten's "2 of 3" and, more importantly,
    which bay is allowed to run its door and its needle — see `GarageBay`.
  */
  const [bayIndex, setBayIndex] = useState(0);

  const { width } = useWindowDimensions();

  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'ok'; vehicles: Vehicle[] }
    | { status: 'error'; message: string; unauthorized: boolean }
  >({ status: 'loading' });
  const [refreshing, setRefreshing] = useState(false);

  /**
   * Has this install ever had a car in it?
   *
   * `undefined` while the answer is still being read off storage, and the
   * empty-garage branch renders **nothing** until it resolves. The alternative
   * is a frame of the wrong opening screen — either the bare "No vehicles yet"
   * flashing before the explanation, or the explanation flashing at somebody
   * who has used this for a year. Same argument the session gate in `App.tsx`
   * makes for `undefined`, one question along.
   */
  const [hadVehicle, setHadVehicle] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    let live = true;

    void everHadVehicle().then((ever) => {
      if (live) setHadVehicle(ever);
    });

    return () => {
      live = false;
    };
  }, []);

  /*
    Written on a load that returns cars, not on the create.

    The two differ for the case that matters: signing in on a second phone to
    an account that already has cars never runs a create, and a flag written
    only there would leave that install believing forever that this is
    somebody's first run.
  */
  useEffect(() => {
    if (state.status !== 'ok' || state.vehicles.length === 0) return;

    setHadVehicle(true);
    void recordEverHadVehicle();
  }, [state]);
  const [primerOpen, setPrimerOpen] = useState(false);

  /*
    ── C5: the notification primer ──────────────────────────────────────────

    It is raised from the garage rather than from the navigator because the
    rule that gates it needs the vehicle count, and this is the screen that
    has one. That is not incidental — "ask once they have a car" is the design:
    somebody with an empty garage is being asked to agree to something
    abstract, and an abstract yes is the one most likely to be no.

    Runs when the vehicle list resolves, not on mount, so the count is real
    rather than zero-while-loading. A zero-while-loading read would suppress
    the primer on every launch and the screen would never appear at all.
  */
  useEffect(() => {
    if (state.status !== 'ok') return;

    let cancelled = false;

    void (async () => {
      const [permission, dismissedOn] = await Promise.all([
        currentPushPermission(),
        primerDismissedOn(),
      ]);

      if (cancelled) return;

      setPrimerOpen(
        shouldShowPushPrimer({
          permission,
          dismissedOn,
          vehicleCount: state.vehicles.length,
          today: new Date().toISOString().slice(0, 10),
        }),
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [state]);

  const acceptPrimer = useCallback(async () => {
    /*
      Closed first, then the system dialog. Leaving our screen up underneath
      Apple's puts two asks on screen at once, and the person answers the one
      they can see while the other waits — which reads as the app arguing with
      itself.
    */
    setPrimerOpen(false);
    await registerForPush();
  }, []);

  const declinePrimer = useCallback(async () => {
    setPrimerOpen(false);
    // Records a date, not a boolean, so the cooldown can expire and somebody
    // who was busy today can still be asked next month.
    await recordPrimerDismissed(new Date().toISOString().slice(0, 10));
  }, []);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setState({ status: 'loading' });

    /*
      A photo error does not survive a reload. `AlertBanner` has no dismiss
      affordance — it is an alert, not a dialog — so pull-to-refresh is the
      gesture that clears it, alongside simply trying again.
    */
    setPhotoError(null);

    try {
      const body = await apiRequest<{ vehicles?: Vehicle[] }>('/vehicles');
      setState({ status: 'ok', vehicles: body.vehicles ?? [] });
    } catch (error) {
      const apiError = error as ApiRequestError;
      setState({
        status: 'error',
        message: apiError.message,
        unauthorized: apiError.status === 401,
      });
    } finally {
      if (isRefresh) setRefreshing(false);
    }
  }, []);

  /**
   * Add or replace a car's photograph.
   *
   * ── The three outcomes, and only one is an error ────────────────────────────
   *
   *   - **Dismissed.** `pickVehiclePhoto` resolves `null`, and that is not a
   *     failure — the screen returns to idle silently. Showing "cancelled" for
   *     a deliberate tap on Cancel is how an app feels accusatory.
   *   - **Refused.** Permission denied, wrong type, or over the stored ceiling.
   *     Every one of these carries a sentence written for the owner, so the
   *     message is shown as-is rather than replaced with a generic one — ⚠ the
   *     size ceiling is genuinely reachable from a phone, because there is no
   *     image manipulator in this build to cap a dimension with.
   *   - **Stored.** The list is refetched rather than patched in place. The
   *     upload returns a signed URL, but the garage row also carries a
   *     `photo_url` the server signs its own way, and writing one into a row
   *     the next refresh overwrites is the kind of disagreement that reads as a
   *     photo flickering back to the plate.
   */
  const onAddPhoto = useCallback(
    async (vehicleId: string) => {
      if (!pickPhoto) return;

      setPhotoError(null);

      try {
        const file = await pickPhoto();
        if (!file) return;

        setUploadingId(vehicleId);
        await uploadVehiclePhoto(vehicleId, file);
        await load(true);
      } catch (error) {
        setPhotoError(error instanceof Error ? error.message : 'That photo could not be saved.');
      } finally {
        setUploadingId(null);
      }
    },
    [pickPhoto, load],
  );

  useEffect(() => {
    void load();
  }, [load]);

  /*
    ── The header is rendered in every state, and that is a compliance fix ────

    Loading and error used to `return` before it, so both drew a bare centred
    box with no "Account" on it. **That put account deletion behind the API
    being up.** App Store 5.1.1(v) requires deletion to be initiated from inside
    the app, and `AccountScreen` is one tap from here precisely so it is not
    buried — but an early return buries it exactly when someone is most likely
    to be leaving. A reviewer testing offline, or on a bad connection, would see
    a screen with no way out of the account at all.

    So the header and the account modal are hoisted above the branch, and only
    the body below them changes with the state.
  */
  const header = (
    <View style={styles.header}>
      <View style={styles.headingRow}>
        {/* 22px — the small cut, switched inside the component. This is the
            root screen, so the nav header carries the mark alone. */}
        <Logo variant="mark" size={22} />
        <Text style={styles.heading}>Garage</Text>
      </View>
      <View style={styles.headerActions}>
        {/*
          "Add a car" lives here, not only in the empty state.

          It used to exist solely inside `ListEmptyComponent`, which meant that
          **once you owned one car there was no way on the phone to add a
          second.** Fine while the web was where you became a user; a hole in
          the product once the phone is the product.

          This is the same rule `mobile-account-reachable.test.ts` holds for
          account deletion, and it was broken the same way — an affordance
          placed in one branch of a screen that renders several. The header
          renders in every state this screen has, which is why both live in it.
        */}
        {/*
          ⚠ No `hitSlop`. These two sat in a `space.lg` row each carrying
          `hitSlop={12}`, so their targets overlapped by **8pt** — 12 + 12 into
          a 16pt gap — and a tap in the overlap went to whichever painted last.

          The floor names this exception itself: hitSlop is not a substitute in
          a wrapped row. Both already clear 44 vertically through `minHeight`
          and `lineHeight`, and both clear it horizontally on their own text, so
          the slop was buying nothing and paying for it with a collision.
        */}
        <Pressable onPress={onAddVehicle} accessibilityRole="button" accessibilityLabel="Add a car">
          <Text style={styles.headerAction}>Add car</Text>
        </Pressable>
        <Pressable
          onPress={() => setAccountOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Account"
        >
          <Text style={styles.signOut}>Account</Text>
        </Pressable>
      </View>
    </View>
  );

  const primer = (
    <PushPrimer visible={primerOpen} onAccept={acceptPrimer} onDecline={declinePrimer} />
  );

  const account = (
    <AccountScreen
      visible={accountOpen}
      email={email}
      onClose={() => setAccountOpen(false)}
      onSignOut={() => {
        setAccountOpen(false);
        onSignOut();
      }}
      onDeleted={(summary) => {
        /*
          Order matters. The notice is set before the session is cleared,
          because clearing it unmounts this screen — showing the confirmation
          after would show it to nobody.
        */
        setDeletedNotice(summary);
        setAccountOpen(false);
        onSignOut();
      }}
    />
  );

  if (state.status === 'loading') {
    return (
      <View style={styles.stateScreen}>
        {header}
        {/*
          Shaped like the cards that are coming, not a spinner in the middle of
          an empty screen. A blank second on a cold fetch is indistinguishable
          from broken, and this is the first screen a reviewer opens.

          Two, because one reads as "a card is loading" and the list is a list.
        */}
        <View style={styles.loadingList}>
          <SkeletonCard lines={2} />
          <SkeletonCard lines={2} />
        </View>
        {account}
        {primer}
      </View>
    );
  }

  if (state.status === 'error') {
    return (
      <View style={styles.stateScreen}>
        {header}
        <View style={styles.centred}>
          <Text style={styles.errorTitle}>
            {state.unauthorized ? 'Signed out' : 'Could not load your garage'}
          </Text>
          <Text style={styles.errorBody}>
            {state.unauthorized ? 'Your session has expired. Sign in again.' : state.message}
          </Text>
          {/*
            `secondary`, not `primary`. Recovering from an error is the only
            thing to do on this screen, but filling the button in brand colour
            makes a failure state look like a call to action.
          */}
          <Button
            label={state.unauthorized ? 'Sign in' : 'Try again'}
            variant="outline"
            onPress={() => (state.unauthorized ? onSignOut() : void load())}
            style={styles.stateAction}
          />
        </View>
        {account}
        {primer}
      </View>
    );
  }

  return (
    <>
      {photoError && (
        /*
          Above the list rather than replacing it. A failed photo is a nuisance,
          not a state the garage has to stop for — and the most likely one, an
          oversized capture, is fixed by choosing a different picture right
          away. Cleared by trying again or by pulling to refresh.
        */
        <AlertBanner tone="critical" headline="That photo was not saved" body={photoError} />
      )}
      {deletedNotice && (
        /*
        Apple asks for confirmation that deletion actually happened, and this
        is the last thing the account's owner will ever see from the app — the
        session is cleared the moment they dismiss it, so there is nothing left
        to inspect afterwards. It names what went, rather than saying "done".
      */
        <View style={styles.deletedNotice}>
          <Text style={styles.deletedNoticeText}>{deletedNotice}</Text>
        </View>
      )}
      {/*
        ── The garage is a row of bays, swiped between ──────────────────────────

        A **vertical** scroller carrying the header and pull-to-refresh, with a
        **horizontal** paged scroller of bays inside it. Both directions are
        needed and a single list cannot give them: a horizontal `FlatList` puts
        its `ListHeaderComponent` to the *left* of the first item rather than
        above it, and `RefreshControl` only works on a vertical scroller.

        A paged `ScrollView` rather than a horizontal `FlatList`, deliberately.
        A garage is a handful of cars — virtualisation buys nothing at that size
        and costs the thing that matters here, which is that every bay is
        mounted and only the focused one animates. `active` is what gates the
        door and the needle; a virtualised list would instead have bays igniting
        as they scrolled into the window, which is three intros for one glance.
      */}
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load(true)}
            tintColor={text.muted}
          />
        }
        contentContainerStyle={styles.page}
      >
        {header}

        {state.vehicles.length === 0 ? (
          /*
            An empty garage has two readings, and they want different screens.

            Somebody who has never had a car here needs to be told what this is
            before being asked for one. Somebody who has used it and sold the
            car needs no introduction — greeting them with "Start with one car"
            would be the product forgetting them. `shouldShowFirstRun` decides,
            and `@crewchief/core/first-run` carries the argument for why the
            stored fact is "ever had a vehicle" rather than "seen onboarding".

            ⚠ `undefined` renders nothing rather than guessing. The answer is
            read off storage asynchronously, and either default would flash the
            wrong opening screen for a frame — the bare empty state ahead of the
            explanation, or the explanation at a year-old account.
          */
          hadVehicle === undefined ? null : shouldShowFirstRun({
            everHadVehicle: hadVehicle,
            vehicleCount: state.vehicles.length,
          }) ? (
            /*
              It replaces the body and not the screen. The header above carries
              Account, and hiding that from a brand-new user who wants to sign
              out — or delete the account they just made — is exactly the
              failure this screen's own header comment warns about: "an
              affordance placed in one branch of a screen that renders several".
            */
            <FirstRun onAddVehicle={onAddVehicle} />
          ) : (
            /*
              The returning case, and the copy is kept verbatim. It read "Add a
              car on the web and it will appear here" until 8 Aug — the
              mobile-first problem in one sentence, sending a new user to a
              different product to become a user at all, which a reviewer would
              hit before anything else.

              The action keeps its own spoken name because the header carries an
              "Add a car" control too, and two controls with the same name on
              one screen are ambiguous to a screen reader in a way they are not
              to the eye, which has position to go on.
            */
            <EmptyState
              headline="No vehicles yet"
              body="Add your first car and CrewChief gets to work on it."
              actionLabel="Add a car"
              actionAccessibilityLabel="Add your first car"
              onAction={onAddVehicle}
            />
          )
        ) : (
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            /*
              Momentum, not `onScroll`. The batten reads "BAY 02 · 2 of 3", and
              updating it mid-drag would have it flicker through every bay the
              finger passes rather than naming the one that was landed on.
            */
            onMomentumScrollEnd={(event) =>
              setBayIndex(Math.round(event.nativeEvent.contentOffset.x / width))
            }
          >
            {state.vehicles.map((vehicle, index) => (
              <View key={vehicle.id} style={{ width }}>
                <VehicleBay
                  vehicle={vehicle}
                  index={index}
                  total={state.vehicles.length}
                  active={index === bayIndex}
                  onOpen={() =>
                    onOpenVehicle(
                      vehicle.id,
                      [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') ||
                        'Vehicle',
                    )
                  }
                  onAddPhoto={pickPhoto ? () => void onAddPhoto(vehicle.id) : undefined}
                  uploading={uploadingId === vehicle.id}
                />
              </View>
            ))}
          </ScrollView>
        )}

        <DevToken token={accessToken} />
      </ScrollView>
      {account}
      {primer}
    </>
  );
}

const styles = StyleSheet.create({
  /*
    `flexGrow` so `ListEmptyComponent` has room to centre in — see its note.
    It changes nothing once there is a car, because content past one screen
    already exceeds the container.
  */
  /**
   * The vertical page the bays sit on.
   *
   * No horizontal padding — a paged scroller's pages must be exactly the screen
   * width or the paging lands off-centre, so the inset lives inside each bay
   * instead. `flexGrow` is what lets the empty state centre itself.
   */
  page: { paddingTop: 68, paddingBottom: space.lg, gap: space.md, flexGrow: 1 },
  bayFooter: { paddingHorizontal: space.lg, flexDirection: 'row' },
  loadingList: { gap: space.md },
  /* Loading and error draw the same header as the list, at the same inset. */
  stateScreen: { flex: 1, padding: space.lg, paddingTop: 68 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.lg,
    /*
      The header carries its own inset now. The page it sits on cannot: a paged
      horizontal scroller's pages have to be exactly the screen width, so the
      padding that used to live on the list's content container moved into the
      header and into each bay.
    */
    paddingHorizontal: space.lg,
  },
  heading: { ...type.editorial, color: text.primary, letterSpacing: -0.6 },
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  /*
    Brighter than `signOut`, because these two are not equals: adding a car is
    the thing this screen exists to lead to, and Account is somewhere you go
    occasionally. Both clear the 44pt target through `minHeight` and
    `lineHeight` alone — see the note at the call site for why `hitSlop` was
    removed rather than reduced.
  */
  headerAction: {
    color: text.secondary,
    ...type.value,
    fontFamily: interFace('600'), fontWeight: '600',
    minHeight: TARGET_MIN,
    lineHeight: TARGET_MIN,
  },
  signOut: {
    color: text.muted,
    ...type.value,
    minHeight: TARGET_MIN,
    lineHeight: TARGET_MIN,
  },
  deletedNotice: {
    position: 'absolute',
    top: 60,
    left: space.lg,
    right: space.lg,
    zIndex: 10,
    borderRadius: radius.card,
    backgroundColor: status.confirmFill,
    padding: space.md,
  },
  deletedNoticeText: { ...type.body, color: text.primary },

  /*
    A real surface step, not a 5%-white wash.

    This card used to be `rgba(255,255,255,0.05)` over the page background,
    which composites to roughly two values away from it — so the cards barely
    separated from the page and the whole list read as flat. `surface.card` is
    the designed step, and the border can stay subtle because the fill is now
    doing the work.
  */




  centred: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.h1,
    gap: space.sm,
  },
  errorTitle: { ...type.title, color: text.primary },
  errorBody: { ...type.body, color: text.muted, textAlign: 'center' },
  /*
    Not stretched. These sit under centred text in a column that is as wide as
    the screen, and a full-bleed button under two centred lines reads as a form
    submit rather than an offer.
  */
  stateAction: { marginTop: space.md, paddingHorizontal: space.xxl },

  devBlock: { marginTop: space.xxl, gap: space.xs },
  devHeading: { ...type.label, color: text.muted, textTransform: 'uppercase' },
  // Monospaced and small: a JWT is long, and it has to select as one run of
  // text rather than reflow into something that copies back broken.
  devToken: {
    color: text.secondary,
    fontSize: 10,
    fontFamily: 'Courier',
    marginTop: space.xs,
    padding: space.sm,
    borderRadius: radius.well,
    backgroundColor: surface.well,
  },
});
