/**
 * A missing health score is "we cannot say", never a reading — D10 — and the
 * dashboard hero says what it actually read rather than running a timer — D13.
 *
 * ── What shipped, and why the existing guards did not catch it ──────────────
 *
 * `app/actions.ts` was fixed on 24 Aug so a model that declines to score writes
 * `null` instead of the hardcoded 70. That was the whole of FN-01 as far as the
 * *server* was concerned, and it was verified by tests over the parser.
 *
 * Nothing tested what the clients did with the `null`. All three of them turned
 * it back into a number:
 *
 *   - `DiagnosticHero`  `healthScore ?? 0`      → a red dial reading 0
 *   - `VehicleCard`     prop typed `number`, fed from an `any` → the same
 *   - the collapsed fold  `${score} · ${band}`  → "0 · Needs attention"
 *
 * So the fix made the database honest and left the screen lying, which is the
 * worse of the two states: the number now had a provenance story behind it.
 *
 * These are unit tests over the pure modules rather than over the components —
 * `hero-photo-fallback.test.tsx` holds the rendering half — because the rules
 * being asserted are decisions, and a decision tested through a DOM query is
 * one refactor away from being untested.
 */

import {
  driversForVehicle,
  driversSupportAScore,
  maintenanceDriver,
  recallDriver,
  type HealthDriver,
} from '@wellkept/core/health-drivers';
import {
  describeReadWork,
  hasReadWorkToNarrate,
  readWorkCount,
} from '@wellkept/core/work-narration';

const driver = (score: number | null): HealthDriver => ({
  key: 'maintenance',
  label: 'Maintenance',
  score,
  detail: 'irrelevant to this assertion',
});

describe('a score is only bandable when something computable supports it', () => {
  it('refuses when every driver is null', () => {
    expect(driversSupportAScore([driver(null), driver(null), driver(null)])).toBe(false);
  });

  it('refuses when there are no drivers at all', () => {
    // A caller that has not wired the drivers must not be read as a car about
    // which everything is known.
    expect(driversSupportAScore([])).toBe(false);
  });

  /*
    ⚠ The anti-vacuous half, and the more important one. A rule that refused on
    *any* null would blank the dial for most real vehicles — a car with an
    odometer and no recall lookup is the ordinary case — and a guard that fires
    constantly is one that gets made to pass. See rule 5.
  */
  it('permits when a single driver has a reading, however many are null', () => {
    expect(driversSupportAScore([driver(null), driver(72), driver(null)])).toBe(true);
  });

  it('permits the fully-known car', () => {
    expect(driversSupportAScore([driver(88), driver(100), driver(65)])).toBe(true);
  });
});

describe('the drivers assemble the same way for every client', () => {
  /*
    The regression this closes is not arithmetic, it is *reach*: the assembly
    lived inside one API route, so the web dashboard had no drivers to consult
    and D10's "refuse to render a band" had nothing to refuse against.
  */
  it('reports a car with no schedule and no lookup as entirely unknown', () => {
    const drivers = driversForVehicle({
      schedule: null,
      historyRows: [],
      recalls: undefined,
      currentMileage: null,
      year: null,
    });

    expect(drivers.map((d) => d.score)).toEqual([null, null, null]);
    expect(driversSupportAScore(drivers)).toBe(false);

    // Every null carries its own sentence — a dash alone reads as a bug.
    for (const d of drivers) expect(d.detail.length).toBeGreaterThan(0);
  });

  it('distinguishes a recall lookup that ran from one that never did', () => {
    const never = driversForVehicle({
      schedule: null,
      historyRows: [],
      recalls: undefined,
      currentMileage: 40_000,
      year: 2015,
    });
    const ranAndFoundNothing = driversForVehicle({
      schedule: null,
      historyRows: [],
      recalls: [],
      currentMileage: 40_000,
      year: 2015,
    });

    expect(never.find((d) => d.key === 'recalls')!.score).toBeNull();
    expect(ranAndFoundNothing.find((d) => d.key === 'recalls')!.score).toBe(100);

    // And the odometer pair is a real reading in both, so the suite can still
    // detect a score on this path.
    expect(never.find((d) => d.key === 'mileage-load')!.score).not.toBeNull();
  });
});

describe('nothing known is not nothing overdue', () => {
  /*
    FN-01b. `STATUS_PENALTY.unknown` is 0, which is right, and 100 - 0 = 100 was
    a perfect maintenance score for a car with no records at all. Kept here as
    well as at the source because it is the exact shape of defect the whole file
    exists against, and a second reader is cheap.
  */
  it('scores null, not 100, when every tracked service is unknown', () => {
    const result = maintenanceDriver([
      { service: 'Brake fluid', status: 'unknown', priority: 'Critical' } as never,
      { service: 'Cabin filter', status: 'unknown', priority: 'Optional' } as never,
    ]);

    expect(result.score).toBeNull();
    expect(result.detail).toMatch(/no service records/i);
  });

  it('still scores when at least one service can be checked', () => {
    const result = maintenanceDriver([
      { service: 'Brake fluid', status: 'unknown', priority: 'Critical' } as never,
      { service: 'Oil change', status: 'later', priority: 'Critical' } as never,
    ]);

    expect(result.score).not.toBeNull();
  });

  it('reads an absent recall list as unchecked rather than clear', () => {
    expect(recallDriver(undefined).score).toBeNull();
    expect(recallDriver(null).score).toBeNull();
    // Anti-vacuous: a genuine empty result is a genuine all-clear.
    expect(recallDriver([]).score).toBe(100);
  });
});

