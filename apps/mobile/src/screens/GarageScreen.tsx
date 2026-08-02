import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { apiRequest, ApiRequestError } from '../api/client';
import { getHealthBandJudgement, healthBandHex } from '@crewchief/core/health-band';

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
 * `healthBandHex` exists because React Native's StyleSheet has no `rgba()`
 * string form, so the shared `r,g,b` channels have to become a hex literal
 * somewhere. Somewhere is core, once, rather than here.
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

/** How long a photo may stay unresolved before the card gives up on it. */
const PHOTO_TIMEOUT_MS = 6000;

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

function VehicleCard({ vehicle }: { vehicle: Vehicle }) {
  /*
    ── Two exits from "loading", not one ──────────────────────────────────────

    A React Native `Image` pointed at a URL that never responds stays loading
    indefinitely. It draws nothing and `onError` never fires, because nothing
    has failed — so a fallback gated on failure is unreachable, and the card
    shows a blank rectangle the colour of itself, forever.

    That is not hypothetical. Measured on the simulator, 1 Aug: inside one
    render, a `fetch` of the API host returned 200 while a `fetch` of this
    vehicle's signed storage URL did not resolve within eight seconds. Same app,
    same network, same moment. The request hangs; it does not fail.

    Whatever the cause on the host side, a phone on a weak connection produces
    the identical shape, which makes it a product state rather than an
    environment quirk. So loading exits on an error *or* on running out of
    patience, and both land on the plate — a picture that has not arrived and a
    picture that does not exist look the same to the person holding the phone,
    and both mean "no photo".
  */
  const [photoFailed, setPhotoFailed] = useState(false);
  const [photoLoaded, setPhotoLoaded] = useState(false);
  const showPhoto = Boolean(vehicle.photo_url) && !photoFailed;

  useEffect(() => {
    if (!vehicle.photo_url || photoLoaded || photoFailed) return;
    const timer = setTimeout(() => setPhotoFailed(true), PHOTO_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [vehicle.photo_url, photoLoaded, photoFailed]);

  const health = first(vehicle.vehicle_health_summary);
  const score = typeof health?.health_score === 'number' ? health.health_score : null;
  const band = score === null ? null : getHealthBandJudgement(score);

  const recalls = first(vehicle.nhtsa_data)?.recalls;
  const recallCount = Array.isArray(recalls) ? recalls.length : 0;

  const name = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ');

  return (
    <View style={styles.card}>
      {showPhoto ? (
        <Image
          source={{ uri: vehicle.photo_url! }}
          style={styles.photo}
          resizeMode="cover"
          onLoad={() => setPhotoLoaded(true)}
          onError={() => setPhotoFailed(true)}
        />
      ) : (
        /*
          A car with no photograph is ordinary, and the web garage learned not
          to hide anything behind having one. The plate keeps the card's shape
          so a garage of mixed vehicles does not look ragged.
        */
        <View style={[styles.photo, styles.photoEmpty]}>
          <Text style={styles.photoEmptyText}>No photo</Text>
        </View>
      )}

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
            <View style={styles.healthBlock}>
              <Text style={[styles.score, { color: healthBandHex(band) }]}>{score}</Text>
              <Text style={[styles.bandLabel, { color: healthBandHex(band) }]}>{band.short}</Text>
            </View>
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
            <Text style={styles.recall}>
              {recallCount} recall{recallCount === 1 ? '' : 's'}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
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
        Long-press to select and copy. Set as MOBILE_TEST_TOKEN to run the
        credentialed contract checks.
      </Text>
      <Text selectable style={styles.devToken}>
        {token}
      </Text>
    </View>
  );
}

export function GarageScreen({
  accessToken,
  onSignOut,
}: {
  accessToken: string;
  onSignOut: () => void;
}) {
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'ok'; vehicles: Vehicle[] }
    | { status: 'error'; message: string; unauthorized: boolean }
  >({ status: 'loading' });
  const [refreshing, setRefreshing] = useState(false);

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

  if (state.status === 'loading') {
    return (
      <View style={styles.centred}>
        <ActivityIndicator color="rgba(255,255,255,0.5)" />
      </View>
    );
  }

  if (state.status === 'error') {
    return (
      <View style={styles.centred}>
        <Text style={styles.errorTitle}>
          {state.unauthorized ? 'Signed out' : 'Could not load your garage'}
        </Text>
        <Text style={styles.errorBody}>
          {state.unauthorized ? 'Your session has expired. Sign in again.' : state.message}
        </Text>
        <Pressable
          style={styles.button}
          onPress={() => (state.unauthorized ? onSignOut() : void load())}
        >
          <Text style={styles.buttonText}>{state.unauthorized ? 'Sign in' : 'Try again'}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <FlatList
      data={state.vehicles}
      keyExtractor={(v) => v.id}
      contentContainerStyle={styles.list}
      renderItem={({ item }) => <VehicleCard vehicle={item} />}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void load(true)}
          tintColor="rgba(255,255,255,0.5)"
        />
      }
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={styles.heading}>Garage</Text>
          <Pressable onPress={onSignOut} hitSlop={12}>
            <Text style={styles.signOut}>Sign out</Text>
          </Pressable>
        </View>
      }
      ListEmptyComponent={
        <View style={styles.centred}>
          <Text style={styles.errorTitle}>No vehicles yet</Text>
          <Text style={styles.errorBody}>
            Add a car on the web and it will appear here.
          </Text>
        </View>
      }
      ListFooterComponent={<DevToken token={accessToken} />}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: 20, paddingTop: 68, gap: 14 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  heading: { color: '#fff', fontSize: 30, fontWeight: '700', letterSpacing: -0.6 },
  signOut: { color: 'rgba(255,255,255,0.45)', fontSize: 14 },

  card: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    overflow: 'hidden',
  },
  photo: { width: '100%', height: 172, backgroundColor: 'rgba(255,255,255,0.04)' },
  photoEmpty: { alignItems: 'center', justifyContent: 'center' },
  photoEmptyText: { color: 'rgba(255,255,255,0.25)', fontSize: 13 },

  cardBody: { padding: 16, gap: 10 },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  cardTitleBlock: { flex: 1 },
  name: { color: '#fff', fontSize: 17, fontWeight: '600' },
  trim: { color: 'rgba(255,255,255,0.45)', fontSize: 13, marginTop: 2 },

  healthBlock: { alignItems: 'flex-end' },
  score: { fontSize: 24, fontWeight: '700', lineHeight: 26 },
  bandLabel: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.6 },
  noScore: { color: 'rgba(255,255,255,0.3)', fontSize: 12 },

  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  meta: { color: 'rgba(255,255,255,0.5)', fontSize: 13 },
  recall: { color: '#e0a468', fontSize: 13, fontWeight: '600' },

  centred: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 8 },
  errorTitle: { color: '#fff', fontSize: 17, fontWeight: '600' },
  errorBody: { color: 'rgba(255,255,255,0.45)', fontSize: 14, textAlign: 'center' },
  button: {
    marginTop: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: 9,
    paddingVertical: 11,
    paddingHorizontal: 22,
  },
  buttonText: { color: '#fff', fontSize: 14 },

  devBlock: { marginTop: 28, gap: 6 },
  devHeading: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  // Monospaced and small: a JWT is long, and it has to select as one run of
  // text rather than reflow into something that copies back broken.
  devToken: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 10,
    fontFamily: 'Courier',
    marginTop: 4,
    padding: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
});
