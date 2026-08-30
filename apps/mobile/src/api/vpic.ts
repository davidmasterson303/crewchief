import {
  VPIC_VEHICLE_TYPES,
  parseVpicDecode,
  parseVpicModels,
  vpicDecodeUrl,
  vpicModelsUrl,
  type DecodedVin,
} from '@wellkept/core/vehicle-catalog';

/**
 * NHTSA's vehicle catalogue, called from the phone.
 *
 * ── ⚠ This is the one place the app talks to something that is not Well Kept ─
 *
 * `api/client.ts` opens by saying it is "the only way this app talks to
 * Well Kept", and it still is. This is a different sentence: vPIC is a public,
 * unauthenticated, read-only US government API, and nothing about a Well Kept
 * account is sent to it. The request carries a make and a model year, or a VIN
 * the owner has just typed and has not yet saved anywhere.
 *
 * ── Why it is not proxied through `/api/v1`, which was the obvious build ────
 *
 * A route would give one place to cache and one place to rate-limit, and both
 * are real. It also would not exist yet: `CLAUDE.md` §8 is explicit that a
 * mobile build depending on a new `/api/v1/*` route has to wait for a
 * **`web-live` promote**, because `main` deploys nowhere and the app talks to
 * `crewchief.davidmasterson.co`. A build shipped ahead of that promote calls an
 * endpoint that is not there and 404s on a path that works perfectly on `main`
 * — the most confusing shape a bug has.
 *
 * Going direct makes this feature a JS-only change: free on the EAS budget,
 * and shippable without moving a release branch that publishes the API live
 * apps depend on.
 *
 * ⚠ **What that costs, written down rather than discovered later:** the VIN is
 * decoded but **not stored**. `POST /api/v1/vehicles` reads `year`, `make`,
 * `model`, `trim` and mileage and constructs its insert from those alone — it
 * has no `vin` field — so a car added this way carries no VIN in the database.
 * The decode is a *typing aid* today. Giving the column a value is a route
 * change and therefore a promote, and it is worth doing; it is deliberately not
 * smuggled into this one.
 *
 * ── Failure is quiet here, and that is a decision ───────────────────────────
 *
 * Every function returns an empty result rather than throwing. A model list
 * that will not load must degrade to the free-text field the form has always
 * had — the suggestions are an accelerator, and an accelerator that can block
 * the form is worse than no accelerator. `decodeVin` is the one exception in
 * spirit: it returns `null`, and its caller says so, because somebody who typed
 * seventeen characters is owed an answer about them.
 */

/**
 * Shorter than `api/client.ts`'s 20 seconds, on purpose.
 *
 * This is a lookup somebody is waiting on with a keyboard open, and the fallback
 * — type it yourself — is always available. Twenty seconds of spinner in front
 * of a field they could have filled in five is the worse outcome.
 */
const VPIC_TIMEOUT_MS = 8_000;

async function readJson(url: string, signal?: AbortSignal): Promise<unknown | null> {
  const controller = new AbortController();
  const abandon = setTimeout(() => controller.abort(), VPIC_TIMEOUT_MS);

  /*
    The caller's cancellation and our own timeout are two separate reasons to
    stop, and both have to reach one request. A screen that abandons a stale
    keystroke must not be left waiting on the timeout as well.
  */
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    return (await response.json()) as unknown;
  } catch {
    // Offline, aborted, timed out or handed something that is not JSON. None of
    // them are distinguishable to the caller's next decision, which is the same
    // either way: fall back to what the owner types.
    return null;
  } finally {
    clearTimeout(abandon);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Every model a make built in a model year.
 *
 * ⚠ **Three requests, unioned, and that is not laziness.** `GetModelsForMakeYear`
 * with no vehicle type returns everything the marque builds — asked for BMW in
 * 2015 it answers 56 models, 19 of them motorcycles. Filtering to `car` drops
 * the bikes and takes every SUV with them: X3, X4, X5 and X6 appear under `mpv`
 * and under no other type. Verified against the live API on 23 Aug 2026, not
 * assumed.
 *
 * They run in parallel, so the wait is one request's, and a type that fails
 * contributes nothing rather than failing the set — a partial list is a working
 * typeahead, and an empty one is still a working text field.
 */
export async function fetchModels(
  make: string,
  year: number,
  signal?: AbortSignal
): Promise<string[]> {
  if (!make.trim() || !Number.isInteger(year)) return [];

  const responses = await Promise.all(
    VPIC_VEHICLE_TYPES.map((type) => readJson(vpicModelsUrl(make, year, type), signal))
  );

  const names = new Set<string>();
  for (const body of responses) {
    for (const name of parseVpicModels(body)) names.add(name);
  }

  return Array.from(names).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}

/**
 * What a VIN says the car is, or `null` when nothing could be read off it.
 *
 * `null` covers a network failure and a VIN NHTSA cannot place, deliberately
 * together: the caller's honest sentence is the same for both, and inventing a
 * distinction the owner cannot act on differently is noise. A VIN NHTSA
 * *complains* about but still decodes comes back populated with
 * `confidence: 'suspect'` — see `parseVpicDecode` for why that is kept.
 */
export async function decodeVin(vin: string, signal?: AbortSignal): Promise<DecodedVin | null> {
  const body = await readJson(vpicDecodeUrl(vin), signal);
  return body ? parseVpicDecode(body) : null;
}
