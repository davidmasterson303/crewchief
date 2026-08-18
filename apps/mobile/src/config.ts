import Constants from 'expo-constants';

/**
 * Where the app talks to.
 *
 * **Not localhost, and it cannot be.** The dev server runs on the Mac; the app
 * runs on a phone. `localhost` on the phone is the phone. Pointing at the
 * Mac's LAN address works until the address changes, which on a home network
 * is whenever the router feels like it — so the default is a deployment.
 *
 * ⚠ **This is a gated hostname, and that inverts a rule this file used to
 * state.** It said the app must point at the site serving `main`, because the
 * demo lagged and might not carry a route the app depends on. That was right
 * while this value was a throwaway CI host. It is wrong now that the same URL
 * is the App Store listing's privacy-policy address and the origin every
 * installed copy of the app talks to: a store app must not have its backend
 * change on every push to `main`.
 *
 * So `crewchief.davidmasterson.co` is served by the project building
 * **`web-live`**, which only moves when someone merges `main` into it.
 *
 * ⚠ **`web-live`, not `demo-live`** — an earlier version of this note said
 * `demo-live` and was wrong for a day. They are two gates on the same
 * repository and they exist for different reasons: `demo-live` paces the
 * recruiter-facing demo, `web-live` paces the app's backend and the App Store
 * hostname. Collapsing them would mean promoting the demo to show someone a new
 * screen also moved the API under every installed app.
 *
 * **The consequence, and it is a workflow rule rather than a caveat: a mobile
 * build that needs a new `/api/v1/*` route must have that route promoted
 * first.** Ship the app against an unpromoted endpoint and it calls something
 * that is not there yet — a 404 on a path that exists perfectly well on `main`,
 * which is the most confusing shape a bug can take.
 *
 * ⚠ **This became a real hostname on 17 Aug** — `crewchief.davidmasterson.co`,
 * on its own Let's Encrypt certificate, replacing
 * `effulgent-blancmange-6adfdf.netlify.app`, because the App Store listing and
 * every in-app legal link are built from this value and a generated preview
 * name is not what belongs in either.
 *
 * That swap also promoted a throwaway CI target into a user-facing surface, and
 * everything decided on the premise "nobody visits it" — build suppression,
 * deploy noise, what is safe to push to `main` — had to be re-read against it.
 * Gating the hostname is the answer to the largest of those.
 *
 * Overridable via `app.json` → `expo.extra.apiBaseUrl` so pointing at a LAN
 * address for a session is a config change and not a code change.
 */
export const API_BASE_URL: string =
  (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ??
  /*
    The fallback is kept in step with `app.json` deliberately. It only fires if
    `extra` is missing entirely — a broken config — and a fallback pointing
    somewhere else would send that build to a different origin while looking
    like it worked.
  */
  'https://crewchief.davidmasterson.co';

/**
 * Every request the app makes goes through the versioned API.
 *
 * Stated as a constant rather than as a convention, because the convention is
 * the one this project has already broken once: `VehicleCard` queried Supabase
 * directly from the web client and shipped an unauthorized delete. The mobile
 * client has no Supabase table access at all — enforced by a test, not
 * remembered — and this is the only door.
 */
export const API_PREFIX = '/api/v1';
