/**
 * History becomes a baseline, or honestly becomes nothing.
 *
 * @jest-environment node
 *
 * Track A2a. `evaluateSchedule` has accepted history lookups since it was
 * written and nothing ever passed any, so every service on the milestone screen
 * has been either `unknown` or estimated from the odometer. This suite drives
 * the adapter that closes that, and most of it is about the ways a wrong
 * baseline is worse than none:
 *
 *   - claiming a service was done *now* because no mileage was recorded
 *   - letting an undated scrap displace a fully recorded service
 *   - calling a recollection a record
 *   - matching "brake fluid" to "brake inspection" on the word "brake"
 *
 * Each of those produces a confident, wrong "nothing due" — the failure mode
 * `service-due.ts` names in its own header as the fastest way to teach someone
 * the alerts are noise.
 */

import {
  categoryFor,
  historyLookups,
  MATCHABLE_CATEGORIES,
  type ServiceHistoryRow,
} from '@crewchief/core/service-history';
import { getKeywordsForCategory } from '@crewchief/core/maintenance-sync';
import { evaluateSchedule, type ScheduleEntry } from '@crewchief/core/service-due';

describe('categoryFor', () => {
  it('matches a model-written schedule entry', () => {
    // The whole reason this exists: the schedule is generated per vehicle and
    // its wording is not the keyword map's key.
    expect(categoryFor('Engine oil and filter')).toBe('Oil Change');
    expect(categoryFor('Spark plug replacement')).toBe('Spark Plugs');
  });

  it('matches an invoice line for the same work', () => {
    // The other side of the same question. These two strings share no useful
    // substring with each other — only a category.
    expect(categoryFor('Oil change — Motul 5W-30, OEM filter')).toBe('Oil Change');
  });

  it('prefers the longest keyword when two categories genuinely both match', () => {
    /*
      **A cabin air filter is not an engine air filter**, and "cabin air filter"
      contains "air filter" as a substring. Both categories match this string,
      `Air Filter` is declared first, and a first-match-wins loop therefore
      returns the wrong one — giving the engine filter a baseline from the cabin
      filter's service and vice versa.

      This replaced a weaker case. The first version of this test used "brake
      fluid replacement" against `Brake Fluid` / `Brake Inspection` and looked
      like it proved the same thing — but only one of those categories has a
      keyword in that string, so there was no tie to break. **A mutation to
      first-match-wins left it green**, which is the only reason the gap was
      visible. The pair below is a real overlap in both directions.
    */
    expect(categoryFor('Cabin air filter replacement')).toBe('Cabin Air Filter');
    expect(categoryFor('Engine air filter')).toBe('Air Filter');
  });

  it('separates the two brake categories', () => {
    // Not a tie-break — neither string matches the other category at all — but
    // worth pinning, because "brake" alone would match everything and an
    // over-eager keyword added later is how that starts.
    expect(categoryFor('Brake fluid replacement')).toBe('Brake Fluid');
    expect(categoryFor('Front brake pad and rotor replacement')).toBe('Brake Inspection');
  });

  it('returns null rather than guessing', () => {
    expect(categoryFor('Four-wheel alignment')).toBeNull();
    expect(categoryFor('')).toBeNull();
    expect(categoryFor('   ')).toBeNull();
  });

  it('knows every category the keyword map defines', () => {
    /*
      `MATCHABLE_CATEGORIES` is a hand-written list, because
      `CATEGORY_KEYWORD_MAP` is not exported. That is a duplication, and this is
      the assertion that stops it rotting: a category added to the map without
      being added here would simply never match, silently, and the only symptom
      would be a service that never finds its history.
    */
    for (const category of MATCHABLE_CATEGORIES) {
      expect(getKeywordsForCategory(category).length).toBeGreaterThan(0);
    }
  });
});

