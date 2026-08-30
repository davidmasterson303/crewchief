/**
 * The backfill's mirror of the schedule shape has to agree with the real one.
 *
 * `scripts/lib/schedule-entry-shape.mjs` re-declares
 * `VehicleDataSchema.maintenance_schedule` because the backfill script is a
 * `.mjs` file and the schema is TypeScript. This is what makes that duplication
 * safe rather than merely convenient: both are run against the same cases, and
 * a change to either that the other does not follow turns this red.
 *
 * ── The ratchet fired, and has been removed ─────────────────────────────────
 *
 * The second half of this file used to assert that the real schema *dropped* a
 * time-only entry — a documented bug the backfill routed around, with a test
 * whose whole job was to fail the day someone fixed it. `c2c5af8` fixed it:
 * `isUsableScheduleEntry` accepts either interval and applies `Number.isFinite`
 * to both. The ratchet fired, the route-around is gone, and what is left here is
 * a description rather than a countdown.
 */

import { VehicleDataSchema } from '@wellkept/core/vehicle-utils';
import { ScheduleEntrySchema, validateEntry } from '../lib/schedule-entry-shape.mjs';

const OIL = {
  service: 'Engine oil and filter',
  interval_miles: 7500,
  interval_months: 12,
  description: 'Drain, refill, replace the filter.',
  priority: 'Critical' as const,
};

/**
 * The real schema, asked about one entry: does it survive to the other side?
 *
 * Three outcomes, not two, and the `catch` is the reason this comment exists.
 * `isUsableScheduleEntry` runs as a `preprocess` filter, so an entry it rejects
 * is *removed* — no error, an empty array. But since `c2c5af8` an entry can pass
 * that filter on one interval and then fail validation on the other: `{miles: 0,
 * months: 12}` is usable by the filter's reckoning and rejected by
 * `z.number().positive()`, which throws for the whole payload.
 *
 * Dropped and rejected are very different for a caller. They are the same answer
 * to the only question this file asks — may the backfill write this? — so both
 * are `false` here, and the distinction is pinned by its own test below rather
 * than swallowed by this `catch`.
 */
function realSchemaKeeps(entry: unknown): boolean {
  try {
    const parsed = VehicleDataSchema.parse({
      known_issues: [{ part: 'x', mileage_range: 'y', severity: 'Low', description: 'z' }],
      maintenance_schedule: [entry],
    });
    return parsed.maintenance_schedule.length === 1;
  } catch {
    return false;
  }
}

/**
 * The mirror, asked the same question — through `validateEntry`, not the raw
 * shape schema.
 *
 * It called `ScheduleEntrySchema.safeParse` directly, which skipped the very
 * normalisation `validateEntry` performs. That made the comparison unfair in a
 * way that hid rather than caught: the real pipeline is filter → sanitise →
 * validate, and asking only the last step whether an entry survives answers a
 * different question. `{interval_miles: 0, interval_months: 12}` is the case
 * that exposed it — the real schema clears the absent axis and keeps the entry,
 * and the raw schema rejected it on `.positive()`.
 */
function mirrorKeeps(entry: any): boolean {
  return validateEntry(entry).ok;
}

