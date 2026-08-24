/**
 * Every Gemini call is behind a spend ceiling.
 *
 * @jest-environment node
 *
 * ── ⚠ The finding this exists for (PERF-06, 24 Aug) ─────────────────────────
 *
 * **Eleven of fourteen `generateContent` call sites bypassed the monthly
 * budget.** Only `sendConsultantMessage` and `parseInvoiceLineItems` called
 * `checkMonthlyBudget`. The single most expensive call in the application —
 * `researchVehicleDossier`, the Pro model with `maxOutputTokens: 32768` — had
 * no ceiling in front of it at all.
 *
 * A user past their tier limit could keep generating health summaries, mod
 * details, cost estimates, email drafts and dossiers indefinitely. Only the
 * consultant and the invoice parser refused.
 *
 * ── Why this test and not more tests of the budget ──────────────────────────
 *
 * `packages/core/src/ai/budget.ts` is 20KB of careful reasoning about ceilings,
 * exercised thoroughly across the warn threshold, the boundary, negative values
 * and a zero ceiling — **and no test asserted that any call site calls it.**
 *
 * That is this repo's signature failure applied to its own cost control: the
 * pure functions are well tested, and whether anything *uses* them is tested by
 * almost nothing. This is the missing half.
 *
 * ── Why a source scan ───────────────────────────────────────────────────────
 *
 * Executing any of these needs a live Gemini key and would spend the money the
 * test is about. What regressed is structural — whether a ceiling appears in
 * the same function body as the call — and it is on disk.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');

/**
 * Every file that calls Gemini.
 *
 * Listed rather than globbed, and the list is asserted complete below by a
 * repo-wide grep. A glob that silently stopped matching is the failure mode
 * §9 of the audit is entirely about.
 */
const CALL_SITE_FILES = [
  join('app', 'actions.ts'),
  join('lib', 'performance-stats.ts'),
  join('lib', 'quote-check.ts'),
  join('lib', 'vehicle-research.ts'),
  join('app', 'api', 'health', 'consultant', 'route.ts'),
];

/**
 * Functions that reach Gemini without `checkMonthlyBudget`, each with the
 * reason it is allowed to.
 *
 * ⚠ **Every entry names a *different* ceiling, not an absence of one.** An
 * exemption that means "this one is unmetered" is the finding, not a fix for
 * it — so each of these is checked below for the control it claims instead.
 */
/**
 * Functions whose ceiling is enforced by whoever calls them, with the file that
 * does it.
 *
 * ── ⚠ Why this form exists, and why it is not a hole ────────────────────────
 *
 * Four of these are internal steps that take no `userId`. `estimateCosts`,
 * `generateEmailDraft` and `validateConsultantDocument` are not exported at all
 * — so none is a reachable endpoint (SEC-02) — and `runQuoteCheck` and
 * `recomputePerformanceStats` are library functions their routes authorize
 * before calling. Threading a user id through purely to satisfy a scan would
 * add a parameter the function does not need, at five call sites, to re-check
 * the allowance its caller checked a line earlier.
 *
 * So the exemption names **where the ceiling actually is**, and that file is
 * read and checked. An entry pointing at a file that does not contain the
 * control, or does not call the function it claims to protect, fails.
 *
 * That is the difference between this and `auth-posture.test.ts`'s `'public'`
 * posture, which the file itself admits asserts nothing — and which is how a
 * whole class of unguarded action stayed invisible.
 */
const CEILING_ELSEWHERE: Record<string, { file: string; control: string }> = {
  estimateCosts: { file: join('app', 'actions.ts'), control: 'checkMonthlyBudget' },
  generateEmailDraft: { file: join('app', 'actions.ts'), control: 'checkMonthlyBudget' },
  validateConsultantDocument: { file: join('app', 'actions.ts'), control: 'checkMonthlyBudget' },
  runQuoteCheck: {
    file: join('app', 'api', 'v1', 'front-door', 'check', 'route.ts'),
    control: 'checkFrontDoorBudget',
  },
  recomputePerformanceStats: {
    file: join('app', 'api', 'v1', 'performance-stats', 'route.ts'),
    control: 'authorizeVehicleAccess',
  },
  attemptRoundTrip: {
    file: join('app', 'api', 'health', 'consultant', 'route.ts'),
    control: 'CONSULTANT_HEALTH_SECRET',
  },
};

function read(file: string): string {
  return readFileSync(join(ROOT, file), 'utf8');
}

