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
  /authorizeVehicle(Access|ScopedRow)|require(Session|Caller)\s*\(|auth\.getUser\s*\(\)/;

/**
 * Authorization that goes through the one module that owns it.
 *
 * `auth.getUser()` is in PROVES_OWNERSHIP above because server actions
 * legitimately use it, but it is a *weaker* signal than it looks: it proves a
 * route authenticated somebody, not which credentials it accepts. A route that
 * builds its own cookie client and calls `auth.getUser()` rejects every bearer
 * token — correct-looking, green in this suite, and unreachable from a native
 * client. That is exactly what `/api/v1/vehicles` did until 31 Jul.
 */
const USES_API_AUTH = /from ['"]@\/lib\/api-auth['"]/;

/**
 * True when a route resolves the caller itself instead of asking lib/api-auth.
 *
 * Pure and exported so it can be probed with a real violation rather than
 * trusted for being green — the same standard `findDelegationLeaks` is held to,
 * and for the same reason: the only other way to see this fire is to break a
 * live route's authorization and watch the suite go red.
 */
export function handRollsAuthentication(source: string): boolean {
  const resolvesCallerItself = /auth\.getUser\s*\(|createServerActionClient\s*\(/.test(source);
  return resolvesCallerItself && !USES_API_AUTH.test(source);
}

interface Fn {
  name: string;
  body: string;
}

interface LocatedFn extends Fn {
  file: string;
}

/**
 * Find exported actions that look clean but delegate the privileged work to an
 * unguarded function in another module.
 *
 * A pass-through defeats a per-function body scan: `return _doThing(x)`
 * contains no `getServiceRoleClient(` call, so the body reads as safe while
 * the service role is reached one module away. That is exactly how six
 * unguarded wishlist actions passed this suite for the whole of Phase 0.
 *
 * Pure, and takes its source reader as an argument, so the detector itself can
 * be tested against synthetic code. That matters here more than usual: the
 * only other way to prove this check fires is to strip a real authorization
 * guard and watch the suite go red, which is not a thing to do to a security
 * control on a whim.
 */
export function findDelegationLeaks(
  actions: LocatedFn[],
  readSource: (file: string) => string
): string[] {
  const leaks: string[] = [];

  for (const fn of actions) {
    // Skip the signature line so a function's own name cannot match.
    const delegate = /^\s*return (\w+)\(/m.exec(fn.body.split('\n').slice(1).join('\n'));
    if (!delegate) continue;

    const localName = delegate[1];

    // `import { realName as localName } from '...'` — the aliasing the
    // wrappers actually use.
    const aliased = new RegExp(`(\\w+) as ${localName}\\b`).exec(readSource(fn.file));
    const realName = aliased ? aliased[1] : localName;

    const target = actions.find((a) => a.name === realName && a.file !== fn.file);
    if (!target) continue;

    if (USES_SERVICE_ROLE.test(target.body) && !PROVES_OWNERSHIP.test(target.body)) {
      leaks.push(`${fn.file}:${fn.name} -> ${target.file}:${target.name}`);
    }
  }

  return leaks;
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
 *   'secret-gated'   — no user session, but a shared secret from the
 *                      environment. For routes that cost money to call and are
 *                      invoked by tooling rather than by people
 */
const ROUTE_POSTURE: Record<string, 'vehicle-scoped' | 'session' | 'public' | 'secret-gated'> = {
  'app/api/v1/vehicles/route.ts': 'session',
  /*
    Account deletion, App Store 5.1.1(v). 'session' rather than
    'vehicle-scoped': the resource is the caller themselves, so there is no
    vehicle to authorize and `requireSession` inside `deleteAccount` is the
    whole check. It resolves bearer tokens as well as cookies, which is why the
    route needs no auth code of its own.
  */
  'app/api/v1/account/route.ts': 'session',
  /*
    Push-token registration, Phase 5. 'session' for the same reason as
    `/api/v1/account`: the resource is the caller's own device, so there is no
    vehicle to authorize against and inventing one would be worse than having
    none. `requireCaller` resolves bearer tokens as well as cookies, which is
    what lets the phone register at all.
  */
  'app/api/v1/push-token/route.ts': 'session',
  'app/api/v1/load-vehicle/route.ts': 'vehicle-scoped',
  'app/api/v1/load-maintenance-data/route.ts': 'vehicle-scoped',
  'app/api/v1/wishlist/route.ts': 'vehicle-scoped',
  'app/api/v1/wishlist/check/route.ts': 'vehicle-scoped',
  'app/api/v1/wishlist/complete/route.ts': 'vehicle-scoped',
  'app/api/v1/performance-stats/route.ts': 'vehicle-scoped',
  'app/api/v1/delete-maintenance-item/route.ts': 'vehicle-scoped',
  // Both delegate to server actions in app/actions.ts, which authorize there.
  'app/api/v1/upload-document/route.ts': 'vehicle-scoped',
  'app/api/v1/consultant/upload-document/route.ts': 'vehicle-scoped',
  /*
    The three advisor routes (task 3.0.1). Each authorizes through lib/api-auth
    for the status code and then delegates to an action that authorizes again
    on its own account — see app/api/v1/consultant/route.ts for why that is two
    different jobs rather than one done twice.
  */
  'app/api/v1/consultant/route.ts': 'vehicle-scoped',
  'app/api/v1/consultant/conversations/route.ts': 'vehicle-scoped',
  'app/api/v1/consultant/conversations/[sessionId]/route.ts': 'vehicle-scoped',
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
  /*
    Asks the live consultant a real question and reads the answer, so unlike
    /api/health/ai it spends Gemini tokens on every call.

    That is exactly why it is not 'public'. A public endpoint that spends
    tokens on request is the unbounded-cost bug §3 records in
    `performance-stats`, where demo vehicles fell through to a model call on
    every anonymous page view. Per CREWCHIEF_ROUNDTRIP_GATE_DESIGN.md decision
    1, the endpoint is closed rather than the prompt made cheap — cost stops
    being a design problem once the caller must authenticate.

    'secret-gated' is a new category rather than the nearest existing label.
    Calling it 'public' would have been false, and 'session' would have been
    both false and useless, since the caller is promote-demo.mjs and a canary,
    neither of which has a user session.
  */
  'app/api/health/consultant/route.ts': 'secret-gated',
  /*
    The anonymous front door (Phase 2.97b, decision D9). It spends Gemini
    tokens on request, from an unauthenticated caller, on an uploaded image.

    **Read the entry directly above before accepting this one.** By that
    reasoning `/api/health/consultant` is secret-gated precisely because a
    public endpoint that spends tokens on request is the unbounded-cost bug
    this project has already shipped once. That reasoning is right, and it
    does not exempt this route — it sets the bar it has to clear.

    The difference is what the endpoint is *for*, and therefore what the fix
    can be. The consultant health check had no reason to be reachable by the
    public, so closing it cost nothing and "cost stops being a design problem
    once the caller must authenticate" was available. This route's entire
    product purpose is that a stranger with no account can use it — that is
    Phase 2.97, and closing it would delete the feature. So the cost problem
    cannot be dissolved by authentication and has to be *carried*, by controls
    built for it:

      - a global daily spend ceiling keyed on surface = 'anonymous', with a
        manual kill switch checked before it (D8, `lib/ai-budget.ts`);
      - per-IP bucketing on the platform-supplied address only, never a
        forwarded header (erratum T1, `packages/core/src/client-ip.ts`);
      - a set thinking level, unlike `parseInvoiceLineItems`, because default
        thinking on an anonymous endpoint is the money faucet 2.95a closed;
      - no dossier generation, ever (D6) — asserted as an absence in
        `front-door-gate.test.ts` and `quote-check.test.ts`;
      - bounded upload size and bounded pasted text.

    'public' is the honest label and it is the uncomfortable one. It is chosen
    over inventing a softer category because the exposure is real and should
    read as real every time someone opens this file. If the controls above are
    ever weakened, this entry is the thing that should stop them.
  */
  'app/api/v1/front-door/check/route.ts': 'public',
  /*
    Phase 2.97c — the seam where an anonymous session becomes an account, and
    the **only** authenticated route on the front-door path. Everything else
    there is deliberately open; this one moves rows onto a user id, so it has to
    know who is asking.

    `session` rather than `vehicle-scoped`: there is no vehicle. The rows being
    claimed were produced by someone with no account and no car on file, which
    is the entire premise of 2.97.

    **The authorization that matters here is not the session.** `requireSession`
    establishes *who* is claiming; what decides *what* they may claim is that
    the visitor id is read from the httpOnly `cc_fv` cookie and never from the
    request. Accepting an id from a body would let any signed-in user claim any
    visitor's scan by replaying an id — and ids appear in the database and in
    logs, so they are not secrets. There is no UPDATE policy on the table for
    `authenticated` either, so a client cannot reassign a row directly.
  */
  'app/api/v1/front-door/claim/route.ts': 'session',
};

/**
 * Server actions that touch the service role but legitimately need no
 * vehicle-scoped check. Keep this list very short and justify each entry.
 */
/*
  Qualified by file, not bare names. When these were bare, the exemption for
  app/actions.ts's demo-filtered `fetchAllVehicles` was silently also covering
  an identically-named function in lib/actions/vehicles.ts that had no filter
  at all and read every vehicle in the table. Same name, opposite behaviour,
  one exemption covering both. The dead file is now deleted, but the shape of
  that mistake is what the qualification prevents from recurring.
*/
const EXEMPT_ACTIONS = new Set<string>([
  // Reads only the three seeded demo vehicles, which are public by design.
  'app/actions.ts:fetchDemoVehicles',
  // Misleading name: filters .eq('is_demo', true), so it returns demo
  // vehicles only and leaks nothing. Worth renaming — it reads like a
  // cross-tenant query and invites someone to "fix" the filter away.
  'app/actions.ts:fetchAllVehicles',
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

  it.each(
    Object.entries(ROUTE_POSTURE)
      .filter(([, posture]) => posture === 'secret-gated')
      .map(([route]) => route)
  )('%s actually gates on a secret', (route) => {
    /*
      A posture label that nothing checks is decoration, and this codebase has
      shipped that three times — security.test.ts against a no-op middleware,
      rls-ownership.test.ts against a mock, tco-calculator.test.ts against a
      private copy. So 'secret-gated' has to earn the name.

      Asserted: the route reads a secret from the environment, compares what
      the caller presented, and fails closed when the secret is unset. That
      last one matters most — an unset secret meaning "open" on a route that
      spends Gemini tokens would be worse than having no gate.
    */
    const source = readFileSync(join(ROOT, route), 'utf8');

    expect(source).toMatch(/process\.env\.[A-Z_]*SECRET/);
    expect(source).toMatch(/headers\.get\(/);
    // Fails closed: there is a branch on the secret being absent.
    expect(source).toMatch(/if\s*\(!\s*secret\s*\)/);
  });

  it.each(
    Object.entries(ROUTE_POSTURE)
      .filter(([, posture]) => posture === 'session' || posture === 'vehicle-scoped')
      .map(([route]) => route)
  )('%s authenticates through lib/api-auth, not its own client', (route) => {
    /*
      Both postures mean "a credential decides who this is", and there is one
      module allowed to answer that — the whole argument in lib/api-auth's
      header. A route that hand-rolls it gets whichever credential types its
      own implementation happens to know about, which is how the garage list
      ended up cookie-only while the bearer path had shipped months earlier.

      Routes that delegate to a server action satisfy this by importing nothing
      and authorizing there; they are 'vehicle-scoped' and covered by the
      service-role assertion below instead. So this checks the import only
      where the route itself resolves a caller.
    */
    expect(handRollsAuthentication(readFileSync(join(ROOT, route), 'utf8'))).toBe(false);
  });

  describe('the hand-rolled-authentication detector itself', () => {
    /*
      The synthetic input below is `/api/v1/vehicles` as it stood until 31 Jul:
      its own cookie client, its own getUser, no import from lib/api-auth. It
      looked authorized, passed this suite, and rejected every bearer token —
      so the garage screen was unreachable from the client Phase 2.1 was built
      for. If this detector cannot see that, it is decoration.
    */
    const handRolled = `
      import { createServerActionClient } from '@/lib/supabase';
      export async function GET(): Promise<Response> {
        const supabase = createServerActionClient();
        const { data: { user }, error } = await supabase.auth.getUser();
        if (error || !user) return Response.json({ success: false }, { status: 401 });
        return Response.json({ success: true });
      }
    `;

    const viaApiAuth = `
      import { requireCaller } from '@/lib/api-auth';
      export async function GET(): Promise<Response> {
        const caller = await requireCaller();
        if (!caller.ok) return caller.response;
        return Response.json({ success: true });
      }
    `;

    const delegates = `
      import { fetchThing } from '@/app/actions';
      export async function POST(): Promise<Response> {
        return Response.json(await fetchThing());
      }
    `;

    it('catches a route that resolves the caller itself', () => {
      expect(handRollsAuthentication(handRolled)).toBe(true);
    });

    it('clears the same route once it goes through lib/api-auth', () => {
      expect(handRollsAuthentication(viaApiAuth)).toBe(false);
    });

    it('does not fire on a route that delegates to a server action', () => {
      // Those authorize in the action. Flagging them would push the suite
      // toward being switched off, which is how a ratchet dies.
      expect(handRollsAuthentication(delegates)).toBe(false);
    });
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

/**
 * Every file that declares 'use server'.
 *
 * This used to be hardcoded to app/actions.ts alone, which meant four other
 * server-action files were never checked — and one of them, lib/actions/
 * wishlist.ts, was reaching the service role with no ownership check on six
 * live exports. Discovered 30 Jul.
 *
 * Discovered by walking the tree rather than by list, so a new 'use server'
 * file is covered the day it is written instead of the day someone remembers
 * to register it.
 */
function findServerActionFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) findServerActionFiles(full, acc);
    else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      const head = readFileSync(full, 'utf8').slice(0, 200);
      if (/^['"]use server['"]/m.test(head)) acc.push(full.replace(ROOT + '/', ''));
    }
  }
  return acc;
}

describe('server actions', () => {
  const files = ['app', 'lib'].flatMap((d) => findServerActionFiles(join(ROOT, d)));

  const actions = files.flatMap((file) =>
    exportedActions(readFileSync(join(ROOT, file), 'utf8')).map((fn) => ({ ...fn, file }))
  );

  const unauthorized = actions
    .filter((fn) => USES_SERVICE_ROLE.test(fn.body) && !PROVES_OWNERSHIP.test(fn.body))
    .map((fn) => `${fn.file}:${fn.name}`);

  it('parses the action surface', () => {
    expect(actions.length).toBeGreaterThan(50);
  });

  it('scans every use-server file, not just app/actions.ts', () => {
    // The bug this suite shipped with: one hardcoded path, four files unread.
    // Named rather than counted: a count passes for the wrong reasons the
    // moment a file is added or deleted, which is how this assertion would
    // rot into decoration.
    expect(files.sort()).toEqual([
      'app/account-actions.ts',
      'app/actions.ts',
      'lib/actions/wishlist.ts',
    ]);
  });

  /**
   * A pass-through defeats the per-function scan above: `return _doThing(x)`
   * contains no getServiceRoleClient( call, so the body looks clean while the
   * privileged work happens one module away. That is precisely how six
   * unguarded wishlist actions passed this suite for the whole of Phase 0.
   *
   * So: an exported action whose body only delegates to an import must be
   * delegating to something that itself proves authorization. Checked by
   * resolving the callee in the imported module and re-running the same test
   * on it.
   */
  it('sees through pass-throughs to the function doing the privileged work', () => {
    expect(findDelegationLeaks(actions, (file) => readFileSync(join(ROOT, file), 'utf8')))
      .toEqual([]);
  });

  /*
    The detector, probed with a real violation rather than trusted because the
    suite is green (cc-tech-0004). The synthetic input below is the shape of
    the bug found on 30 Jul: a bare re-export in app/actions.ts standing in
    front of an unguarded service-role write in lib/actions/wishlist.ts.
  */
  describe('the pass-through detector itself', () => {
    const wrapper = (body: string): LocatedFn => ({
      file: 'app/actions.ts',
      name: 'addItemToWishlist',
      body,
    });

    const primitive = (body: string): LocatedFn => ({
      file: 'lib/actions/wishlist.ts',
      name: '_addItemToWishlist',
      body,
    });

    const importLine = "import { _addItemToWishlist as addItemToWishlist } from '@/lib/actions/wishlist';";

    it('catches a pass-through to an unguarded service-role write', () => {
      const leaks = findDelegationLeaks(
        [
          wrapper('export async function addItemToWishlist(id: string) {\n  return addItemToWishlist(id);\n}'),
          primitive(
            'export async function _addItemToWishlist(id: string) {\n  const c = getServiceRoleClient();\n  return c.from("wishlist_items").insert({});\n}'
          ),
        ],
        () => importLine
      );

      expect(leaks).toEqual([
        'app/actions.ts:addItemToWishlist -> lib/actions/wishlist.ts:_addItemToWishlist',
      ]);
    });

    it('clears the same pass-through once the primitive authorizes', () => {
      const leaks = findDelegationLeaks(
        [
          wrapper('export async function addItemToWishlist(id: string) {\n  return addItemToWishlist(id);\n}'),
          primitive(
            'export async function _addItemToWishlist(id: string) {\n  const a = await authorizeVehicleAccess(id, { intent: "write" });\n  if (!a.ok) return a;\n  const c = getServiceRoleClient();\n  return c.from("wishlist_items").insert({});\n}'
          ),
        ],
        () => importLine
      );

      expect(leaks).toEqual([]);
    });
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

  /*
    Sliced to the function's own boundary, not to a byte count.

    This used to take `start + 12000`, which broke the moment the signature
    grew — task 3.0.1 deprecated twelve parameters and pushed the demo guard
    past the window. Widening the number would have restored it until next
    time, but the fixed window was the more interesting problem: the two
    `not.toMatch` assertions below pass *vacuously* on a window that falls
    short. A guard that reports safety when it has run out of text to read is
    the `cc-product-0003` failure again, in the instrument.
  */
  function sendConsultantMessageBody(): string {
    const start = actionsSource.indexOf('export async function sendConsultantMessage');
    expect(start).toBeGreaterThan(-1);

    const next = actionsSource.indexOf('\nexport async function', start + 1);
    const body = actionsSource.slice(start, next === -1 ? actionsSource.length : next);

    // The negative assertions are only meaningful against a real body.
    expect(body.length).toBeGreaterThan(2000);
    return body;
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

  /*
    The same regression, one layer out. `/api/v1/consultant` authorizes on its
    own account so it can return a status code, which means it makes the same
    intent decision the action does — and could get it wrong the same way. The
    Phase 3 plan called this out specifically: "auth-posture.test.ts guards the
    action but would not guard a new route." Now it does.
  */
  describe('the consultant route makes the same demo decision', () => {
    const routeSource = readFileSync(join(ROOT, 'app/api/v1/consultant/route.ts'), 'utf8');

    it('derives demo status from the vehicle id, not the request body', () => {
      expect(routeSource).toMatch(/const isDemoVehicle = isDemoVehicleId\(vehicleId\)/);
      // body.isDemo would be the client deciding its own authorization.
      expect(routeSource).not.toMatch(/body\.isDemo/);
    });

    it('does not ask for write access on a demo vehicle', () => {
      expect(routeSource).toMatch(/intent:\s*isDemoVehicle\s*\?\s*'read'\s*:\s*'write'/);
      expect(routeSource).not.toMatch(/authorizeVehicleAccess\([^)]*\{\s*intent:\s*'write'\s*\}/);
    });
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