describe('the mirror agrees with VehicleDataSchema', () => {
  it.each([
    ['a complete entry', OIL, true],
    ['no time interval', { ...OIL, interval_months: undefined }, true],
    ['a null time interval', { ...OIL, interval_months: null }, true],
    /*
      Flipped to `true` by Claude Code, 7 Aug, when the real schema learned to
      tell *absent* from *malformed*. `0` is what the research prompt tells the
      model to write where it has no data, so `{miles: 0, months: 12}` is an
      ordinary time-only service, not a broken one. It is cleared to null and
      kept. The malformed cases below still drop.
    */
    ['a zero mileage interval beside a real time interval', { ...OIL, interval_miles: 0 }, true],
    ['a negative mileage interval', { ...OIL, interval_miles: -7500 }, false],
    ['a stringified mileage interval', { ...OIL, interval_miles: '7500' }, false],
    ['an infinite mileage interval', { ...OIL, interval_miles: Infinity }, false],
    ['a NaN mileage interval', { ...OIL, interval_miles: NaN }, false],
    ['a blank service name', { ...OIL, service: '   ' }, false],
    /*
      Below the line: entries with no mileage at all. Before `c2c5af8` every one
      of these was `false` on the real schema and the backfill carried a second
      schema to write them anyway. They are ordinary cases now.
    */
    ['a time-only entry', { ...OIL, interval_miles: null }, true],
    ['a time-only entry with no mileage field', { ...OIL, interval_miles: undefined }, true],
    ['a zero time interval and no mileage', { ...OIL, interval_miles: null, interval_months: 0 }, false],
    ['an infinite time interval', { ...OIL, interval_months: Infinity }, false],
    ['neither interval', { ...OIL, interval_miles: null, interval_months: null }, false],
  ])('%s', (_label, entry, expected) => {
    // The mirror is only trustworthy if it answers exactly as the real schema
    // does. Asserting both against `expected` rather than against each other
    // means a case where both are wrong together still fails.
    expect(mirrorKeeps(entry)).toBe(expected);
    expect(realSchemaKeeps(entry)).toBe(expected);
  });

  it('defaults a missing description rather than losing the entry', () => {
    const { description: _dropped, ...noDescription } = OIL;

    expect(ScheduleEntrySchema.parse(noDescription).description).toBe('');
    expect(realSchemaKeeps(noDescription)).toBe(true);
  });

  it('drops a malformed entry and clears an absent axis — never throws', () => {
    /*
      The distinction `realSchemaKeeps` flattens, recorded here so it is a known
      property rather than a surprise in production.

      A blank service is removed by the filter — the payload parses, one entry
      short. A malformed `interval_miles` alongside a valid `interval_months`
      now survives the filter and fails validation, so the *whole vehicle
      payload* throws. Louder than the silent drop it replaced, and better for
      it, but a caller that parses a research response has to expect a throw
      where it previously got a shorter array.
    */
    const payload = (entry: unknown) => ({
      known_issues: [{ part: 'x', mileage_range: 'y', severity: 'Low', description: 'z' }],
      maintenance_schedule: [entry],
    });

    expect(() => VehicleDataSchema.parse(payload({ ...OIL, service: '   ' }))).not.toThrow();
    expect(VehicleDataSchema.parse(payload({ ...OIL, service: '   ' })).maintenance_schedule)
      .toHaveLength(0);

    /*
      ── This assertion is inverted from what it was, deliberately ───────────

      It read `.toThrow()`, and the comment above defended that as "louder than
      the silent drop it replaced, and better for it". The louder behaviour was
      real; being better for it was the part that did not survive contact.

      `VehicleDataSchema` guards **onboarding**, and `parse` throws on the whole
      object — so one junk interval took the entire knowledge base down and left
      a new user on a broken first screen. `interval_miles: 0` is not an exotic
      input either: the research prompt instructs the model to use 0 where it
      has no data, which makes the throw reachable on ordinary output.

      So `0` now reads as *absent* and the entry survives on its time interval.
      A **malformed** value — a string, a negative, an infinity — still costs
      the whole entry rather than being nulled, which is the distinction this
      file's own `validateEntry` docblock argued for and was right about.
    */
    expect(() => VehicleDataSchema.parse(payload({ ...OIL, interval_miles: 0 }))).not.toThrow();
    expect(
      VehicleDataSchema.parse(payload({ ...OIL, interval_miles: 0 })).maintenance_schedule
    ).toHaveLength(1);

    expect(() =>
      VehicleDataSchema.parse(payload({ ...OIL, interval_miles: '7500' }))
    ).not.toThrow();
    expect(
      VehicleDataSchema.parse(payload({ ...OIL, interval_miles: '7500' })).maintenance_schedule
    ).toHaveLength(0);
  });
});

describe('time-only entries', () => {
  const BRAKE_FLUID = {
    service: 'Brake fluid flush',
    interval_miles: null,
    interval_months: 24,
    description: 'Moisture-absorbing fluid, replaced on time rather than distance.',
    priority: 'Critical' as const,
  };

  it('survives the real schema now, which is the whole point of c2c5af8', () => {
    const parsed = VehicleDataSchema.parse({
      known_issues: [{ part: 'x', mileage_range: 'y', severity: 'Low', description: 'z' }],
      maintenance_schedule: [BRAKE_FLUID],
    });

    expect(parsed.maintenance_schedule).toHaveLength(1);
    expect(parsed.maintenance_schedule[0]).toMatchObject({
      interval_miles: null,
      interval_months: 24,
    });
  });

  it('the backfill writes it through the same door as everything else', () => {
    const result = validateEntry(BRAKE_FLUID);

    expect(result.ok).toBe(true);
    expect(result.path).toBe('time-only');
    expect(result.value).toMatchObject({ interval_miles: null, interval_months: 24 });
  });

  it('rejects zero months, which would mean due immediately', () => {
    expect(validateEntry({ ...BRAKE_FLUID, interval_months: 0 }).ok).toBe(false);
  });

  it('refuses an entry with no interval at all rather than writing an empty one', () => {
    const result = validateEntry({ ...BRAKE_FLUID, interval_months: null });

    expect(result.ok).toBe(false);
    expect(result.why).toMatch(/neither/);
  });

  it('will not read a malformed mileage as an absent one', () => {
    /*
      The two-schema version fell through to its time-only branch on anything
      `interval_miles` was not a number, so `"7500"` was written as a service
      with no mileage interval at all — a silent downgrade of the exact field
      the backfill exists to populate.
    */
    const result = validateEntry({ ...BRAKE_FLUID, interval_miles: '7500' });

    expect(result.ok).toBe(false);
    expect(result.why).toMatch(/interval_miles/);
  });
});