describe('the hero says what it read', () => {
  it('names real counts', () => {
    expect(describeReadWork({ serviceRecords: 12, recalls: 3 })).toBe(
      'Read 12 service records and 3 recall campaigns.'
    );
    expect(describeReadWork({ serviceRecords: 1, recalls: null })).toBe('Read 1 service record.');
  });

  /*
    The state the old caption rendered as "Diagnostics complete". It is the one
    an owner most needs the truth about and the only one they can act on.
  */
  it('says plainly when it read nothing', () => {
    expect(describeReadWork({ serviceRecords: 0, recalls: 0 })).toBe(
      'No service records on file, and no recalls found for this year, make and model.'
    );
  });

  it('never claims a diagnostic, in any state', () => {
    const states = [
      { serviceRecords: 12, recalls: 3 },
      { serviceRecords: 0, recalls: 0 },
      { serviceRecords: null, recalls: null },
      { serviceRecords: 0, recalls: null },
    ];

    for (const state of states) {
      const line = describeReadWork(state);
      // `null` is a legitimate answer — see the next test — and a null caption
      // cannot claim anything, so only the rendered ones are checked.
      if (line !== null) {
        expect(line).not.toMatch(/diagnos|scanning|complete|analysing|analyzing/i);
        expect(line.length).toBeGreaterThan(0);
      }
    }
  });

  /*
    ── ⚠ Handoff §1.4 · "show nothing rather than a timer" ───────────────────

    This asserted a consolation sentence — "Nothing read for this car yet." —
    for the state where neither read resolved. That filled the caption's slot to
    avoid an empty one, which is the same reflex that produced the timer: the
    layout would rather say something than look unfinished.

    `null` now, and the hero renders no caption at all.
  */
  it('says nothing when there is nothing true to say', () => {
    expect(describeReadWork({ serviceRecords: null, recalls: null })).toBeNull();
    expect(hasReadWorkToNarrate({ serviceRecords: null, recalls: null })).toBe(false);
  });

  it('still speaks for a check that ran and found nothing', () => {
    /*
      ⚠ The anti-vacuous half, and the distinction the whole module turns on. A
      completed check that found nothing is a **result**; not having looked is
      not. Collapsing them to `null` would be as wrong as the old sentence, in
      the other direction.
    */
    expect(describeReadWork({ serviceRecords: 0, recalls: null })).toBe(
      'No service records on file yet.'
    );
    expect(describeReadWork({ serviceRecords: 0, recalls: 0 })).toBe(
      'No service records on file, and no recalls found for this year, make and model.'
    );
    expect(hasReadWorkToNarrate({ serviceRecords: 0, recalls: 0 })).toBe(true);
  });

  /*
    ── ⚠ Handoff §1.4 · the beat counts, and counts something true ───────────

    David's call was to keep the moment of assembly and change its subject, not
    to delete it. The sentence's *shape* comes from the settled figures and only
    the numeral is substituted, so a sweep toward 12 never passes through the
    "no records" phrasing on its way up — which is exactly what would happen if
    the caption were re-derived from the animated value each frame.
  */
  it('substitutes the animated count without changing the sentence', () => {
    const work = { serviceRecords: 12, recalls: 3 };

    expect(describeReadWork(work, 0)).toBe('Read 0 service records and 3 recall campaigns.');
    expect(describeReadWork(work, 1)).toBe('Read 1 service record and 3 recall campaigns.');
    expect(describeReadWork(work, 7)).toBe('Read 7 service records and 3 recall campaigns.');
    expect(describeReadWork(work, 12)).toBe('Read 12 service records and 3 recall campaigns.');

    // At rest it agrees with the un-parameterised form.
    expect(describeReadWork(work, readWorkCount(work))).toBe(describeReadWork(work));
  });

  it('pluralises on the displayed count, not the real one', () => {
    // "Read 1 service records" mid-sweep is the kind of wrong that makes an
    // honest caption look broken.
    expect(describeReadWork({ serviceRecords: 40, recalls: null }, 1)).toBe(
      'Read 1 service record.'
    );
  });

  it('counts only records, never a records-plus-recalls composite', () => {
    expect(readWorkCount({ serviceRecords: 12, recalls: 3 })).toBe(12);
    expect(readWorkCount({ serviceRecords: null, recalls: 3 })).toBe(0);
  });
});
