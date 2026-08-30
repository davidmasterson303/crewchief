/**
 * One question, and the rules that keep its answer honest.
 *
 * @jest-environment node
 *
 * Track A2a. The thing being guarded is not the arithmetic — it is the
 * *direction* of every rounding decision. A baseline that reports a service as
 * more recently done than it was suppresses a real alert; one that reports it
 * as older raises an alert slightly early. Those are not equivalent errors, and
 * every ambiguity here has to resolve the same way.
 */

import {
  BASELINE_AGE_OPTIONS,
  BASELINE_DESCRIPTION,
  baselineDate,
  buildBaselineRow,
  isBaselineAge,
} from '@wellkept/core/onboarding-baseline';
import { categoryFor, historyLookups } from '@wellkept/core/service-history';
import { evaluateSchedule, type ScheduleEntry } from '@wellkept/core/service-due';

const TODAY = '2026-08-08';

describe('the options', () => {
  it('offers a way to say "I do not know"', () => {
    /*
      Load-bearing. Without a reachable "not sure", people guess — and a guessed
      date stored as an owner-reported baseline is worse than no baseline,
      because nothing afterwards can tell it from a real one.
    */
    const notSure = BASELINE_AGE_OPTIONS.find((option) => option.value === 'not-sure');

    expect(notSure).toBeDefined();
    expect(notSure?.months).toBeNull();
  });

  it('narrows only the values it defines', () => {
    expect(isBaselineAge('under-6-months')).toBe(true);
    expect(isBaselineAge('last-tuesday')).toBe(false);
    expect(isBaselineAge(undefined)).toBe(false);
    expect(isBaselineAge(null)).toBe(false);
    expect(isBaselineAge(6)).toBe(false);
  });
});

describe('baselineDate', () => {
  it('takes the oldest end of the range, never the middle', () => {
    /*
      The rule the whole module turns on. "In the last 6 months" resolves to six
      months ago, not three — because being wrong in the other direction means
      the app quietly tells someone a service is fine when it is not.
    */
    expect(baselineDate('under-6-months', TODAY)).toBe('2026-02-08');
    expect(baselineDate('six-to-twelve', TODAY)).toBe('2025-08-08');
  });

  it('treats "over a year" as eighteen months, not twelve', () => {
    // An open-ended range. Taking its lower bound would be the single place
    // this rounds toward "recently done".
    expect(baselineDate('over-a-year', TODAY)).toBe('2025-02-08');
  });

  it('carries no date for "not sure"', () => {
    expect(baselineDate('not-sure', TODAY)).toBeNull();
  });

  it('clamps rather than rolling forward over a short month', () => {
    /*
      `setUTCMonth` on the 31st lands on a date that does not exist and silently
      rolls into the next month, so six months before 31 August would come out
      as 3 March — three days *newer* than the answer given, in the one
      direction this module must never round. Same clamp, same reason, as
      `addMonths` in service-due.ts.
    */
    expect(baselineDate('under-6-months', '2026-08-31')).toBe('2026-02-28');
  });

  it('returns null for a date it cannot read', () => {
    expect(baselineDate('under-6-months', 'not-a-date')).toBeNull();
  });
});

describe('buildBaselineRow', () => {
  it('records what the owner gave', () => {
    const row = buildBaselineRow({ mileage: 85_000, age: 'six-to-twelve', today: TODAY });

    expect(row).toEqual({
      item_description: BASELINE_DESCRIPTION,
      service_date: '2025-08-08',
      mileage_at_service: 85_000,
      source: 'owner-onboarding',
    });
  });

  it('keeps a mileage even when the date is unknown', () => {
    // "Not sure when, but the odometer said 85,000" is genuinely useful: every
    // mileage-based service can count from it.
    const row = buildBaselineRow({ mileage: 85_000, age: 'not-sure', today: TODAY });

    expect(row?.mileage_at_service).toBe(85_000);
    expect(row?.service_date).toBeNull();
  });

  it('keeps a date even when the mileage is unknown', () => {
    const row = buildBaselineRow({ mileage: null, age: 'under-6-months', today: TODAY });

    expect(row?.service_date).toBe('2026-02-08');
    expect(row?.mileage_at_service).toBeNull();
  });

  it('writes nothing when the answer says nothing', () => {
    /*
      The skip path, and "not sure" with no mileage. A row carrying neither
      would appear in someone's service history saying only "we asked and they
      did not know" — matched by `categoryFor`, rendered on the maintenance
      screen, and useful to nobody.
    */
    expect(buildBaselineRow({ mileage: null, age: 'not-sure', today: TODAY })).toBeNull();
    expect(buildBaselineRow({ mileage: null, age: null, today: TODAY })).toBeNull();
  });

  it.each([
    ['a negative reading', -1],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('discards %s rather than storing it', (_label, mileage) => {
    const row = buildBaselineRow({ mileage: mileage as number, age: 'under-6-months', today: TODAY });

    expect(row?.mileage_at_service).toBeNull();
  });

  it('keeps a genuine zero', () => {
    const row = buildBaselineRow({ mileage: 0, age: 'not-sure', today: TODAY });

    expect(row?.mileage_at_service).toBe(0);
  });
});

describe('the row actually works end to end', () => {
  it('is described in words the matcher recognises', () => {
    /*
      The single most breakable link in A2a, and it breaks silently: if the
      description stops matching, the row is still written, still stored, still
      visible — and never resolves a single service. Asking the question would
      become pure cost.
    */
    expect(categoryFor(BASELINE_DESCRIPTION)).toBe('Oil Change');
  });

  it('gives a scheduled oil change a baseline, labelled as a recollection', () => {
    const row = buildBaselineRow({ mileage: 85_000, age: 'six-to-twelve', today: TODAY });
    const OIL: ScheduleEntry = {
      service: 'Engine oil and filter',
      interval_miles: 7_500,
      priority: 'Critical',
    };

    const [oil] = evaluateSchedule({
      schedule: [OIL],
      currentMileage: 94_800,
      ...historyLookups([row!]),
    });

    // 85,000 + 7,500 — and long past, at 94,800.
    expect(oil.dueAtMiles).toBe(92_500);
    expect(oil.status).toBe('overdue');
    expect(oil.evidence).toBe('owner-reported');
  });

  it('leaves the services it was never asked about estimated', () => {
    /*
      The honest limit of one question. Spark plugs get no baseline from an oil
      change answer, and must not appear to — the receipts path is how those
      stop being estimates.
    */
    const row = buildBaselineRow({ mileage: 85_000, age: 'six-to-twelve', today: TODAY });
    const PLUGS: ScheduleEntry = { service: 'Spark plugs', interval_miles: 30_000 };

    const [plugs] = evaluateSchedule({
      schedule: [PLUGS],
      currentMileage: 94_800,
      ...historyLookups([row!]),
    });

    expect(plugs.evidence).toBeNull();
    expect(plugs.basedOnHistory).toBe(false);
  });
});