describe('historyLookups', () => {
  const OIL_INVOICE: ServiceHistoryRow = {
    item_description: 'Oil change — full synthetic',
    service_date: '2026-02-10',
    mileage_at_service: 58_000,
    source: 'vision',
  };

  it('supplies the mileage and date for a matched service', () => {
    const { lastServiceMileage, lastServiceDate } = historyLookups([OIL_INVOICE]);

    expect(lastServiceMileage('Engine oil and filter')).toBe(58_000);
    expect(lastServiceDate('Engine oil and filter')).toBe('2026-02-10');
  });

  it('says nothing about a service it has no row for', () => {
    const { lastServiceMileage, lastServiceDate, lastServiceEvidence } =
      historyLookups([OIL_INVOICE]);

    expect(lastServiceMileage('Spark plugs')).toBeNull();
    expect(lastServiceDate('Spark plugs')).toBeNull();
    expect(lastServiceEvidence('Spark plugs')).toBeNull();
  });

  describe('the mileage that is not there', () => {
    it('returns null rather than the current odometer', () => {
      /*
        The defect this module exists to avoid, and it is live in
        `maintenance-sync.ts`: `getItemMileage(best) || currentMileage`. A row
        with no recorded mileage reports the odometer *right now*, which reads
        as "this was done today" and pushes the next service a full interval
        out. One undated receipt would mean nothing due, forever.
      */
      const { lastServiceMileage } = historyLookups([
        { item_description: 'Oil change', service_date: '2026-02-10', source: 'vision' },
      ]);

      expect(lastServiceMileage('Engine oil and filter')).toBeNull();
    });

    it('keeps a genuine zero', () => {
      // A truthiness test would discard this as missing. 0 is a real reading on
      // a car delivered with a pre-delivery service.
      const { lastServiceMileage } = historyLookups([
        { item_description: 'Oil change', mileage_at_service: 0, source: 'seed' },
      ]);

      expect(lastServiceMileage('Engine oil and filter')).toBe(0);
    });

    it.each([
      ['a negative reading', -5],
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
    ])('rejects %s', (_label, value) => {
      const { lastServiceMileage } = historyLookups([
        { item_description: 'Oil change', mileage_at_service: value as number },
      ]);

      expect(lastServiceMileage('Engine oil and filter')).toBeNull();
    });
  });

  describe('picking between rows for the same service', () => {
    it('takes the later date', () => {
      const { lastServiceMileage } = historyLookups([
        { item_description: 'Oil change', service_date: '2025-01-01', mileage_at_service: 40_000 },
        { item_description: 'Oil change', service_date: '2026-02-10', mileage_at_service: 58_000 },
      ]);

      expect(lastServiceMileage('Engine oil and filter')).toBe(58_000);
    });

    it('does not depend on the order they arrive in', () => {
      // Same two rows, reversed. A comparison that only ever replaces the held
      // row would pass one ordering and fail the other.
      const { lastServiceMileage } = historyLookups([
        { item_description: 'Oil change', service_date: '2026-02-10', mileage_at_service: 58_000 },
        { item_description: 'Oil change', service_date: '2025-01-01', mileage_at_service: 40_000 },
      ]);

      expect(lastServiceMileage('Engine oil and filter')).toBe(58_000);
    });

    it('falls back to the higher odometer when neither is dated', () => {
      // An odometer is monotonic, so a higher reading is later by definition.
      const { lastServiceMileage } = historyLookups([
        { item_description: 'Oil change', mileage_at_service: 40_000 },
        { item_description: 'Oil change', mileage_at_service: 58_000 },
      ]);

      expect(lastServiceMileage('Engine oil and filter')).toBe(58_000);
    });

    it('never lets an empty row displace a recorded one', () => {
      /*
        The nastiest ordering bug available here. An undated, unmetered receipt
        arriving second must not become "the most recent service" and take the
        baseline to null with it — that would turn a car with good records into
        a car with none, depending on row order.
      */
      const { lastServiceMileage, lastServiceDate } = historyLookups([
        OIL_INVOICE,
        { item_description: 'Oil change', source: 'manual' },
      ]);

      expect(lastServiceMileage('Engine oil and filter')).toBe(58_000);
      expect(lastServiceDate('Engine oil and filter')).toBe('2026-02-10');
    });
  });

  describe('evidence', () => {
    it('calls an onboarding answer a recollection', () => {
      const { lastServiceEvidence } = historyLookups([
        {
          item_description: 'Oil change — previous owner, from memory',
          mileage_at_service: 85_000,
          source: 'owner-onboarding',
        },
      ]);

      expect(lastServiceEvidence('Engine oil and filter')).toBe('owner-reported');
    });

    it.each(['vision', 'manual', 'seed', null, undefined])(
      'treats source %s as a record',
      (source) => {
        /*
          The `null` case is the documented over-claim. `20260801120000` refuses
          to guess the provenance of rows written before it, and treating them
          as records preserves what the app already claimed rather than
          reclassifying months of real history the day A2a shipped.
        */
        const { lastServiceEvidence } = historyLookups([
          { item_description: 'Oil change', mileage_at_service: 58_000, source },
        ]);

        expect(lastServiceEvidence('Engine oil and filter')).toBe('records');
      }
    );
  });
});

describe('feeding evaluateSchedule, which is the point', () => {
  const OIL: ScheduleEntry = {
    service: 'Engine oil and filter',
    interval_miles: 7_500,
    priority: 'Critical',
  };
  const BRAKE_FLUID: ScheduleEntry = {
    service: 'Brake fluid replacement',
    interval_months: 24,
    priority: 'Critical',
  };

  it('resolves a time-only service that was permanently unknown', () => {
    /*
      Brake fluid on all four cars. With no date to count from there is no
      computable due point, so it reports `unknown` — correct, and useless. One
      history row is the whole difference.
    */
    const before = evaluateSchedule({
      schedule: [BRAKE_FLUID],
      currentMileage: 94_800,
      today: '2026-08-08',
    });
    expect(before[0].status).toBe('unknown');

    const lookups = historyLookups([
      { item_description: 'Brake fluid flush — DOT 4', service_date: '2025-09-01', source: 'vision' },
    ]);
    const after = evaluateSchedule({
      schedule: [BRAKE_FLUID],
      currentMileage: 94_800,
      today: '2026-08-08',
      ...lookups,
    });

    expect(after[0].status).not.toBe('unknown');
    expect(after[0].evidence).toBe('records');
  });

  it('counts from the recorded service rather than the odometer', () => {
    // Without history, a 7,500 interval at 60,000 miles reports due at 60,000
    // — the next boundary above the reading. With it, 58,000 + 7,500.
    const lookups = historyLookups([
      { item_description: 'Oil change', service_date: '2026-02-10', mileage_at_service: 58_000 },
    ]);

    const [oil] = evaluateSchedule({ schedule: [OIL], currentMileage: 60_000, ...lookups });

    expect(oil.dueAtMiles).toBe(65_500);
    expect(oil.basedOnHistory).toBe(true);
  });

  it('carries an owner-reported baseline through as the weaker claim', () => {
    const lookups = historyLookups([
      {
        item_description: 'Oil change at previous owner',
        mileage_at_service: 58_000,
        source: 'owner-onboarding',
      },
    ]);

    const [oil] = evaluateSchedule({ schedule: [OIL], currentMileage: 60_000, ...lookups });

    expect(oil.dueAtMiles).toBe(65_500);
    expect(oil.evidence).toBe('owner-reported');
  });
});
