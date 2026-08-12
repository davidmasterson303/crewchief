/**
 * The caller list for the one function in this app that spends money without
 * authorizing anything.
 *
 * @jest-environment node
 *
 * `lib/vehicle-research.ts` exports `researchVehicleDossier`, which makes a
 * Pro-model call — up to three attempts — and writes to
 * `vehicle_knowledge_base` for whatever vehicle it is handed. It performs **no
 * session check, no ownership check and no rate limit.** That is deliberate:
 * its two callers authorize in two incompatible ways, and pushing the check
 * inside would mean the sweep could not use it at all.
 *
 * ── Why a test rather than a comment ────────────────────────────────────────
 *
 * The docblock on that function says loudly that every caller must authorize
 * first. A docblock is advice; this is the ratchet. The specific accident it
 * pins is a third caller appearing on a route that forgot — which would not
 * fail to compile, would not fail any other suite, and would present as a
 * working feature right up until somebody noticed the bill or the write.
 *
 * ── Why it is static analysis ───────────────────────────────────────────────
 *
 * The property is *which files reference the symbol*, which is a fact about
 * the source tree. Importing the module proves nothing about who else imports
 * it, and there is no runtime moment at which "only these two callers exist"
 * is observable.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');

/**
 * The callers allowed to reach the unauthorized research core, and the
 * authorization each one supplies instead.
 *
 * Adding to this list is a deliberate act. If a new entry is needed, state in
 * the comment what authorizes it — "nothing, it is internal" is not an answer,
 * because `researchVehicleDossier` is exactly as expensive from an internal
 * route as from a public one.
 */
const ALLOWED_CALLERS: Record<string, string> = {
  // A user is present: `authorizeVehicleAccess` for ownership, plus the
  // per-vehicle AI rate limit.
  'app/actions.ts': 'authorizeVehicleAccess + checkRateLimit',
  // No user exists by construction. Authorized by CRON_SECRET compared in
  // constant time at the route boundary, and bounded by SWEEP_GENERATE_CAP.
  'app/api/internal/notify-sweep/route.ts': 'CRON_SECRET + SWEEP_GENERATE_CAP',
};

const SEARCH_DIRS = ['app', 'components', 'lib', 'hooks', 'netlify', 'packages'];
const SOURCE = /\.(ts|tsx|mts)$/;

function walk(dir: string, into: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return into;
  }

  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '__tests__' || entry === 'dist') continue;

    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, into);
    else if (SOURCE.test(entry)) into.push(full);
  }

  return into;
}

describe('researchVehicleDossier has a closed caller list', () => {
  const files = SEARCH_DIRS.flatMap((dir) => walk(join(ROOT, dir)));

  it('finds the source tree it is supposed to be scanning', () => {
    // A scan that silently matched nothing would pass every assertion below
    // while checking exactly nothing — the shape this repo keeps catching.
    expect(files.length).toBeGreaterThan(50);
  });

  /*
    Detection is by **import**, not by mention, and the first run of this guard
    is why.

    Matching the bare string flagged `packages/core/src/notification-sweep.ts`,
    whose docblock explains the gap by naming the function that closes it. That
    is prose about a symbol, not a call to it — the same distinction
    `audit-feature-claims.mjs` had to learn, where a path-like symbol is a claim
    about the filesystem rather than about source text.

    An import cannot be faked by a comment, and every real caller must have one:
    there is no other way to reach the function. Both the named-import and
    namespace forms are matched, so `import * as research from …` does not slip
    past.
  */
  const IMPORTS_RESEARCH = /import\s+[^;]*from\s+['"](@\/lib\/vehicle-research|\.\.?\/[^'"]*vehicle-research)['"]/;

  it('is imported only by callers that authorize first', () => {
    const callers = files
      .filter((file) => {
        if (file.endsWith('lib/vehicle-research.ts')) return false;
        return IMPORTS_RESEARCH.test(readFileSync(file, 'utf8'));
      })
      .map((file) => file.slice(ROOT.length + 1));

    expect(callers.sort()).toEqual(Object.keys(ALLOWED_CALLERS).sort());
  });

  it('each allowed caller still contains the authorization it claims', () => {
    /*
      The list above is only worth having if the reasons on it are true. This
      catches the case where a caller keeps its entry but loses its check —
      a refactor that moves the ownership test out of `generateVehicleDossier`,
      say, would leave this file smugly asserting a rule nobody enforces.
    */
    const actions = readFileSync(join(ROOT, 'app/actions.ts'), 'utf8');
    expect(actions).toContain('authorizeVehicleAccess');
    expect(actions).toContain('checkRateLimit');

    const sweep = readFileSync(join(ROOT, 'app/api/internal/notify-sweep/route.ts'), 'utf8');
    expect(sweep).toContain('CRON_SECRET');
    expect(sweep).toContain('vehiclesToGenerate');
  });

  it('is not exported from a "use server" module', () => {
    /*
      The reason the split exists at all. Every export from a `'use server'`
      file becomes a publicly invokable POST endpoint, so re-exporting the
      unauthorized core from `app/actions.ts` would publish "generate a dossier
      for any vehicle, no credential" to the internet — silently, with a green
      build.
    */
    const research = readFileSync(join(ROOT, 'lib/vehicle-research.ts'), 'utf8');
    expect(research).not.toMatch(/^\s*['"]use server['"]/m);

    const actions = readFileSync(join(ROOT, 'app/actions.ts'), 'utf8');
    expect(actions).not.toMatch(/export\s*\{[^}]*researchVehicleDossier/);
    expect(actions).not.toMatch(/export\s+.*\bfrom\s+['"]@\/lib\/vehicle-research['"]/);
  });

  it('the sweep never generates on a dry run', () => {
    /*
      A dry run is documented as "every query, every decision, no sends", and
      it is the intended way to make the first production run and to diagnose a
      suspected runaway. **A dry run that spent money would be a trap sprung by
      the person being careful.**

      Asserted structurally: the generation loop must sit inside a `!dryRun`
      block. Checking that the call appears after the guard is weaker than
      executing it, and this route cannot be executed without a database, a
      scheduler and a paid model — so this is the strongest available check
      that the two stay tied together.
    */
    const sweep = readFileSync(join(ROOT, 'app/api/internal/notify-sweep/route.ts'), 'utf8');

    const guard = sweep.indexOf('if (!dryRun) {');
    const call = sweep.indexOf('researchVehicleDossier(');

    expect(guard).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(guard);
  });
});
