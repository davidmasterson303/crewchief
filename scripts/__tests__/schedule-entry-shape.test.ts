/**
 * The backfill's mirror of the schedule shape has to agree with the real one.
 *
 * `scripts/lib/schedule-entry-shape.mjs` re-declares
 * `VehicleDataSchema.maintenance_schedule` because the backfill script is a
 * `.mjs` file and the schema is TypeScript. This is what makes that duplication
 * safe rather than merely convenient: both are run against the same cases, and
 * a change to either that the other does not follow turns this red.
 *
 * ── The second half of this file is a ratchet, not a description ────────────
 *
 * It asserts that the real schema currently *drops* a time-only entry. That is
 * a bug, it is documented as one, and the backfill routes around it. The test
 * exists so the day someone fixes `isUsableScheduleEntry` this file fails and
 * says where the workaround lives — rather than the workaround quietly
 * outliving the problem, which is how a temporary route around a defect becomes
 * permanent.
 */

import { VehicleDataSchema } from '@crewchief/core/vehicle-utils';
import { MileageEntrySchema, validateEntry } from '../lib/schedule-entry-shape.mjs';

const OIL = {
  service: 'Engine oil and filter',
  interval_miles: 7500,
  interval_months: 12,
  description: 'Drain, refill, replace the filter.',
  priority: 'Critical' as const,
};

/** The real schema, asked about one entry: does it survive to the other side? */
function realSchemaKeeps(entry: unknown): boolean {
  const parsed = VehicleDataSchema.parse({
    known_issues: [{ part: 'x', mileage_range: 'y', severity: 'Low', description: 'z' }],
    maintenance_schedule: [entry],
  });
  return parsed.maintenance_schedule.length === 1;
}

/** The mirror, asked the same question. */
function mirrorKeeps(entry: any): boolean {
  return MileageEntrySchema.safeParse(entry).success;
}

describe('the mirror agrees with VehicleDataSchema on mileage entries', () => {
  it.each([
    ['a complete entry', OIL, true],
    ['no time interval', { ...OIL, interval_months: undefined }, true],
    ['a null time interval', { ...OIL, interval_months: null }, true],
    ['a zero mileage interval', { ...OIL, interval_miles: 0 }, false],
    ['a negative mileage interval', { ...OIL, interval_miles: -7500 }, false],
    ['a stringified mileage interval', { ...OIL, interval_miles: '7500' }, false],
    ['an infinite mileage interval', { ...OIL, interval_miles: Infinity }, false],
    ['a NaN mileage interval', { ...OIL, interval_miles: NaN }, false],
    ['a blank service name', { ...OIL, service: '   ' }, false],
  ])('%s', (_label, entry, expected) => {
    // The mirror is only trustworthy if it answers exactly as the real schema
    // does. Asserting both against `expected` rather than against each other
    // means a case where both are wrong together still fails.
    expect(mirrorKeeps(entry)).toBe(expected);
    expect(realSchemaKeeps(entry)).toBe(expected);
  });

  it('defaults a missing description rather than losing the entry', () => {
    const { description: _dropped, ...noDescription } = OIL;

    expect(MileageEntrySchema.parse(noDescription).description).toBe('');
    expect(realSchemaKeeps(noDescription)).toBe(true);
  });

  it('is deliberately stricter than the real schema on an infinite interval_months', () => {
    /*
      The one place the two are allowed to differ, recorded here rather than
      left to be discovered.

      `isUsableScheduleEntry` applies `Number.isFinite` to `interval_miles` and
      nothing at all to `interval_months`, and the inner `z.number().positive()`
      accepts `Infinity`. So the real schema keeps a service due in infinity
      months. That was harmless while `evaluateSchedule` never read the field.
      `c09ccf8` made it load-bearing and the write-side discipline did not
      follow — `statusForMonths(Infinity)` returns `later`, so the service
      renders as fine, forever.

      The backfill will not write one. Worth fixing in the schema too, at which
      point this test becomes an equivalence case like the rest.
    */
    expect(realSchemaKeeps({ ...OIL, interval_months: Infinity })).toBe(true);
    expect(mirrorKeeps({ ...OIL, interval_months: Infinity })).toBe(false);
  });
});

describe('time-only entries: the gap the backfill routes around', () => {
  const BRAKE_FLUID = {
    service: 'Brake fluid flush',
    interval_miles: null,
    interval_months: 24,
    description: 'Moisture-absorbing fluid, replaced on time rather than distance.',
    priority: 'Critical' as const,
  };

  it('RATCHET: VehicleDataSchema still drops them — delete this when that is fixed', () => {
    /*
      `isUsableScheduleEntry` requires `interval_miles > 0` and runs as a
      `preprocess` filter, so this entry is removed before validation rather
      than rejected by it. No error, no warning, an empty array.

      When this expectation flips to 1, `isUsableScheduleEntry` has learned
      about time and the backfill should validate everything through the real
      schema again — see `TimeOnlyEntrySchema` in
      `scripts/lib/schedule-entry-shape.mjs`.
    */
    const parsed = VehicleDataSchema.parse({
      known_issues: [{ part: 'x', mileage_range: 'y', severity: 'Low', description: 'z' }],
      maintenance_schedule: [BRAKE_FLUID],
    });

    expect(parsed.maintenance_schedule).toHaveLength(0);
  });

  it('the backfill keeps them, because evaluateSchedule now reads months', () => {
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
});
