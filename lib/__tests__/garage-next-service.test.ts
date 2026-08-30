/**
 * @jest-environment node
 *
 * The garage card's next-service row, and the empty state that blocked it.
 *
 * ── What was actually blocked ───────────────────────────────────────────────
 *
 * `docs/step4-api-gaps.md` §3 held this row for a design answer, not for
 * engineering time: *"'No schedule yet' is not the same as 'nothing due', and
 * the card must not imply the second."* Checked against the live database on
 * 16 Aug, **all four vehicles have a schedule** — 7 or 8 entries each — so the
 * empty state has no instance in the product today and cannot be found by
 * looking at it. It is the first car added without a knowledge-base entry that
 * meets it, and by then the row is shipped.
 *
 * That is why these tests exist before the feature does.
 */

import {
  UNKNOWN_TIMING,
  describeNextService,
  type StoredNextService,
} from '@wellkept/core/garage-next-service';

const TODAY = '2026-08-16';

/** A swept row for a mileage-driven service. */
const OIL: StoredNextService = {
  label: 'Engine oil and filter',
  atMiles: 70000,
  dueOn: null,
};

describe('when we cannot say', () => {
  it('is unknown for a car the sweep has never reached', () => {
    const line = describeNextService({ label: null, atMiles: null, dueOn: null }, 66000, TODAY);

    expect(line).toEqual({ kind: 'unknown' });
  });

  it('refuses to name a service it cannot time', () => {
    /*
      ⚠ The subtle one. A label survived but nothing says *when* — a sweep bug,
      or a schedule entry with neither interval. Rendering "Engine oil and
      filter" under a heading that reads "Next service" says **now**, which is
      the loudest thing this row can say and the one it would be saying by
      accident. Saying nothing is the safer wrong answer.
    */
    const line = describeNextService(
      { label: 'Engine oil and filter', atMiles: null, dueOn: null },
      66000,
      TODAY
    );

    expect(line).toEqual({ kind: 'unknown' });
  });

  it('treats a blank label as no label', () => {
    const line = describeNextService({ label: '   ', atMiles: 70000, dueOn: null }, 66000, TODAY);

    expect(line).toEqual({ kind: 'unknown' });
  });

  it('says we have no schedule, never that nothing is due', () => {
    /*
      The words themselves, pinned. `UNKNOWN_TIMING` is exported so the copy has
      one home — but the assertion that matters is the second one: no phrasing
      of this state may claim the car is clear.

      What actually keeps "No schedule yet" from being heard as "nothing due" is
      not the phrase, it is that the row's label never leaves. The subject is
      fixed before the value is read. `GarageBay.test.tsx` is where that half is
      proved, because it is a property of the rendered row rather than of this
      function.
    */
    expect(UNKNOWN_TIMING).toBe('No schedule yet');
    expect(UNKNOWN_TIMING).not.toMatch(/nothing|clear|none due|up to date|all good/i);
  });
});

describe('a service due at an odometer reading', () => {
  it('counts down from live mileage', () => {
    const line = describeNextService(OIL, 69580, TODAY);

    expect(line).toEqual({
      kind: 'known',
      service: 'Engine oil and filter',
      timing: 'in 420 mi',
    });
  });

  it('recomputes as the car is driven, without the sweep running again', () => {
    /*
      A quiet virtue of storing the answer as a **position** rather than a
      remainder, and worth pinning because it is the reason staleness is not a
      case in this function. The stored row is identical in both calls; only the
      odometer moved.

      Had the column held "420 miles to go", every mile driven would have made
      it wrong until the next nightly sweep, and the row would have needed a
      freshness rule and a fourth column to carry it.
    */
    expect(describeNextService(OIL, 69580, TODAY)).toMatchObject({ timing: 'in 420 mi' });
    expect(describeNextService(OIL, 69900, TODAY)).toMatchObject({ timing: 'in 100 mi' });
  });

  it('says overdue rather than counting backwards', () => {
    // "in -300 mi" is not a sentence, and a negative countdown is the kind of
    // thing that ships because nobody drives past the due point in testing.
    const line = describeNextService(OIL, 70300, TODAY);

    expect(line).toMatchObject({ timing: 'overdue by 300 mi' });
  });

  it('has a word for the exact reading', () => {
    const line = describeNextService(OIL, 70000, TODAY);

    expect(line).toMatchObject({ timing: 'due now' });
  });

  it('names the reading when the odometer is unknown', () => {
    /*
      ⚠ No odometer is not zero miles — the rule the garage card already follows
      for a missing health score, one field along. Treating null as 0 would
      report "in 70,000 mi" and invent a car that has never been driven; naming
      the reading is both true and the more useful of the two.
    */
    const line = describeNextService(OIL, null, TODAY);

    expect(line).toMatchObject({ timing: 'at 70,000 mi' });
  });

  it('groups thousands, because five digits unseparated is a part number', () => {
    expect(describeNextService(OIL, 57500, TODAY)).toMatchObject({ timing: 'in 12,500 mi' });
  });
});