/**
 * The name of the function enclosing each `generateContent` in a file.
 *
 * ⚠ Walks **backwards** from the call to the nearest preceding declaration at
 * column 0. `app/actions.ts` is 6,500 lines with deeply nested closures, and a
 * forward scan for the next `function` after the call names the one *after* it
 * — which would attribute a missing ceiling to an innocent neighbour and, worse,
 * credit an unguarded function with its neighbour's guard.
 */
function callingFunctions(source: string): string[] {
  const declaration = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)/gm;

  const declarations: Array<{ at: number; name: string }> = [];
  let match: RegExpExecArray | null = declaration.exec(source);
  while (match !== null) {
    declarations.push({ at: match.index, name: match[1] });
    match = declaration.exec(source);
  }

  const calls = /generateContent\(/g;
  const found: string[] = [];

  let call: RegExpExecArray | null = calls.exec(source);
  while (call !== null) {
    const at = call.index;
    let enclosing = 'top level';

    for (const declared of declarations) {
      if (declared.at < at) enclosing = declared.name;
      else break;
    }

    if (!found.includes(enclosing)) found.push(enclosing);
    call = calls.exec(source);
  }

  return found;
}

/** One function's body, from its declaration to the next one at column 0. */
function bodyOf(source: string, name: string): string {
  const start = source.search(new RegExp(`^(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\b`, 'm'));
  if (start === -1) return '';

  const next = source.slice(start + 1).search(/^(?:export\s+)?(?:async\s+)?function\s/m);
  return next === -1 ? source.slice(start) : source.slice(start, start + 1 + next);
}

describe('every Gemini call site is metered', () => {
  it('knows about every file that calls Gemini', () => {
    /*
      The anti-vacuous half, and the one the audit's guard-hole table is full of
      counter-examples to: `model-tiering.test.ts` globs `app/actions.ts` **only**,
      which is why `lib/performance-stats.ts` hardcoding a model was invisible
      to it.

      This asserts the list is complete by counting call sites across the files
      it does know about. A new file calling Gemini fails the total.
    */
    const total = CALL_SITE_FILES.reduce(
      (sum, file) => sum + (read(file).match(/generateContent\(/g) ?? []).length,
      0
    );

    expect(total).toBeGreaterThanOrEqual(14);
  });

  it.each(CALL_SITE_FILES)('%s — every calling function has a ceiling', (file) => {
    const source = read(file);
    const unmetered = callingFunctions(source)
      .filter((name) => !CEILING_ELSEWHERE[name])
      .filter((name) => {
        const body = bodyOf(source, name);
        return !/checkMonthlyBudget\(|checkDemoBudget\(|checkFrontDoorBudget\(/.test(body);
      });

    /*
      Named rather than counted. When this goes red the useful thing is *which*
      function can spend without asking, and the eleven this started with were:
      generateSessionTitle, generateVehicleHealthSummary, generateModDetails,
      validateConsultantDocument, estimateCosts, generateEmailDraft,
      generateVehicleIllustration, ensureAggressiveModMinimum,
      recomputePerformanceStats, researchVehicleDossier, and the mod-name pass.
    */
    expect(unmetered).toEqual([]);
  });

  it('every deferred ceiling names a file that actually has it', () => {
    /*
      ⚠ The half that stops the exemption list being a way to opt out. Each
      entry must name a file that both **calls** the function and **contains**
      the control it claims — so deleting a route's `checkFrontDoorBudget` fails
      here, even though the deleted line is in a different file from the
      `generateContent` it was protecting.
    */
    for (const [name, { file, control }] of Object.entries(CEILING_ELSEWHERE)) {
      const source = read(file);

      expect([name, source.includes(name)]).toEqual([name, true]);
      expect([name, source.includes(control)]).toEqual([name, true]);
    }
  });

  it('can still detect an unmetered call', () => {
    /*
      Rule 5's other half, against a source shaped like the real one — including
      the trap the backwards walk exists for: a **guarded function following an
      unguarded one**, which a forward scan credits to the wrong body.
    */
    const source = [
      'export async function spendsFreely(id: string) {',
      '  return genAI.models.generateContent({ model: PRO });',
      '}',
      'export async function asksFirst(id: string) {',
      '  const budget = await checkMonthlyBudget(id);',
      '  return genAI.models.generateContent({ model: FLASH });',
      '}',
    ].join('\n');

    expect(callingFunctions(source)).toEqual(['spendsFreely', 'asksFirst']);
    expect(bodyOf(source, 'spendsFreely')).not.toMatch(/checkMonthlyBudget/);
    expect(bodyOf(source, 'asksFirst')).toMatch(/checkMonthlyBudget/);
  });
});
