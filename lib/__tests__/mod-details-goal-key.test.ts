/**
 * Modification analysis is cached per goal, and the queue agrees with its table.
 *
 * @jest-environment node
 *
 * ── The bug these pin ───────────────────────────────────────────────────────
 *
 * `modification_details` stores Gemini's analysis of one modification for one
 * vehicle. Every field in it is written *from* the owner's performance goal —
 * the prompt instructs "tailor your analysis to align with the AGGRESSIVE
 * goal", and `alignment_with_goals` is about nothing else — but the row was
 * keyed `UNIQUE(vehicle_id, mod_name)`. Four possible answers, one slot.
 *
 * It could not be observed until 28 Jul. The generator read
 * `vehicle.performance_goal`, a column no screen writes, so every row held
 * moderate analysis and the collision was invisible. `c63bdc4` made the
 * owner's real choice reach the prompt — and in doing so made the missing key
 * a live defect rather than a latent one.
 *
 * The visible cost was in `preloadAllPerformanceModifications`, which loops
 * mild → moderate → aggressive and reads through a goal-blind
 * `getModificationDetails` before generating. The mild pass populated the row;
 * the moderate and aggressive passes hit it and copied mild text into their own
 * `performance_mod_cache` rows. Three caches, three labels, one goal's answer.
 *
 * ── And the queue that never accepted a row ─────────────────────────────────
 *
 * `mod_detail_queue` has been correctly keyed `(vehicle_id, mod_name,
 * performance_goal)` since January. Its *writer* never caught up: it omitted
 * the NOT NULL `performance_goal`, named a conflict target that matches no
 * constraint on the table, and claimed items with `status: 'processing'`, which
 * is not one of the four values the CHECK allows. Every one of those writes was
 * rejected, and every one had its error discarded — so a queue that had never
 * accepted a single row was indistinguishable from a queue with nothing to do.
 *
 * These are static checks because that is what the failure mode demands: none
 * of the above threw, logged, or failed a type check. It all simply did
 * nothing, correctly-looking, for months.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = (...parts: string[]) => join(__dirname, '..', '..', ...parts);

const ACTIONS = readFileSync(root('app', 'actions.ts'), 'utf8');
const GOAL_MIGRATION = readFileSync(
  root('supabase', 'migrations', '20260729060000_key_modification_details_by_goal.sql'),
  'utf8'
);
const QUEUE_MIGRATION = readFileSync(
  root('supabase', 'migrations', '20260111141434_20260111_create_mod_detail_queue_table.sql'),
  'utf8'
);

/**
 * Each `.from('<table>')` occurrence with the chain that follows it, cut at the
 * statement that owns it.
 *
 * The cut is the point. The first version of this helper took a fixed 900-char
 * window, which reached past the upsert into
 * `return { …, performance_goal: performanceGoal }` two lines below — so
 * "the upsert persists the goal" matched the *return value* and passed happily
 * with the column deleted from the insert. Caught by probing; it would
 * otherwise have sat here green and meaningless.
 *
 * Walking to the first `;` at paren depth zero ends the chain where the
 * statement does, so nothing outside it can satisfy an assertion about it.
 */
function chains(source: string, table: string): string[] {
  const found: string[] = [];
  const marker = `.from('${table}')`;

  for (let at = source.indexOf(marker); at !== -1; at = source.indexOf(marker, at + 1)) {
    let depth = 0;
    let end = at;

    for (; end < source.length; end++) {
      const ch = source[end];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      else if (ch === ';' && depth === 0) break;
    }
    found.push(source.slice(at, end));
  }
  return found;
}

describe('every read of modification_details is scoped to one goal', () => {
  const reads = chains(ACTIONS, 'modification_details').filter((c) => c.includes('.select('));

  it('finds the reads it means to check', () => {
    // Two: getModificationDetails and getModificationDetailsBatch. If this
    // number moves, the checks below are covering the wrong thing.
    expect(reads).toHaveLength(2);
  });

  it.each([0, 1])('read %i filters on performance_goal', (i) => {
    expect(reads[i]).toMatch(/\.eq\('performance_goal',/);
  });
});

describe('what is written carries the goal that produced it', () => {
  const upserts = chains(ACTIONS, 'modification_details').filter((c) => c.includes('.upsert('));

  it('finds the one writer', () => {
    expect(upserts).toHaveLength(1);
  });

  it('persists the goal as a column', () => {
    expect(upserts[0]).toMatch(/performance_goal:\s*performanceGoal/);
  });

  it('resolves conflicts on the goal too', () => {
    /*
      The load-bearing half. Persisting the column while still conflicting on
      (vehicle_id, mod_name) is *worse* than the original bug: the row would
      carry a goal label that the last writer overwrote, so the data would look
      trustworthy and be wrong.
    */
    expect(upserts[0]).toMatch(/onConflict:\s*'vehicle_id,mod_name,performance_goal'/);
  });
});

describe('the preload does not launder one goal into three', () => {
  it('passes its loop goal to the cached read', () => {
    // The single line that produced the visible symptom.
    expect(ACTIONS).toMatch(/getModificationDetails\(vehicleId,\s*mod\.name,\s*goal\)/);
  });

  it('leaves no goal-blind call to getModificationDetails anywhere', () => {
    // A two-argument call cannot be goal-scoped. The required third parameter
    // makes this a type error too; this catches it in review as well as build.
    const calls = ACTIONS.match(/getModificationDetails\((?!Batch)[^)]*\)/g) ?? [];
    const goalBlind = calls.filter((c) => c.split(',').length < 3);
    expect(goalBlind).toEqual([]);
  });
});

