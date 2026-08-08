/**
 * Every `/api/v1` handler must accept a bearer token, not only a cookie.
 *
 * @jest-environment node
 *
 * `/api/v1` exists because a React Native client cannot call a Next server
 * action. It carries `Authorization: Bearer <jwt>` and **no cookies at all**, so
 * a handler that authenticates through `createServerActionClient()` — which
 * reads `next/headers` cookies and nothing else — returns 401 to the mobile app
 * while working perfectly in a browser.
 *
 * That is not hypothetical. It has now happened twice:
 *
 *   - `app/api/v1/vehicles/route.ts` — the garage endpoint the mobile app
 *     cannot work without. Fixed when the bearer path was built.
 *   - `app/api/v1/wishlist/route.ts` GET — found 7 Aug 2026 while building the
 *     mobile wishlist. POST and DELETE used the shared helpers and worked; GET
 *     did not, so the wishlist could be added to and deleted from but **never
 *     read**.
 *
 * ── Why `auth-posture.test.ts` did not catch the second one ─────────────────
 *
 * Because it asks whether a *file* authorizes correctly, and that file does —
 * `authorizeVehicleAccess` appears twice in it, just not in the GET handler.
 * File-level classification cannot see a single handler taking a different
 * path. This asks a narrower question with a cheaper answer: the cookie-only
 * client has no business anywhere under `/api/v1`, in any handler, ever.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const V1 = join(ROOT, 'app', 'api', 'v1');

/** Every `route.ts` under `/api/v1`, however deeply nested. */
function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return entry === 'route.ts' ? [full] : [];
  });
}

/**
 * Source with comments removed.
 *
 * `push-token-registration.test.ts` learned this three times over: a docblock
 * explaining why a route does *not* use something is good writing and a bad
 * substring. The route fixed today carries a comment naming
 * `createServerActionClient` precisely to record that it no longer calls it.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

const routes = routeFiles(V1).map((path) => ({
  rel: path.slice(ROOT.length + 1),
  code: code(readFileSync(path, 'utf8')),
}));

describe('the v1 surface', () => {
  it('has routes to check, so this file cannot pass vacuously', () => {
    // Guards the guard. A walk that silently found nothing would make every
    // assertion below trivially true.
    expect(routes.length).toBeGreaterThan(5);
  });

  it.each(routes.map((r) => r.rel))('%s does not construct the cookie-only client', (rel) => {
    const route = routes.find((r) => r.rel === rel)!;

    // `createServerActionClient()` reads next/headers cookies and nothing else.
    // A mobile caller has none. Use `authorizeVehicleAccess`, `requireCaller`
    // or `authorizeVehicleScopedRow` — all of which resolve either credential.
    expect(route.code).not.toMatch(/createServerActionClient\s*\(/);
  });

  it.each(routes.map((r) => r.rel))('%s does not authenticate with a bare auth.getUser()', (rel) => {
    const route = routes.find((r) => r.rel === rel)!;

    /*
      The other half of the same bug. A bare `auth.getUser()` proves the route
      authenticated *somebody*, which is what let the vehicles-route gap survive
      the posture ratchet — it could not see which credentials were accepted.

      `lib/api-auth.ts` is where this legitimately lives, and it is not a route.
    */
    expect(route.code).not.toMatch(/\.auth\s*\.\s*getUser\s*\(/);
  });
});
