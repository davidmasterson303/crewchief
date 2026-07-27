/**
 * Authorization posture — the Phase 0 ratchet.
 *
 * @jest-environment node
 *
 * The service-role client bypasses RLS completely. Any code path that reaches
 * for it without first proving the caller owns the data is an authorization
 * hole, whether it lives in an API route or a server action. Server actions
 * matter just as much as routes: Next.js compiles them into POST endpoints
 * whose action IDs ship in the client bundle, so they are remotely callable.
 *
 * This suite is a static analysis, not a behavioural test. It exists because
 * every hole found in Phase 0 was invisible to a route-level grep — the worst
 * of them sat inside a server action that an unauthenticated request could
 * still reach.
 *
 * HOW THE RATCHET WORKS
 *   - A new unauthorized service-role caller fails the build immediately.
 *   - Already-known offenders live in PENDING_AUTHORIZATION and are tolerated.
 *   - That list may only ever SHRINK. Fix one, delete its entry. If an entry
 *     is fixed but left in the list, the suite fails too, so it cannot drift
 *     out of date.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findRouteFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) findRouteFiles(full, acc);
    else if (entry === 'route.ts') acc.push(full.replace(ROOT + '/', ''));
  }
  return acc;
}

const USES_SERVICE_ROLE = /getServiceRoleClient\s*\(/;

/**
 * `requireSession` is the weaker guarantee — authenticated, but not tied to a
 * vehicle. It counts, because the alternative for those actions is being open
 * to the internet, but prefer `authorizeVehicleAccess` wherever a vehicle is
 * in scope.
 */
