/**
 * Every field the health prompt asks for is a field the parser reads.
 *
 * @jest-environment node
 *
 * ── ⚠ The defect, and why nothing caught it ─────────────────────────────────
 *
 * **Every health score CrewChief ever generated was 70.** The prompt asked the
 * model for `healthScore`; the parser read `healthData.health_score`; the value
 * was therefore always `undefined`, and the next line substituted a documented
 * neutral. `redFlags` met the same fate and was forced to `[]`.
 * `maintenanceStatus`, `recallStatus` and `issuesOverview` were not merely
 * wrong — a wholesale `healthData = JSON.parse(…)` dropped the defaults, so the
 * three keys were **absent from the stored row entirely**, which is exactly the
 * shape the live API returned when it was checked on 23 Aug.
 *
 * Three green suites are named for this behaviour and not one of them could see
 * it. `health-claims.test.ts` and `absence-is-not-an-all-clear.test.ts` test
 * pure functions that `generateVehicleHealthSummary` never calls on this path.
 * `health-sees-filed-invoices.test.ts` *does* target that function and is
 * entirely source-text regex — it never parses a response.
 *
 * That is this repo's signature failure: **an instrument that measures the
 * right number for the wrong question.** The pure functions are well tested;
 * whether anything calls them correctly is tested by almost nothing.
 *
 * ── What this checks, and why it is a source scan ───────────────────────────
 *
 * The invariant is a *correspondence between two strings in one file* — the
 * word inside a prompt template and the word after `parsed.`. Executing the
 * function would need a live Gemini call, a live Supabase and a real vehicle;
 * the correspondence is on disk and cannot drift without one of the two sides
 * being edited.
 *
 * ⚠ It deliberately does **not** check that the parser reads the snake_case
 * spelling too. That is the column's name, it is the caller's business, and
 * pinning it here would make renaming a column a two-file change for no gain.
 * What must never happen again is a prompt asking for a word nothing reads.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ACTIONS = readFileSync(join(__dirname, '..', '..', 'app', 'actions.ts'), 'utf8');

/**
 * The body of `generateVehicleHealthSummary`, so a neighbouring prompt cannot
 * satisfy this and a neighbouring parser cannot either.
 */
function healthSummarySource(): string {
  const start = ACTIONS.indexOf('export async function generateVehicleHealthSummary');
  expect(start).toBeGreaterThan(-1);

  const end = ACTIONS.indexOf('\nexport ', start + 1);
  return ACTIONS.slice(start, end === -1 ? undefined : end);
}

/**
 * The fields the prompt asks the model for.
 *
 * They are written as a bulleted contract — `- healthScore (1-100 integer…)` —
 * and that list is the specification. Reading it from the prompt rather than
 * hardcoding it here is the whole point: a field added to the prompt is
 * automatically a field this test requires somebody to read.
 */
function promptedFields(body: string): string[] {
  /*
    ⚠ `exec` in a loop, not `matchAll`. This repo's web `tsconfig` targets below
    ES2015 iteration, so spreading an iterator needs `--downlevelIteration` —
    the same constraint `mobile-surface-ladder.test.ts` records. A fresh
    `RegExp` because a global one is stateful.
  */
  const pattern = /^\s*- ([a-zA-Z]+) \(/gm;
  const found: string[] = [];

  let match: RegExpExecArray | null = pattern.exec(body);
  while (match !== null) {
    if (!found.includes(match[1])) found.push(match[1]);
    match = pattern.exec(body);
  }

  return found;
}

/** Everything the parser pulls off the response object. */
function readFields(body: string): Set<string> {
  const pattern = /\bparsed\.([a-zA-Z_]+)/g;
  const found = new Set<string>();

  let match: RegExpExecArray | null = pattern.exec(body);
  while (match !== null) {
    found.add(match[1]);
    match = pattern.exec(body);
  }

  return found;
}

describe('the health prompt and its parser agree', () => {
  const body = healthSummarySource();

  it('finds a prompt with a field contract in it', () => {
    /*
      The anti-vacuous half, and it has teeth here: if the prompt is ever
      reformatted so the bullets stop matching, `promptedFields` returns an
      empty list and the assertion below passes against nothing — which is the
      exact failure mode §9 of the audit is about.
    */
    const fields = promptedFields(body);

    expect(fields.length).toBeGreaterThanOrEqual(6);
    expect(fields).toEqual(expect.arrayContaining(['healthScore', 'summary', 'redFlags']));
  });

  it('reads every field it asks for', () => {
    const read = readFields(body);
    const ignored = promptedFields(body).filter((field) => !read.has(field));

    /*
      Named in the failure rather than counted, because the useful thing when
      this goes red is *which* word the prompt is asking for that nothing
      collects.
    */
    expect(ignored).toEqual([]);
  });

  it('never substitutes a score the model did not produce', () => {
    /*
      ⚠ The specific line that shipped:

          if (healthData.health_score === undefined) healthData.health_score = 70;

      70 is a defensible documented neutral on the **parse-failure** path, and
      it is still used there. What it must never be is what gets written when
      the model actually answered — a constant in the column a gauge reads is
      indistinguishable from a reading, and that is how "70 / Fair" came to sit
      beside "impossible to assess its current condition".
    */
    const assignments = body.match(/health_score\s*=\s*70/g) ?? [];
    expect(assignments).toEqual([]);
  });

  it('parses with the extractor, not with bare JSON.parse', () => {
    /*
      `extractJSON` strips the ``` fences that "Format as valid JSON only, no
      markdown" does not reliably prevent. Every other extraction site in this
      file already uses it; this one did not, so a fenced response fell into the
      catch and stored the defaults as though the model had failed.
    */
    expect(body).toMatch(/extractJSON\(responseText\)/);
    expect(body).not.toMatch(/JSON\.parse\(responseText\)/);
  });

  it('can still detect a prompt field that nothing reads', () => {
    /*
      Rule 5's other half. The exact shape that shipped, against a synthetic
      body — without this the two assertions above pass on any file whose
      regexes happen to match nothing.
    */
    const leaky = `
      - healthScore (1-100 integer)
      - redFlags (array)
      const parsed = extractJSON(responseText);
      const score = firstNumber(parsed.healthScore);
    `;

    expect(promptedFields(leaky)).toEqual(['healthScore', 'redFlags']);
    expect(promptedFields(leaky).filter((f) => !readFields(leaky).has(f))).toEqual(['redFlags']);
  });
});
