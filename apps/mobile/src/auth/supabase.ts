import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';

import { secureStorage } from './secure-storage';

/**
 * The Supabase client, and the narrow job it is allowed to do.
 *
 * ── This client authenticates. It does not read data. ───────────────────────
 *
 * Every byte of vehicle data the app shows comes through `/api/v1`, because
 * that is where authorization lives — `lib/api-auth.ts` on the server, one
 * implementation, already tested. A mobile client querying tables directly
 * would be a second answer to "who may see this", and this project has already
 * paid for that once: `VehicleCard` queried Supabase from the browser and
 * shipped an unauthorized delete, fixed on 30 Jul.
 *
 * So there is no `.from()` anywhere in this app, and that is enforced by
 * `lib/__tests__/mobile-api-only.test.ts` rather than remembered. (This line
 * previously named `src/__tests__/no-direct-table-access.test.ts`, which has
 * never existed — a citation of a guard that was not there, which is worse than
 * no citation at all.)
 *
 * What it *is* for: minting and refreshing a session. The server's bearer path
 * (`resolveCaller`) validates tokens against the Supabase auth server, so the
 * token has to be a genuine Supabase one — there is no way to obtain that
 * except by talking to Supabase auth.
 *
 * ── Configuration ───────────────────────────────────────────────────────────
 *
 * The URL and publishable key are the same public values the web bundle ships;
 * they identify the project and grant nothing on their own. They come from
 * `app.json` so pointing at a different project is config, not code.
 *
 * `detectSessionInUrl` is off because there is no URL bar to read a token out
 * of — that option exists for the browser's OAuth redirect flow, and leaving it
 * on in React Native makes the client reach for `window.location`.
 */

const extra = Constants.expoConfig?.extra ?? {};

const SUPABASE_URL = extra.supabaseUrl as string | undefined;
const SUPABASE_PUBLISHABLE_KEY = extra.supabasePublishableKey as string | undefined;

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  /*
    Thrown at import, deliberately. A client built from undefined config fails
    later with an opaque network error, at which point the obvious suspect is
    the network. Failing here names the actual problem.
  */
  throw new Error(
    'Missing Supabase config. Set expo.extra.supabaseUrl and expo.extra.supabasePublishableKey in app.json.'
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: secureStorage,
    // Keep the session across app launches — the whole point of storing it.
    persistSession: true,
    /*
      Access tokens are short-lived by design. The web client refreshes them
      silently and a native client has to be told to; without this the app
      works for an hour and then starts 401-ing with a session that still looks
      present, which reads as a server bug from the phone.

      Refresh while backgrounded is handled separately — see `session.ts`.
    */
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});