const PROVES_OWNERSHIP =
  /authorizeVehicle(Access|ScopedRow)|requireSession\s*\(|auth\.getUser\s*\(\)/;

interface Fn {
  name: string;
  body: string;
}

function exportedActions(source: string): Fn[] {
  const lines = source.split('\n');
  const starts: { name: string; line: number }[] = [];

  lines.forEach((line, i) => {
    const match = line.match(/^export async function (\w+)/);
    if (match) starts.push({ name: match[1], line: i });
  });

  return starts.map((start, idx) => ({
    name: start.name,
    body: lines
      .slice(start.line, idx + 1 < starts.length ? starts[idx + 1].line : lines.length)
      .join('\n'),
  }));
}

// ---------------------------------------------------------------------------
// Registries
// ---------------------------------------------------------------------------

/**
 * Every API route and its declared posture. A route missing from here fails
 * the suite — you cannot add an endpoint without stating how it is protected.
 *
 *   'vehicle-scoped' — must go through lib/api-auth
 *   'session'        — must call auth.getUser() directly
 *   'public'         — deliberately unauthenticated; justify in the comment
 */
const ROUTE_POSTURE: Record<string, 'vehicle-scoped' | 'session' | 'public'> = {
  'app/api/vehicles/route.ts': 'session',
  'app/api/load-vehicle/route.ts': 'vehicle-scoped',
  'app/api/load-maintenance-data/route.ts': 'vehicle-scoped',
  'app/api/wishlist/route.ts': 'vehicle-scoped',
  'app/api/wishlist/check/route.ts': 'vehicle-scoped',
  'app/api/wishlist/complete/route.ts': 'vehicle-scoped',
  'app/api/performance-stats/route.ts': 'vehicle-scoped',
  'app/api/delete-maintenance-item/route.ts': 'vehicle-scoped',
  // Both delegate to server actions in app/actions.ts, which authorize there.
  'app/api/upload-document/route.ts': 'vehicle-scoped',
  'app/api/consultant/upload-document/route.ts': 'vehicle-scoped',
  /*
    Returns the commit SHA this deployment was built from — a public repo's
    public commit id, and nothing else. No database, no session, no service
    role. It has to be reachable unauthenticated because the thing asking is
    scripts/promote-demo.mjs, checking from outside that a deploy actually
    landed before the demo domain is moved onto it.
  */
  'app/api/version/route.ts': 'public',
  /*
    Reports whether this deployment's Gemini credential works. Public for the
    same reason as /api/version: the thing asking is a deploy script checking
    from outside, before the demo domain is moved onto a build.

    It touches no database, no session and no service role, takes no user input,
    and returns no part of the credential — only whether Google accepted it.
    It lists models rather than generating anything, so it cannot be turned into
    a way to spend tokens; see the route for why that distinction matters here.
  */
  'app/api/health/ai/route.ts': 'public',
};

/**
 * Server actions that touch the service role but legitimately need no
 * vehicle-scoped check. Keep this list very short and justify each entry.
 */
const EXEMPT_ACTIONS = new Set<string>([
  // Reads only the three seeded demo vehicles, which are public by design.
  'fetchDemoVehicles',
  // Misleading name: filters .eq('is_demo', true), so it returns demo
  // vehicles only and leaks nothing. Worth renaming — it reads like a
  // cross-tenant query and invites someone to "fix" the filter away.
  'fetchAllVehicles',
]);

/**
 * Known-unauthorized service-role callers, inherited from before Phase 0.
 *
 * **This list is now empty. All 63 have been fixed.**
 *
 * THIS LIST MAY ONLY SHRINK — adding an entry is not a way to make a failing
 * build pass. If a new action needs the service role, give it
 * `authorizeVehicleAccess`, `authorizeVehicleScopedRow`, or at minimum
 * `requireSession`, and leave this empty.
 *
 * For the record, the backlog it once held ran to 63 exported actions, every
 * one reachable by an unauthenticated caller because Next.js compiles server
 * actions into POST endpoints. The worst were `deleteVehicle` (destroyed any
 * vehicle by id, cascading through every child table), `fetchVehicleById` and
 * `fetchDashboardData` (full reads of any vehicle), and ten Gemini-backed
 * actions that spent budget on request. All are fixed and covered above.
 */
const PENDING_AUTHORIZATION = new Set<string>([]);

// ---------------------------------------------------------------------------

describe('API routes', () => {
  const routes = findRouteFiles(join(ROOT, 'app', 'api'));

  it('finds routes to check', () => {
    expect(routes.length).toBeGreaterThan(0);
  });

  it('every route declares an auth posture', () => {
    const undeclared = routes.filter((r) => !(r in ROUTE_POSTURE));
    expect(undeclared).toEqual([]);
  });

  it('has no stale registry entries for deleted routes', () => {
    const stale = Object.keys(ROUTE_POSTURE).filter((r) => !routes.includes(r));
    expect(stale).toEqual([]);
  });

  it.each(routes)('%s proves authorization before using the service role', (route) => {
    const source = readFileSync(join(ROOT, route), 'utf8');
    if (!USES_SERVICE_ROLE.test(source)) return;
    if (ROUTE_POSTURE[route] === 'public') return;

    expect(PROVES_OWNERSHIP.test(source)).toBe(true);
  });
});

describe('server actions', () => {
  const source = readFileSync(join(ROOT, 'app', 'actions.ts'), 'utf8');
  const actions = exportedActions(source);

  const unauthorized = actions
    .filter((fn) => USES_SERVICE_ROLE.test(fn.body) && !PROVES_OWNERSHIP.test(fn.body))
    .map((fn) => fn.name);

  it('parses the action surface', () => {
    expect(actions.length).toBeGreaterThan(50);
  });

  it('introduces no NEW unauthorized service-role caller', () => {
    const created = unauthorized.filter(
      (name) => !PENDING_AUTHORIZATION.has(name) && !EXEMPT_ACTIONS.has(name)
    );
    expect(created).toEqual([]);
  });

  it('keeps the pending list honest — no already-fixed entries left behind', () => {
    // Array.from rather than spread: tsconfig targets below es2015, where
    // spreading a Set does not downlevel.
    const alreadyFixed = Array.from(PENDING_AUTHORIZATION).filter(
      (n) => !unauthorized.includes(n)
    );
    expect(alreadyFixed).toEqual([]);
  });

  it('ratchets down — the backlog never grows', () => {
    // Lower this number as actions are fixed. It must never be raised.
    expect(PENDING_AUTHORIZATION.size).toBeLessThanOrEqual(0);
  });
});

/*
 * The demo path must stay reachable.
 *
 * `sendConsultantMessage` asked authorizeVehicleAccess for `intent: 'write'`
 * unconditionally. Demo vehicles are denied any write, so **every consultant
 * message on a demo vehicle returned an error** — the demo's headline feature,
 * advertised on the portfolio as live, dead in production. It passed the type
 * check, the whole suite, `verify-demo.mjs` and the promote gate, because none
 * of them exercised the demo path.
 *
 * These are static assertions rather than a live round-trip on purpose: the
 * network half is covered by /api/health/ai, and this half needs no network to
 * be caught. The point is that the *shape* of the regression is now visible
 * without deploying.
 */
describe('demo consultant path', () => {
  const actionsSource = readFileSync(join(ROOT, 'app/actions.ts'), 'utf8');

  function sendConsultantMessageBody(): string {
    const start = actionsSource.indexOf('export async function sendConsultantMessage');
    expect(start).toBeGreaterThan(-1);
    // Far enough to cover the authorization block and the demo guard.
    return actionsSource.slice(start, start + 12000);
  }

  it('does not ask for write access on a demo vehicle', () => {
    const body = sendConsultantMessageBody();

    // The intent must be conditional. An unconditional write is the regression.
    expect(body).toMatch(/intent:\s*isDemoVehicle\s*\?\s*'read'\s*:\s*'write'/);
    expect(body).not.toMatch(/authorizeVehicleAccess\([^)]*\{\s*intent:\s*'write'\s*\}/);
  });

  it('derives demo status server-side, never from the client payload', () => {
    const body = sendConsultantMessageBody();

    // params.isDemo is client-supplied. Using it for the intent would let a
    // caller downgrade the check on a real vehicle; using it for the
    // persistence guard would let one write to demo data with the service role.
    expect(body).toMatch(/const isDemoVehicle = isDemoVehicleId\(params\.vehicleId\)/);
    expect(body).toMatch(/if \(!isDemoVehicle\) \{/);
    expect(body).not.toMatch(/if \(!isDemo\) \{/);
  });

  it('keeps demo vehicles read-only in the authorization helper', () => {
    // The other half of the contract: relaxing the consultant's intent must not
    // have relaxed what a demo vehicle is allowed to do.
    const apiAuth = readFileSync(join(ROOT, 'lib/api-auth.ts'), 'utf8');
    expect(apiAuth).toMatch(/isDemoVehicleId\(vehicleId\)/);
    expect(apiAuth).toMatch(/intent === 'write'/);
    expect(apiAuth).toMatch(/Demo vehicles are read-only/);
  });
});
