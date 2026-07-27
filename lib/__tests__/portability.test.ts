/**
 * Which of `lib/` a mobile client could import.
 *
 * @jest-environment node
 *
 * Phase 2.4 lifts the portable half of `lib/` into a package both clients
 * share. Its done-condition is that **no module in that package imports
 * `next/*`, `@supabase/*` or a Node built-in** — and that this is asserted as
 * a test rather than kept as a review habit, "because it is exactly the kind
 * of thing that decays silently".
 *
 * So the assertion lands before the move rather than after it. Once the set
 * below is pinned, the move becomes mechanical: anything in `PORTABLE` can go,
 * anything in `NOT_PORTABLE` stays, and a module that changes category has to
 * change this file to do it.
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
const PORTABLE = [
  'lib/ai/models.ts',
  'lib/auth-session.ts',
  'lib/cache-debug.ts',
  'lib/constants.ts',
  'lib/consultant-commands.ts',
  'lib/cors.ts',
  'lib/demo-contract.ts',
  'lib/demo.ts',
  'lib/error-messages.ts',
  'lib/event-bus.ts',
  'lib/formatting-utils.ts',
  'lib/logger.ts',
  'lib/maintenance-sync.ts',
  'lib/mileage-tracking.ts',
  'lib/onboarding.ts',
  'lib/prompts.ts',
  'lib/query-client.ts',
  'lib/query-invalidation.ts',
  'lib/quote-naming.ts',
  'lib/retry.ts',
  'lib/routes.ts',
  'lib/storage-paths.ts',
  'lib/tco-calculator.ts',
  'lib/types.ts',
  'lib/usage-profile.ts',
  'lib/utils.ts',
  'lib/validation.ts',
  'lib/vehicle-utils.ts',
  'lib/wishlist-identifier.ts',
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
  'lib/sign-out.ts': 'Supabase types',
  'lib/vehicle-images.ts': 'reaches Supabase through lib/supabase',
  'lib/gemini.ts': 'client at module scope — a build-time server key (§19)',
  'lib/actions/quotes.ts': 'reaches Supabase through lib/supabase',
  'lib/actions/vehicles.ts': 'reaches Supabase through lib/supabase',
  'lib/actions/wishlist.ts': 'reaches Supabase through lib/supabase',
  // Splits, not moves — the effort the plan warned about.
  'lib/deletion-recovery.ts': 'queue logic is portable; persistence uses localStorage',
  'lib/demo-mode.ts': 'document.cookie — split out of demo.ts so demo.ts could move',
};

describe('the portable half of lib/', () => {
  const all = sourceFiles(LIB).map((f) => f.slice(ROOT.length + 1)).sort();

  it('accounts for every module in lib/', () => {
    // A module in neither list is one nobody has classified, and it would slip
    // into or out of the package by accident during the move.
    const classified = new Set([...PORTABLE, ...Object.keys(NOT_PORTABLE)]);
    expect(all.filter((f) => !classified.has(f))).toEqual([]);
  });

  it.each(PORTABLE)('%s has no non-portable dependency, transitively', (rel) => {
    expect(blocker(join(ROOT, rel))).toBeNull();
  });

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
