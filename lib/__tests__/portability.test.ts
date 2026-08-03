/**
 * What a mobile client could import, and what it must not.
 *
 * @jest-environment node
 *
 * Phase 2.4 lifts the portable half of `lib/` into a package both clients
 * share. Its done-condition is that **no module in that package imports
 * `next/*`, `@supabase/*` or a Node built-in** — and that this is asserted as
 * a test rather than kept as a review habit, "because it is exactly the kind
 * of thing that decays silently".
 *
 * The assertion landed before the move rather than after it, which is why the
 * move itself was mechanical. **It is now doing the opposite job**: `PORTABLE`
 * is empty because everything that qualified has gone, so the load-bearing
 * assertions are the two that guard the result — every module now inside
 * `packages/core/src` is still portable, and every module left in `lib/` is
 * still genuinely blocked. The first is where a later edit would reintroduce a
 * Supabase import into the shared package unnoticed.
 *
 * **The check is transitive**, which is the whole point. `account-data.ts`
 * imports nothing disqualifying by eye — it reaches `@supabase/supabase-js`
 * through `lib/supabase.ts`, two hops down. A direct-import grep says it is
 * portable and is wrong.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const LIB = join(ROOT, 'lib');
/** Modules already living in the shared package. Held to the same rule. */
const CORE = join(ROOT, 'packages', 'core', 'src');

/**
 * Import specifiers a React Native bundle cannot take.
 *
 * `@google/genai` is here for the reason §19 records: `lib/gemini.ts`
 * constructs its client at module scope, so importing it expects a server-side
 * key at build time. Shipping that path into an app binary is the specific
 * mistake to avoid.
 */
const NON_PORTABLE_IMPORT =
  /^(next(\/|$)|@supabase\/|node:|@google\/genai|^fs$|^path$|^crypto$)/;

/** Globals React Native does not provide. Guards like `typeof window` are fine. */
const BROWSER_GLOBAL = /\b(window|document|localStorage|sessionStorage)\s*[.[]/;

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, acc);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) acc.push(full);
  }
  return acc;
}

function importsOf(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const out: string[] = [];
  const re = /(?:from\s+|require\()\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) out.push(m[1]);
  return out;
}

