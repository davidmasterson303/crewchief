import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { apiRequest, ApiRequestError } from '../api/client';
import Button from '../components/Button';
import Chip from '../components/Chip';
import ClusterGauge from '../components/ClusterGauge';
import VehiclePlate from '../components/VehiclePlate';
import Logo from '../components/Logo';
import { SkeletonCard } from '../components/Skeleton';
import { border, radius, space, status, surface, text, type, TARGET_MIN } from '../theme';
import { AccountScreen } from './AccountScreen';
import { PushPrimer } from '../notifications/PushPrimer';
import {
  currentPushPermission,
  primerDismissedOn,
  recordPrimerDismissed,
  registerForPush,
} from '../notifications/register';
import { shouldShowPushPrimer } from '@crewchief/core/push-priming';
import { getHealthBandJudgement } from '@crewchief/core/health-band';

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

function VehicleCard({
  vehicle,
  onOpen,
}: {
  vehicle: Vehicle;
  /*
    A callback, not a `navigation` prop. This screen stays ignorant of
    react-navigation so it remains an ordinary component — the navigator is the
    only file that knows how a route is reached.
  */
  onOpen: () => void;
}) {
  /*
    The photo lifecycle moved into `VehiclePlate` — the timeout, the two exits
    from loading, and the fallback are all properties of showing a photograph on
    a plate rather than of this card, and vehicle detail's 196pt hero needs the
    identical behaviour.
  */

  const health = first(vehicle.vehicle_health_summary);
  const score = typeof health?.health_score === 'number' ? health.health_score : null;
  const band = score === null ? null : getHealthBandJudgement(score);

  const recalls = first(vehicle.nhtsa_data)?.recalls;
  const recallCount = Array.isArray(recalls) ? recalls.length : 0;

  const name = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ');

  return (
    <Pressable
      style={styles.card}
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`${name || 'Vehicle'}, open details`}
    >
      {/*
        The identity plate — CC-142, finally on the phone.

        This replaced a grey box reading "No photo". That was a placeholder
        naming an absence, so a garage of unphotographed cars read as a garage
        of incomplete records; the plate is a finished design for the same
        state. See `VehiclePlate` for why the two halves only work together.
      */}
      <VehiclePlate
        photo={vehicle.photo_url}
        year={vehicle.year}
        make={vehicle.make}
        model={vehicle.model}
        trim={vehicle.trim}
      />

      <View style={styles.cardBody}>
        <View style={styles.cardHeader}>
          <View style={styles.cardTitleBlock}>
            <Text style={styles.name} numberOfLines={1}>
              {name || 'Vehicle'}
            </Text>
            {vehicle.trim ? (
              <Text style={styles.trim} numberOfLines={1}>
                {vehicle.trim}
              </Text>
            ) : null}
          </View>

          {band && score !== null ? (
            /*
              The row scale of the health instrument — step 4.

              Not a small dial. Under `DIAL_MIN` the ticks stop resolving and an
              instrument that cannot be read is decoration, so the row is a
              numeral and a verdict and nothing else. `ClusterGauge` owns that
              judgement now, which also retires two things this card was doing
              by hand: an 11pt band label that sat **under the 12pt type floor**,
              and a second local opinion about how a score is presented.
            */
            <ClusterGauge score={score} variant="row" />
          ) : (
            /*
              No score is not a zero. Banding a missing value would paint the
              card red and assert a condition nobody measured — the same
              overclaim the provenance work removed from the web this morning.
            */
            <Text style={styles.noScore}>No score yet</Text>
          )}
        </View>

        <View style={styles.metaRow}>
          {typeof vehicle.current_mileage === 'number' ? (
            <Text style={styles.meta}>{miles.format(vehicle.current_mileage)} mi</Text>
          ) : null}
          {vehicle.vehicle_status ? (
            <Text style={styles.meta}>{humanise(vehicle.vehicle_status)}</Text>
          ) : null}
          {recallCount > 0 ? (
            <Chip label={`${recallCount} recall${recallCount === 1 ? '' : 's'}`} tone="critical" />
          ) : null}
        </View>
      </View>
    </Pressable>
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
}: {
  accessToken: string;
  email: string | null;
  onSignOut: () => void;
  /** Title travels with the id so the detail header is right during the fetch. */
  onOpenVehicle: (vehicleId: string, title: string) => void;
  onAddVehicle: () => void;
}) {
  /*
    App Store 5.1.1(v). The account surface is one tap from here because the
    guideline requires deletion to be genuinely available rather than buried —
    and this is the only screen a signed-in user sees, so "buried" would be any
    number of taps greater than one.
  */
  const [accountOpen, setAccountOpen] = useState(false);
  const [deletedNotice, setDeletedNotice] = useState<string | null>(null);
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'ok'; vehicles: Vehicle[] }
    | { status: 'error'; message: string; unauthorized: boolean }
  >({ status: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
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
        <Pressable
          onPress={onAddVehicle}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Add a car"
        >
          <Text style={styles.headerAction}>Add car</Text>
        </Pressable>
        <Pressable
          onPress={() => setAccountOpen(true)}
          hitSlop={12}
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
      <FlatList
        data={state.vehicles}
        keyExtractor={(v) => v.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <VehicleCard
            vehicle={item}
            onOpen={() =>
              onOpenVehicle(
                item.id,
                [item.year, item.make, item.model].filter(Boolean).join(' ') || 'Vehicle',
              )
            }
          />
        )}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load(true)}
            tintColor={text.muted}
          />
        }
        ListHeaderComponent={header}
        ListEmptyComponent={
          /*
          An account with no cars is the ordinary first-run state, not a
          failure — so it says what to do next rather than apologising.

          It sits in its own centring view because `styles.centred` is
          `flex: 1`, and a flex child of a FlatList's content container has no
          height to fill unless that container grows: `contentContainerStyle`
          carries `flexGrow: 1` for exactly this. Without it the first thing a
          new user ever sees is three lines crushed under the title.
        */
          <View style={styles.centred}>
            <Text style={styles.errorTitle}>No vehicles yet</Text>
            {/*
            This read "Add a car on the web and it will appear here." — the
            mobile-first problem in one sentence. A new user's first screen sent
            them to a different product to become a user at all, which an App
            Store reviewer would have hit before anything else.
          */}
            <Text style={styles.errorBody}>
              Add your first car and CrewChief gets to work on it.
            </Text>
            {/*
            `primary` here and `secondary` on the error screen above, and the
            difference is the point: this is the one thing a new account should
            do, and it is the only filled button on the first screen they meet.
          */}
            <Button
              label="Add a car"
              /*
              The header carries an "Add a car" control too. Two buttons with
              the same spoken name on one screen is ambiguous to a screen reader
              in a way it is not to the eye, which can use position — so this
              one is named for where it is.
            */
              accessibilityLabel="Add your first car"
              onPress={onAddVehicle}
              style={styles.stateAction}
            />
          </View>
        }
        ListFooterComponent={<DevToken token={accessToken} />}
      />
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
  list: { padding: space.lg, paddingTop: 68, gap: space.md, flexGrow: 1 },
  loadingList: { gap: space.md },
  /* Loading and error draw the same header as the list, at the same inset. */
  stateScreen: { flex: 1, padding: space.lg, paddingTop: 68 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.lg,
  },
  heading: { ...type.editorial, color: text.primary, letterSpacing: -0.6 },
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  /*
    Brighter than `signOut`, because these two are not equals: adding a car is
    the thing this screen exists to lead to, and Account is somewhere you go
    occasionally. Both clear the 44px target through `minHeight` plus `hitSlop`.
  */
  headerAction: {
    color: text.secondary,
    ...type.value,
    fontWeight: '600',
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
  card: {
    backgroundColor: surface.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: border.panel,
    overflow: 'hidden',
  },

  cardBody: { padding: space.lg, gap: space.sm },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: space.md,
  },
  cardTitleBlock: { flex: 1 },
  name: { ...type.title, color: text.primary },
  trim: { ...type.value, color: text.muted, marginTop: 2 },

  noScore: { ...type.value, fontSize: 12, color: text.muted },

  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  meta: { ...type.value, color: text.muted },
  recall: { ...type.value, color: status.attention, fontWeight: '600' },

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
