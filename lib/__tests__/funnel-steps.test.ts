/**
 * The front door's funnel — the vocabulary, the ranking, and the schema posture.
 *
 * @jest-environment node
 *
 * Phase 2.97d. The database write is fire-and-forget and is not tested here,
 * for the reason `ai-usage.test.ts` gives: it cannot throw, so a rejected INSERT
 * is a warn line and a missing row, and the first symptom is a funnel that is
 * quietly incomplete. There is no runtime signal. A build-time one is the only
 * kind available.
 *
 * What is tested is the part that fails without failing — a step the
 * application knows and the CHECK refuses, a visitor id that collapses every
 * visitor into one, and a counts function that reports more people answered
 * than uploaded.
 *
 * Every schema assertion runs against the migration with its prose stripped.
 * A check that reads documentation can be turned green by editing a sentence.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FUNNEL_STEPS,
  type FunnelStep,
  isRecordableVisitorId,
  deepestStep,
  funnelCounts,
} from '@crewchief/core/funnel';

const ROOT = join(__dirname, '..', '..');
const MIGRATION = readFileSync(
  join(ROOT, 'supabase/migrations/20260803090000_record_the_front_door_funnel.sql'),
  'utf8'
);
const SQL = MIGRATION.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');

/**
 * The schema with its `COMMENT ON` statements removed as well.
 *
 * `COMMENT ON ... IS '...'` is prose that survives the strip above, because it
 * is a statement rather than a comment — and this migration's table comment
 * says, in words, that the table deliberately holds no `user_id`. The first run
 * of the absence check below failed on exactly that sentence: a test asserting
 * a column does not exist, reading the documentation that says so.
 *
 * The same instrument failure `ai-usage.test.ts` records, one layer further in.
 * A green result is evidence only of what was actually examined.
 *
 * The quoted literal is consumed whole rather than up to the first `;`, since
 * the comment bodies here contain semicolons of their own.
 */
const SCHEMA = SQL.replace(/COMMENT\s+ON[\s\S]*?IS\s*'(?:[^']|'')*'\s*;/gi, '');

const VISITOR = 'v1_8f3a2c9e4b7d1056';