describe('the queue writer agrees with the queue table', () => {
  const queueChains = chains(ACTIONS, 'mod_detail_queue');

  /** The vocabulary the table will actually accept, read from its CHECK. */
  function checkVocabulary(migration: string, column: string): string[] {
    const at = migration.indexOf(`CHECK (${column} IN (`);
    expect(at).toBeGreaterThan(-1);
    const list = migration.slice(at, migration.indexOf('))', at));
    return Array.from(list.matchAll(/'([a-z_]+)'/g)).map((m) => m[1]);
  }

  it('only writes statuses the CHECK allows', () => {
    /*
      Every status literal the file can send to this table, from all three
      places one can appear.

      The first version of this check scanned only `status: '…'` inside the
      query chains. `markStatus` writes `{ status, … }` in shorthand, so the
      three real values live in its parameter type and at its call sites — and
      the check saw only the enqueue's 'pending'. It passed with 'processing'
      reinstated, which is the exact bug it is named for. Probed, and this is
      the second version.

      The union in the signature is the choke point tsc enforces, so a call
      site that invents a value fails the build; a union that invents one fails
      here.
    */
    const allowed = checkVocabulary(QUEUE_MIGRATION, 'status');
    expect(allowed).toContain('in_progress');

    // Anchored to markStatus by name: `status:` unions belong to four other
    // tables in this file, and an unanchored match found the wishlist's.
    const union = ACTIONS.match(/const markStatus[^)]*status:\s*([^)]+)\)/)?.[1] ?? '';
    expect(union).toContain('|');
    const written = [
      ...queueChains.flatMap((c) => Array.from(c.matchAll(/status:\s*'([a-z_]+)'/g)).map((m) => m[1])),
      ...Array.from(union.matchAll(/'([a-z_]+)'/g)).map((m) => m[1]),
      ...Array.from(ACTIONS.matchAll(/markStatus\(item,\s*'([a-z_]+)'\)/g)).map((m) => m[1]),
    ];

    // 'pending' from the enqueue, three from the union, three from the calls.
    expect(written.length).toBeGreaterThanOrEqual(7);
    expect(written.filter((s) => !allowed.includes(s))).toEqual([]);
  });

  it('enqueues with the NOT NULL performance_goal', () => {
    const insert = queueChains.find((c) => c.includes('.upsert('));
    expect(insert).toBeDefined();
    expect(insert).toMatch(/performance_goal:\s*goal/);
  });

  it('names a conflict target that exists on the table', () => {
    const insert = queueChains.find((c) => c.includes('.upsert('))!;
    const target = insert.match(/onConflict:\s*'([^']+)'/)?.[1];

    const unique = QUEUE_MIGRATION.match(/UNIQUE\(([^)]+)\)/)?.[1];
    expect(unique).toBeDefined();

    // Postgres rejects an ON CONFLICT target that matches no constraint
    // (42P10) — a runtime error, on a call whose result was thrown away.
    expect(target?.split(',').map((s) => s.trim()).sort())
      .toEqual(unique!.split(',').map((s) => s.trim()).sort());
  });

  it('scopes its status updates to one goal', () => {
    // Without this, finishing one goal's item marks all of them complete.
    const updates = queueChains.filter((c) => c.includes('.update('));
    expect(updates.length).toBeGreaterThan(0);
    for (const chain of updates) {
      expect(chain).toMatch(/\.eq\('performance_goal',/);
    }
  });

  it('generates against the item goal, not the vehicle-wide one', () => {
    expect(ACTIONS).toMatch(/generateModificationDetails\(\s*item\.vehicle_id,\s*item\.mod_name,\s*vehicle,\s*item\.performance_goal/);
  });
});

describe('the migration matches the vocabulary the code can produce', () => {
  it('accepts all four GoalKey values on both tables', () => {
    /*
      'stock' is enum-only and 'moderate' text-column-only; GoalKey is the
      union. A CHECK covering only the text column's three would reject every
      row a stock owner produces — and `getModificationDetailsBatch` runs for
      stock owners, since VehicleInsights hides the mods tab, not the load.
    */
    const checks = GOAL_MIGRATION.match(/CHECK \(performance_goal IN \([^)]*\)\)/g) ?? [];
    expect(checks).toHaveLength(2);

    for (const check of checks) {
      for (const key of ['stock', 'mild', 'moderate', 'aggressive']) {
        expect(check).toContain(`'${key}'`);
      }
    }
  });

  it('replaces the old two-column key rather than adding beside it', () => {
    // Leaving UNIQUE(vehicle_id, mod_name) in place would reject the second
    // goal's row outright — the cache would stop filling instead of lying.
    expect(GOAL_MIGRATION).toMatch(
      /DROP CONSTRAINT IF EXISTS modification_details_vehicle_id_mod_name_key/
    );
    expect(GOAL_MIGRATION).toMatch(
      /UNIQUE \(vehicle_id, mod_name, performance_goal\)/
    );
  });

  it('backfills to the goal that actually produced the existing text', () => {
    /*
      'moderate', not the vehicle's current mindset. Every pre-existing row was
      generated from `vehicle.performance_goal`, which is 'moderate' for every
      vehicle. Stamping rows with the owner's chosen goal would assert a
      provenance they do not have, and would permanently hide the stale text
      behind a cache hit.
    */
    expect(GOAL_MIGRATION).toMatch(
      /SET performance_goal = 'moderate'\s*\n?\s*WHERE performance_goal IS NULL/
    );
  });
});