function resolveLocal(spec: string, from: string): string | null {
  let base: string | null = null;
  if (spec.startsWith('@/lib/')) base = join(LIB, spec.slice('@/lib/'.length));
  else if (spec.startsWith('./') || spec.startsWith('../')) base = join(dirname(from), spec);
  else return null;

  for (const candidate of [`${base}.ts`, join(base, 'index.ts')]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Why this module cannot move, following imports transitively. Null if it can. */
function blocker(file: string, seen = new Set<string>()): string | null {
  if (seen.has(file)) return null;
  seen.add(file);

  const rel = file.slice(ROOT.length + 1);

  for (const spec of importsOf(file)) {
    if (NON_PORTABLE_IMPORT.test(spec)) return `${rel} imports ${spec}`;
  }
  if (BROWSER_GLOBAL.test(readFileSync(file, 'utf8'))) {
    return `${rel} uses a browser global`;
  }
  for (const spec of importsOf(file)) {
    const dep = resolveLocal(spec, file);
    if (dep) {
      const nested = blocker(dep, seen);
      if (nested) return `${rel} -> ${nested}`;
    }
  }
  return null;
}

/**
 * Modules that may move into the shared package.
 *
 * **This list may only grow**, and only by making a module genuinely portable.
 * Adding a name here without fixing the module fails the assertions below.
 */
const PORTABLE: string[] = [
  // Empty: every module that qualified has moved into packages/core/src.
  // A new portable module in lib/ belongs here until it moves.
];

/**
 * Modules that stay, with the reason. Kept explicit so the cost of the split
 * is visible rather than rediscovered mid-move.
 */
const NOT_PORTABLE: Record<string, string> = {
  'lib/supabase.ts': 'constructs Supabase clients',
  'lib/api-auth.ts': 'Supabase, and reads next/headers',
  'lib/account-data.ts': 'reaches Supabase through lib/supabase',
  'lib/performance-stats.ts': 'Supabase types, and calls Gemini',
  'lib/rate-limit.ts': 'reaches Supabase through lib/supabase',
  /*
    Same split as image-downscale.ts and vehicle-photo.ts, and made on purpose:
    the arithmetic — which usage fields to read, whether a reading is worth
    recording, what a call bills at — is in `packages/core/src/ai/usage.ts` and
    is portable. Only the write needs a service-role client, and it needs one
    specifically because a client that could write here could under-report its
    own usage.
  */
  'lib/ai-usage.ts': 'writes with the service role — reaches Supabase through lib/supabase',
  /*
    Same split again, and for the same reason: the decision — tiers, the warn
    threshold, the boundary, what an unconfigured limit means — is in
    `packages/core/src/ai/budget.ts` and is portable. Only the read of what has
    been spent needs a service-role client, and it needs one because a client
    that could read another account's usage could also read its own around a
    limit.
  */
  'lib/ai-budget.ts': 'reads usage with the service role — reaches Supabase through lib/supabase',
  'lib/sign-out.ts': 'Supabase types',
  /*
    The precedence rule — owner photo over stock, the unphotographed-demo
    carve-out — is portable and duplicated in hooks/useSignedUrl.ts. What is
    not portable is the half that mints the signed URL, which needs a Supabase
    storage client. Worth splitting when the native client needs the rule, and
    that split is the same shape as image-downscale.ts's.
  */
  'lib/vehicle-photo.ts': 'mints signed URLs through a Supabase storage client',
  'lib/storage-objects.ts': 'reaches Supabase through lib/supabase',
  'lib/consultant-context.ts': 'queries Supabase — the shape it returns is portable, the loading is not',
  'lib/gemini.ts': 'client at module scope — a build-time server key (§19)',
  'lib/actions/wishlist.ts': 'reaches Supabase through lib/supabase',
  // Splits, not moves — the effort the plan warned about.
  'lib/deletion-recovery.ts': 'queue logic is portable; persistence uses localStorage',
  'lib/demo-mode.ts': 'document.cookie — split out of demo.ts so demo.ts could move',
  /*
    Canvas encoding is genuinely web-only, and the split is deliberate rather
    than reluctant: the arithmetic — scale factors, the quality ladder, whether
    a re-encode is even worth keeping — lives in
    `@crewchief/core/image-resize` where it is portable and tested, and only
    the `document.createElement('canvas')` glue stays here.

    A React Native client will need its own encoder anyway (expo-image-manipulator
    or similar), and when it does, it reuses every decision and reimplements only
    the draw call.
  */
  'lib/image-downscale.ts': 'canvas, document and Image — the maths is in core/image-resize',
};

describe('the portable half of lib/', () => {
  const all = sourceFiles(LIB).map((f) => f.slice(ROOT.length + 1)).sort();
  const moved = sourceFiles(CORE).map((f) => f.slice(ROOT.length + 1)).sort();

  it('accounts for every module in lib/', () => {
    // A module in neither list is one nobody has classified, and it would slip
    // into or out of the package by accident during the move.
    const classified = new Set([...PORTABLE, ...Object.keys(NOT_PORTABLE)]);
    expect(all.filter((f) => !classified.has(f))).toEqual([]);
  });

  it('every module still in lib/ that claims to be portable really is', () => {
    // A loop rather than it.each: the list is legitimately empty now that the
    // move is done, and it.each throws on an empty table. It fills again only
    // when someone adds a portable module to lib/ instead of to the package.
    const wrong = PORTABLE.filter((rel) => blocker(join(ROOT, rel)) !== null);
    expect(wrong).toEqual([]);
  });

  it('has moved at least one module into the package', () => {
    // Guards the guard: if the walk of packages/core/src silently found
    // nothing, the assertion below would pass vacuously.
    expect(moved.length).toBeGreaterThan(0);
  });

  it.each(sourceFiles(CORE).map((f) => f.slice(ROOT.length + 1)))(
    '%s is still portable now that it lives in the package',
    (rel) => {
      // The rule does not stop applying once a module has moved — this is
      // where a later edit would reintroduce a Supabase import unnoticed.
      expect(blocker(join(ROOT, rel))).toBeNull();
    }
  );

  it.each(Object.keys(NOT_PORTABLE))('%s really is blocked', (rel) => {
    // Stops the stay-behind list rotting: a module that becomes portable
    // should be moved to PORTABLE, not left here as a stale excuse.
    expect(blocker(join(ROOT, rel))).not.toBeNull();
  });

  it('keeps gemini.ts out of the portable set', () => {
    // Called out separately because this is the one with a consequence beyond
    // a build error: it would ship a path expecting a server key into an app
    // binary.
    expect(PORTABLE).not.toContain('lib/gemini.ts');
  });
});
