import Constants from 'expo-constants';

/**
 * Where the app talks to.
 *
 * **Not localhost, and it cannot be.** The dev server runs on the Mac; the app
 * runs on a phone. `localhost` on the phone is the phone. Pointing at the
 * Mac's LAN address works until the address changes, which on a home network
 * is whenever the router feels like it — so the default is a deployment.
 *
 * The site serving `main`, not the public demo. That is where the v1 routes
 * are; the demo deliberately lags behind it (promotion is a separate step,
 * `cc-product-0004`) and may not carry a route this app depends on.
 *
 * ⚠ **This became a real hostname on 17 Aug** — `crewchief.davidmasterson.co`,
 * on its own Let's Encrypt certificate, replacing
 * `effulgent-blancmange-6adfdf.netlify.app`. The old host still answers 200 and
 * does **not** redirect, so nothing broke in the swap; it was changed because
 * the App Store listing and every in-app legal link are built from this value,
 * and a generated preview name is not what should appear in either.
 *
 * ⚠ It is the same site, so the change inherits a consequence worth stating:
 * that host was a throwaway CI target nobody visited, and it is now a
 * user-facing surface. Anything decided on the premise "nobody visits it" —
 * build suppression, deploy noise, what is safe to push to `main` — needs
 * re-reading against that.
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
