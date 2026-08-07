/**
 * A maintenance interval has to be comparable to an odometer reading.
 *
 * @jest-environment node
 *
 * `MaintenanceScheduleItem` in `packages/core/src/types.ts` has declared
 * `interval_miles: number` since the type was written, and **nothing ever
 * produced it** — the research prompt emitted `{item, interval: "every 30,000
 * miles"}` and `app/actions.ts` reconciled the two with `item.item ||
 * item.service`. A type describing a contract nothing satisfies is the same
 * failure as `build_assets.py`, referenced everywhere and never committed.
 *
 * Phase 5's service-due notification is what makes it matter: prose cannot be
 * compared to a number, so a schedule of prose cannot tell anyone their car
 * needs work. This file holds the shape that fixed it.
 *
 * Two properties here are load-bearing and neither is obvious:
 *
 *   1. **A bad entry costs one entry, not the knowledge base.** This schema
 *      guards onboarding. `parse` throws on the whole object, so strict
 *      validation of a hallucinated interval would fail a new user's first
 *      screen entirely.
 *   2. **A legacy prose entry is dropped, not parsed.** Guessing a number out
 *      of "every 2 years or 24k" would be right most of the time, and most of
 *      the time is the wrong standard for telling someone to spend money.
 */

import { VehicleDataSchema, isUsableScheduleEntry } from '@crewchief/core/vehicle-utils';
import { VEHICLE_RESEARCH_PROMPT } from '@crewchief/core/prompts';

/** A research response with only the field under test filled in. */
function research(maintenance: unknown) {
  return { maintenance_schedule: maintenance };
}

const OIL_CHANGE = {
  service: 'Engine oil and filter',
  interval_miles: 7500,
  interval_months: 12,
  description: 'Drain the oil, replace the filter, reset the service counter.',
  priority: 'Critical' as const,
};

/*
  Miles and nothing else.

  The bad-interval cases below have to use this rather than `OIL_CHANGE`: since
  7 Aug an entry is usable if it carries *either* a mileage or a month interval,
  so `{...OIL_CHANGE, interval_miles: 0}` is still perfectly usable on its
  12-month interval. Asserting rejection with a fixture that carries a valid
  second interval would test nothing and pass for the wrong reason.
*/
const MILES_ONLY = {
  service: 'Engine oil and filter',
  interval_miles: 7500,
  priority: 'Critical' as const,
};

/** Time and nothing else — every car in the product has one of these. */
const TIME_ONLY = {
  service: 'Brake fluid flush',
  interval_months: 24,
  priority: 'Critical' as const,
};

describe('isUsableScheduleEntry', () => {
  it('accepts an entry carrying a comparable mileage number', () => {
    expect(isUsableScheduleEntry(OIL_CHANGE)).toBe(true);
  });

  it('rejects the legacy prose shape rather than parsing it', () => {
    // Every vehicle onboarded before 7 Aug 2026 looks like this. Ineligible
    // for a notification until regenerated — deliberately, see the header.
    expect(
      isUsableScheduleEntry({ item: 'Engine oil', interval: 'every 7,500 miles', priority: 'Critical' })
    ).toBe(false);
  });

  it('accepts a time-only entry, which every car in the product has', () => {
    /*
      The half-fix this closes. `c09ccf8` taught the *read* side that a service
      can be time-based; this — the write side — still required miles, so a
      time-only brake fluid entry could be evaluated and never stored. Because
      the array is filtered by `preprocess` rather than validated, it vanished
      with no error. Found by Cowork building the backfill.
    */
    expect(isUsableScheduleEntry(TIME_ONLY)).toBe(true);
  });

  it('rejects a zero interval, which would be overdue on every car forever', () => {
    // The prompt's own "0 for numbers" fallback produces exactly this.
    expect(isUsableScheduleEntry({ ...MILES_ONLY, interval_miles: 0 })).toBe(false);
  });

  it('keeps an entry whose mileage is junk but whose months are real', () => {
    // Not a contradiction of the case above: "either interval" means a valid
    // month interval carries the entry. `service-due.ts` then ignores the junk
    // mileage on its own `Number.isFinite` guard and evaluates on time.
    expect(isUsableScheduleEntry({ ...TIME_ONLY, interval_miles: 0 })).toBe(true);
  });

  it.each([
    ['a negative interval', { ...MILES_ONLY, interval_miles: -5000 }],
    ['a stringified number', { ...MILES_ONLY, interval_miles: '7500' }],
    ['an infinite interval', { ...MILES_ONLY, interval_miles: Infinity }],
    ['a NaN interval', { ...MILES_ONLY, interval_miles: NaN }],
    ['a blank service name', { ...MILES_ONLY, service: '   ' }],
    ['null', null],
    ['a string', 'Engine oil every 7500 miles'],
  ])('rejects %s', (_label, entry) => {
    expect(isUsableScheduleEntry(entry)).toBe(false);
  });

  it.each([
    ['an infinite month interval', { ...TIME_ONLY, interval_months: Infinity }],
    ['a NaN month interval', { ...TIME_ONLY, interval_months: NaN }],
    ['a zero month interval', { ...TIME_ONLY, interval_months: 0 }],
    ['a stringified month interval', { ...TIME_ONLY, interval_months: '24' }],
  ])('rejects %s', (_label, entry) => {
    /*
      `Number.isFinite` was applied to miles and to nothing else, and zod's
      `.positive()` accepts `Infinity` — a number that passes every check and
      describes a service that is never due. Harmless until `c09ccf8` made the
      field load-bearing. Caught by Cowork, 7 Aug.
    */
    expect(isUsableScheduleEntry(entry)).toBe(false);
  });
});