describe('a service due by a date', () => {
  const FLUID: StoredNextService = {
    label: 'Brake fluid',
    atMiles: null,
    dueOn: '2026-09-01',
  };

  it('gives the date when it is ahead', () => {
    expect(describeNextService(FLUID, 66000, TODAY)).toEqual({
      kind: 'known',
      service: 'Brake fluid',
      timing: 'by Sep 1, 2026',
    });
  });

  it('says overdue once it has passed', () => {
    expect(describeNextService({ ...FLUID, dueOn: '2026-07-04' }, 66000, TODAY)).toMatchObject({
      timing: 'overdue since Jul 4, 2026',
    });
  });

  it('says due now on the day itself', () => {
    expect(describeNextService({ ...FLUID, dueOn: TODAY }, 66000, TODAY)).toMatchObject({
      timing: 'due now',
    });
  });

  it('prefers the odometer when a service has both', () => {
    // "Whichever comes first" is the schedule's own rule and the sweep applies
    // it; by the time a row is stored the decision is made. Mileage is the more
    // actionable of the two on a card, and a row carrying both would be the
    // sweep failing to choose.
    const line = describeNextService({ ...OIL, dueOn: '2026-09-01' }, 69580, TODAY);

    expect(line).toMatchObject({ timing: 'in 420 mi' });
  });
});

describe('the date is the day it names, in every timezone', () => {
  /*
    ⚠ This bug is **invisible in UTC**, which is where CI runs, so a test that
    did not set the zone would prove nothing.

    `formatDate` does `new Date('2026-09-01')`, which the spec parses as
    midnight **UTC**, and `toLocaleDateString` renders that in the reader's own
    zone — "Aug 31" for everyone west of Greenwich, which is most of this
    product's users. A row telling an owner their brake fluid was due the day
    before it is would be small, constant, and look like nothing in particular.
  */
  const original = process.env.TZ;

  afterAll(() => {
    process.env.TZ = original;
  });

  it.each(['America/Los_Angeles', 'America/New_York', 'UTC', 'Australia/Sydney'])(
    'renders Sep 1 as Sep 1 in %s',
    (zone) => {
      process.env.TZ = zone;

      const line = describeNextService(
        { label: 'Brake fluid', atMiles: null, dueOn: '2026-09-01' },
        66000,
        TODAY
      );

      expect(line).toMatchObject({ timing: 'by Sep 1, 2026' });
    }
  );

  it('would catch the bug, so the zone is really being applied', () => {
    /*
      Guards the guard, and this one is not paranoia: whether assigning
      `process.env.TZ` mid-process actually moves the clock is a **Node version
      detail**. On a runtime that ignores it, every case above would run in UTC,
      pass, and prove nothing — the vacuous-guard failure this repo has been
      caught by before.

      So the naive construction is exercised directly in the same zone. If this
      stops reporting Aug 31, the zone is not being applied and the cases above
      are worthless, whatever colour they print.
    */
    process.env.TZ = 'America/Los_Angeles';

    const naive = new Date('2026-09-01').toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });

    expect(naive).toBe('Aug 31, 2026');
  });
});
