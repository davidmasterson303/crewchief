/**
 * The owner's stated performance mindset must actually reach the prompt.
 *
 * ── The bug this pins ───────────────────────────────────────────────────────
 *
 * CrewChief has two columns for one concept:
 *
 *   performance_mindedness  enum  stock | mild | aggressive     (owner picks it)
 *   performance_goal        text  mild | moderate | aggressive  (default 'moderate')
 *
 * The owner sets the first in onboarding, and it gates real UI — VehicleInsights
 * hides the mods tab entirely when it is 'stock'. **Nothing in the app ever
 * writes the second.** It has been 'moderate' for every vehicle that has ever
 * existed.
 *
 * `generateModificationDetails` took the owner's real choice as a parameter,
 * `performanceMindset`, and then never referenced it — reading
 * `performance_goal` instead. So an owner who said 'aggressive' received
 * modification analysis written for a 'moderate' owner, an owner who said
 * 'stock' received modification analysis at all, and the two fields appeared to
 * "disagree" when in truth one of them was never consulted.
 *
 * An unused parameter raises no type error and no lint error in this config, so
 * a static check is what catches it coming back.
 *
 * ── And the vocabulary hole underneath it ───────────────────────────────────
 *
 * 'stock' exists only in the enum; 'moderate' only in the text column. The old
 * lookup table had keys for mild/moderate/aggressive and was indexed with
 * `as keyof typeof` — a cast that silences exactly the error that would have
 * caught 'stock' falling through to `undefined` and being interpolated into a
 * prompt sent to Gemini as the literal string "undefined".
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ACTIONS = readFileSync(join(__dirname, '..', '..', 'app', 'actions.ts'), 'utf8');

/**
 * The function body **excluding its signature**, comments stripped.
 *
 * Both exclusions are load-bearing, and the first was learned the hard way.
 * The first version of this helper sliced from `export async function …`, which
 * includes the parameter list — so `/\bperformanceMindset\b/` matched the
 * *declaration* and passed happily against the very bug it was written to
 * catch. Caught by probing it; it would otherwise have sat here green and
 * meaningless.
 */
function functionBody(name: string): string {
  const start = ACTIONS.indexOf(`export async function ${name}(`);
  if (start === -1) throw new Error(`${name} not found — rename it here too`);

  const openBrace = ACTIONS.indexOf('{', start);
  if (openBrace === -1) throw new Error(`could not find the body of ${name}`);

  // From after the signature. Far enough to cover the body; ~100 lines.
  const slice = ACTIONS.slice(openBrace + 1, openBrace + 12000);
  return slice.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('the owner performance mindset reaches the modification prompt', () => {
  const body = functionBody('generateModificationDetails');

  it('uses its performanceMindset parameter', () => {
    // The whole bug in one assertion: the parameter existed, was passed
    // correctly by the caller, and was never read.
    expect(body).toMatch(/\bperformanceMindset\b/);
  });

  it('prefers the mindset over the column nothing writes', () => {
    /*
      Order matters. `performance_goal` is fine as a fallback and useless as a
      first choice, because it is 'moderate' for every vehicle in the database.
    */
    const mindsetAt = body.indexOf('performanceMindset');
    const goalAt = body.indexOf('vehicle.performance_goal');

    expect(mindsetAt).toBeGreaterThan(-1);
    if (goalAt > -1) expect(mindsetAt).toBeLessThan(goalAt);
  });

  it('does not index the goal table through a keyof cast', () => {
    // `as keyof typeof` is what let 'stock' resolve to undefined silently.
    expect(body).not.toMatch(/as keyof typeof/);
  });
});

describe('the goal vocabulary has no holes', () => {
  it('covers the union of both columns', () => {
    const table = ACTIONS.slice(
      ACTIONS.indexOf('const GOAL_CONTEXT'),
      ACTIONS.indexOf('function normaliseGoal')
    );

    // 'stock' is enum-only and 'moderate' is text-column-only. Missing either
    // puts a real owner into an undefined branch.
    for (const key of ['stock', 'mild', 'moderate', 'aggressive']) {
      expect(table).toMatch(new RegExp(`\\b${key}\\s*:`));
    }
  });

  it('declares the table as a total Record, not an object literal', () => {
    /*
      The type is the guard. `Record<GoalKey, string>` fails the build if either
      column gains a value and this table does not — an object literal would
      just start returning undefined again.
    */
    expect(ACTIONS).toMatch(/GOAL_CONTEXT:\s*Record<GoalKey,\s*string>/);
  });

  it('falls back to a key that exists', () => {
    const fn = ACTIONS.slice(ACTIONS.indexOf('function normaliseGoal'), ACTIONS.indexOf('function normaliseGoal') + 400);
    expect(fn).toMatch(/'moderate'/);
  });
});