describe('VehicleDataSchema.maintenance_schedule', () => {
  it('keeps a structured entry whole', () => {
    const parsed = VehicleDataSchema.parse(research([OIL_CHANGE]));

    expect(parsed.maintenance_schedule).toEqual([OIL_CHANGE]);
  });

  it('drops one bad entry and keeps the rest', () => {
    // The property this whole design turns on. Eleven services and an absent
    // twelfth is recoverable; a failed onboarding is not.
    const parsed = VehicleDataSchema.parse(
      research([OIL_CHANGE, { service: 'Guesswork', interval_miles: 0, priority: 'Critical' }])
    );

    expect(parsed.maintenance_schedule).toHaveLength(1);
    expect(parsed.maintenance_schedule[0].service).toBe('Engine oil and filter');
  });

  it('does not throw when every entry is unusable', () => {
    // A whole legacy schedule, or a whole hallucinated one. An empty schedule
    // is a car with no service notifications, which is the correct outcome —
    // not a car that failed to onboard.
    const parsed = VehicleDataSchema.parse(
      research([{ item: 'Engine oil', interval: 'every 7,500 miles', priority: 'Critical' }])
    );

    expect(parsed.maintenance_schedule).toEqual([]);
  });

  it('survives the field being absent, a string, or null', () => {
    // `extractJSON` hands over whatever the model produced. None of these
    // should reach a user as an onboarding failure.
    for (const raw of [undefined, null, 'no schedule available', 42]) {
      expect(() => VehicleDataSchema.parse(research(raw))).not.toThrow();
    }
  });

  it('treats interval_months as optional, because not every service has one', () => {
    const { interval_months: _omitted, ...noTimeInterval } = OIL_CHANGE;

    const parsed = VehicleDataSchema.parse(research([noTimeInterval]));
    expect(parsed.maintenance_schedule).toHaveLength(1);
  });

  it('accepts null for interval_months, which is what the prompt asks for', () => {
    // The prompt says "use null, not 0" — 0 months would mean due immediately,
    // the same trap as interval_miles.
    const parsed = VehicleDataSchema.parse(research([{ ...OIL_CHANGE, interval_months: null }]));

    expect(parsed.maintenance_schedule).toHaveLength(1);
  });

  it('defaults a missing description rather than dropping the service', () => {
    // The description is what the service *involves* — good to have on the
    // milestone screen, not worth losing a known interval over.
    const { description: _omitted, ...noDescription } = OIL_CHANGE;

    const parsed = VehicleDataSchema.parse(research([noDescription]));
    expect(parsed.maintenance_schedule[0].description).toBe('');
  });
});

describe('the prompt asks for the shape the schema accepts', () => {
  const prompt = VEHICLE_RESEARCH_PROMPT(2018, 'Honda', 'Accord');

  it('names the structured fields', () => {
    // The prompt and the schema are two halves of one contract with no
    // compile-time link between them: the model reads one and zod enforces the
    // other. Asking for `interval` while validating `interval_miles` means
    // every schedule silently arrives empty — parsed successfully, filtered
    // entirely, and reported by nothing.
    expect(prompt).toContain('"service"');
    expect(prompt).toContain('"interval_miles"');
    expect(prompt).toContain('"interval_months"');
  });

  it('no longer asks for the prose interval it used to', () => {
    expect(prompt).not.toContain('{"item": "string", "interval": "string"');
  });

  it('tells the model a number, not a phrase', () => {
    // The Performance Stats precedent in the same prompt — "numeric value only
    // (e.g., 5.2, not '5.2 seconds')" — is what this follows.
    expect(prompt).toMatch(/numeric value only.*30000/);
  });

  it('overrides the "0 for numbers" fallback for the one field it would break', () => {
    // That general instruction sits above this field and would otherwise
    // produce a service due at zero miles.
    expect(prompt).toMatch(/interval_miles MUST be a positive number/);
  });
});

describe('the rest of the knowledge base is unaffected', () => {
  it('still parses a response with no maintenance schedule at all', () => {
    // Guards the guard: if this schema had been broken by the change above,
    // every assertion in this file would be about a schema nobody can use.
    const parsed = VehicleDataSchema.parse({
      known_issues: [
        { part: 'Turbo', mileage_range: '60k-90k', severity: 'High', description: 'Wastegate rattle' },
      ],
      reliability_score: 7,
    });

    expect(parsed.known_issues).toHaveLength(1);
    expect(parsed.reliability_score).toBe(7);
    expect(parsed.maintenance_schedule).toEqual([]);
  });
});
