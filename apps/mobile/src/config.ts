import Constants from 'expo-constants';

/**
 * Where the app talks to.
 *
 * **Not localhost, and it cannot be.** The dev server runs on the Mac; the app
 * runs on a phone. `localhost` on the phone is the phone. Pointing at the
 * Mac's LAN address works until the address changes, which on a home network
 * is whenever the router feels like it — so the default is a deployment.
 *
 * The **preview**, not the public demo. The preview serves `main`, which is
 * where the v1 routes are. The demo deliberately lags behind it (promotion is
 * a separate step, `cc-product-0004`), and today it is several commits back
 * and does not have `/api/v1/consultant` at all.
 *
 * Overridable via `app.json` → `expo.extra.apiBaseUrl` so pointing at a LAN
 * address for a session is a config change and not a code change.
 */
export const API_BASE_URL: string =
  (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ??
  'https://effulgent-blancmange-6adfdf.netlify.app';

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