describe('the step vocabulary matches the CHECK constraint', () => {
  const listed = (() => {
    const block = SQL.match(/CHECK\s*\(\s*step\s+IN\s*\(([\s\S]*?)\)\s*\)/i);
    if (!block) throw new Error('Could not find the step CHECK constraint in the migration');
    return (block[1].match(/'([a-z_]+)'/g) || []).map((s) => s.replace(/'/g, ''));
  })();

  it.each(FUNNEL_STEPS)('the database accepts %s', (step) => {
    expect(listed).toContain(step);
  });

  it('the application knows every step the database accepts', () => {
    expect([...listed].sort()).toEqual([...FUNNEL_STEPS].sort());
  });
});

describe('isRecordableVisitorId', () => {
  it('accepts a plausible issued id', () => {
    expect(isRecordableVisitorId(VISITOR)).toBe(true);
  });

  it('rejects an empty id, which would collapse every visitor into one', () => {
    /*
      The failure worth guarding. An empty string is a valid text value, so the
      NOT NULL column accepts it — and then UNIQUE (visitor_id, step) dedupes
      the entire internet down to four rows and the funnel reports one visitor
      who did everything.
    */
    expect(isRecordableVisitorId('')).toBe(false);
    expect(isRecordableVisitorId('   ')).toBe(false);
  });

  it('rejects an id that is too short to be an id', () => {
    expect(isRecordableVisitorId('abc')).toBe(false);
  });

  it('rejects an unbounded id — an anonymous caller controls this value', () => {
    expect(isRecordableVisitorId('x'.repeat(129))).toBe(false);
  });

  it('rejects padded ids rather than trimming them', () => {
    // Trimming would make ' abc123456 ' and 'abc123456' the same visitor at the
    // application and two different visitors at the UNIQUE constraint, which is
    // a split funnel nobody would think to look for.
    expect(isRecordableVisitorId(` ${VISITOR} `)).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(isRecordableVisitorId(undefined)).toBe(false);
    expect(isRecordableVisitorId(null)).toBe(false);
    expect(isRecordableVisitorId(12345678)).toBe(false);
  });

  it('agrees with the bound the database enforces', () => {
    // Two enforcement points, one rule. If they disagree, the application's
    // refusal is the one that runs first and the CHECK becomes unreachable —
    // or worse, the reverse, and a write fails in a path that cannot report it.
    expect(SQL).toMatch(/char_length\(visitor_id\)\s+BETWEEN\s+8\s+AND\s+128/i);
  });
});

describe('deepestStep', () => {
  it('returns null when a visitor reached nothing', () => {
    expect(deepestStep([])).toBeNull();
  });

  it('ranks by funnel order, not by array order', () => {
    /*
      Events arrive in whatever order the writes landed, which for a
      fire-and-forget writer is not the order they happened. Taking the last
      element would make a late-landing `landed` row outrank `answered`.
    */
    expect(deepestStep(['answered', 'landed'])).toBe('answered');
    expect(deepestStep(['landed', 'answered'])).toBe('answered');
  });

  it('finds the furthest step of all four', () => {
    expect(deepestStep(['landed', 'uploaded', 'answered', 'saved'])).toBe('saved');
  });
});

describe('funnelCounts', () => {
  it('counts a complete visitor once at every step', () => {
    expect(funnelCounts([['landed', 'uploaded', 'answered', 'saved']])).toEqual({
      landed: 1,
      uploaded: 1,
      answered: 1,
      saved: 1,
    });
  });

  it('is cumulative, so a dropped middle event cannot invert the funnel', () => {
    /*
      The assertion this function exists for. The writer is best-effort: an
      `uploaded` write can be lost while `answered` succeeds. Counting raw
      events would then report more people answered than uploaded — which reads
      as a broken product rather than a dropped row, and would be debugged in
      the wrong place. Counting *reach* cannot produce that shape.
    */
    const counts = funnelCounts([['landed', 'answered']]);

    expect(counts.uploaded).toBe(1);
    expect(counts.answered).toBe(1);
    expect(counts.landed).toBeGreaterThanOrEqual(counts.uploaded);
    expect(counts.uploaded).toBeGreaterThanOrEqual(counts.answered);
  });

  it('never reports a later step above an earlier one, across a mixed cohort', () => {
    const cohort: FunnelStep[][] = [
      ['landed'],
      ['landed', 'uploaded'],
      ['landed', 'uploaded', 'answered'],
      ['landed', 'uploaded', 'answered', 'saved'],
      [],
    ];

    const counts = funnelCounts(cohort);

    expect(counts).toEqual({ landed: 4, uploaded: 3, answered: 2, saved: 1 });

    for (let i = 1; i < FUNNEL_STEPS.length; i++) {
      expect(counts[FUNNEL_STEPS[i]]).toBeLessThanOrEqual(counts[FUNNEL_STEPS[i - 1]]);
    }
  });

  it('ignores visitors who reached nothing rather than counting them as landed', () => {
    expect(funnelCounts([[], []])).toEqual({ landed: 0, uploaded: 0, answered: 0, saved: 0 });
  });
});

describe('the migration protects the dataset it is written for', () => {
  it('dedupes per visitor per step, so a reload is not a second visit', () => {
    /*
      `landed` fires on a render, so prefetches, reloads and the back button all
      trigger it. This constraint is what makes the table answer "did this
      visitor ever reach this step" instead of "how many times did something
      fire", and it is why the four call sites need no dedupe logic of their own.
    */
    expect(SQL).toMatch(/UNIQUE\s*\(\s*visitor_id\s*,\s*step\s*\)/i);
  });

  it('requires a visitor id, because four unjoinable events are four counters', () => {
    expect(SQL).toMatch(/visitor_id\s+text\s+NOT NULL/i);
  });

  it('the stripped schema still contains the schema — the absence checks are not vacuous', () => {
    /*
      An absence assertion passes trivially against an empty string, and the
      strip above is a regex over SQL. If it ever over-consumes, the three
      checks below would go green while asserting nothing — the vacuous-check
      shape this codebase keeps catching in its own instruments. Prove the
      subject survived before proving what it lacks.
    */
    expect(SCHEMA).toMatch(/CREATE TABLE IF NOT EXISTS public\.funnel_events/i);
    expect(SCHEMA).toMatch(/visitor_id/);
    expect(SCHEMA).toMatch(/ENABLE ROW LEVEL SECURITY/i);
    // And prove the strip did its job, rather than being a no-op that happened
    // to pass because the comment sat elsewhere.
    expect(SQL).toMatch(/COMMENT ON TABLE/i);
    expect(SCHEMA).not.toMatch(/COMMENT ON TABLE/i);
  });

  it('collects no account link, no IP and no free text', () => {
    // Each of these was considered and declined in the migration header. This
    // asserts the decision held, since the cheapest way to break it is for a
    // later session to add "just one more column" to an anonymous surface.
    expect(SCHEMA).not.toMatch(/\buser_id\b/i);
    expect(SCHEMA).not.toMatch(/\bip_address\b|\buser_agent\b/i);
    expect(SCHEMA).not.toMatch(/\bjsonb\b/i);
  });

  it('enables RLS and grants nothing to anon — the role the front door runs as', () => {
    expect(SQL).toMatch(/ALTER TABLE public\.funnel_events ENABLE ROW LEVEL SECURITY/i);
    expect(SQL).toMatch(/REVOKE ALL ON public\.funnel_events FROM anon/i);
    // No SELECT policy is correct here: no account owns a row, so there is
    // nobody to write one for. Asserting the absence keeps a future session
    // from "fixing" the empty policy list.
    expect(SQL).not.toMatch(/CREATE POLICY/i);
    expect(SQL).not.toMatch(/GRANT\s+(SELECT|INSERT|ALL)[\s\S]*?\bTO\s+anon\b/i);
  });

  it('is a pure addition, so the SQL Editor will not stall on it', () => {
    // David applies migrations through the dashboard. A DROP-class statement
    // raises a confirmation modal mid-run, which has stalled a migration here
    // before.
    expect(SQL).not.toMatch(/\bDROP\b/i);
    expect(SQL).not.toMatch(/\bTRUNCATE\b/i);
  });
});
