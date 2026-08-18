/**
 * The decisions a sweep makes at 3am with nobody watching.
 *
 * @jest-environment node
 *
 * Phase 5, C2 and C3. Every other decision in this app is made while somebody
 * is looking at a screen; this one is made unattended, to everybody at once,
 * and its output is a push notification — which cannot be recalled, cannot be
 * edited, and on iOS is the one thing a person cannot ignore.
 *
 * So the tests below are weighted toward **not sending**. A missed recall is a
 * real cost. A recall sent every night for a fortnight is worse, because it
 * ends with notifications disabled and every future recall unheard too.
 */

import {
  SERVICE_COOLDOWN_DAYS,
  SWEEP_GENERATE_CAP,
  SWEEP_SEND_CAP,
  applySendCap,
  daysBetween,
  headlineService,
  recallsToRaise,
  shouldRaiseService,
  vehiclesToGenerate,
  type GenerationCandidate,
} from '@crewchief/core/notification-sweep';
import { normaliseRecall } from '@crewchief/core/recalls';
import {
  evaluateSchedule,
  isWorthNotifying,
  nextMilestone,
  type Milestone,
} from '@crewchief/core/service-due';

/** A raw NHTSA-shaped row, through the real normaliser rather than a hand-built object. */
function recall(campaign: string | null, extra: Record<string, unknown> = {}) {
  const normalised = normaliseRecall({
    NHTSACampaignNumber: campaign,
    Component: 'FUEL SYSTEM',
    Summary: 'Fuel pump may fail.',
    Consequence: 'Engine stall increases the risk of a crash.',
    Remedy: 'Dealers will replace the pump.',
    ...extra,
  });

  if (normalised === null) throw new Error('fixture did not normalise');
  return normalised;
}

describe('recallsToRaise', () => {
  it('raises a campaign nobody has been told about', () => {
    const found = recallsToRaise({ recalls: [recall('20V123000')], alreadyRaised: [] });

    expect(found).toHaveLength(1);
    expect(found[0].campaignNumber).toBe('20V123000');
  });

  it('does not raise one already sent', () => {
    const found = recallsToRaise({
      recalls: [recall('20V123000')],
      alreadyRaised: ['20V123000'],
    });

    expect(found).toEqual([]);
  });

  it('raises only the new one when a car has both', () => {
    // The realistic case: a car accumulates recalls over years and one arrives.
    const found = recallsToRaise({
      recalls: [recall('20V123000'), recall('23V999000')],
      alreadyRaised: ['20V123000'],
    });

    expect(found.map((f) => f.campaignNumber)).toEqual(['23V999000']);
  });

  describe('a recall with no campaign number', () => {
    /*
      The one case where the cautious-looking choice is wrong. Without a
      campaign number there is no dedupe key — sending it means sending it
      again tomorrow, and every night after, forever.
    */

    it.each([
      ['null', null],
      ['empty', ''],
      ['whitespace', '   '],
    ])('is skipped when the number is %s', (_label, campaign) => {
      const found = recallsToRaise({
        recalls: [recall(campaign as string | null)],
        alreadyRaised: [],
      });

      expect(found).toEqual([]);
    });

    it('does not stop the numbered ones beside it going out', () => {
      // A malformed row must cost its own recall, not the whole car's sweep.
      const found = recallsToRaise({
        recalls: [recall(null), recall('23V999000')],
        alreadyRaised: [],
      });

      expect(found.map((f) => f.campaignNumber)).toEqual(['23V999000']);
    });
  });

  it('matches on the exact number, not a prefix', () => {
    // `20V123000` and `20V1230001` are different campaigns. A `startsWith`
    // dedupe would silently swallow the second.
    const found = recallsToRaise({
      recalls: [recall('20V1230001')],
      alreadyRaised: ['20V123000'],
    });

    expect(found).toHaveLength(1);
  });
});

describe('shouldRaiseService', () => {
  const TODAY = '2026-08-08';

  it('sends when something is due and nothing has been sent before', () => {
    expect(
      shouldRaiseService({ worthNotifying: true, lastNotifiedOn: null, today: TODAY })
    ).toBe(true);
  });

  it('never sends when nothing is actually due', () => {
    // `isWorthNotifying` is the gate for "unknown is not news"; this respects
    // its answer rather than forming a second opinion.
    expect(
      shouldRaiseService({ worthNotifying: false, lastNotifiedOn: null, today: TODAY })
    ).toBe(false);
  });

  it('stays quiet inside the cooldown', () => {
    /*
      The failure this exists for. A service stays due until it is done, so a
      naive sweep tells the same person about the same oil change every night —
      not a notification, a leak.
    */
    expect(
      shouldRaiseService({ worthNotifying: true, lastNotifiedOn: '2026-08-01', today: TODAY })
    ).toBe(false);
  });

  it('speaks again once the cooldown has elapsed', () => {
    const longAgo = '2026-06-01';
    expect(daysBetween(longAgo, TODAY)).toBeGreaterThanOrEqual(SERVICE_COOLDOWN_DAYS);
    expect(
      shouldRaiseService({ worthNotifying: true, lastNotifiedOn: longAgo, today: TODAY })
    ).toBe(true);
  });

  it('treats the boundary day as elapsed rather than as one more day of silence', () => {
    const exactly = '2026-07-09'; // 30 days before 8 Aug
    expect(daysBetween(exactly, TODAY)).toBe(SERVICE_COOLDOWN_DAYS);
    expect(
      shouldRaiseService({ worthNotifying: true, lastNotifiedOn: exactly, today: TODAY })
    ).toBe(true);
  });

  it('stays quiet on an unreadable stored date', () => {
    /*
      Deliberately the silent direction. Reading "we cannot tell, so send"
      turns one corrupt row into a nightly notification that no dedupe can ever
      stop — the same unparseable value is there again tomorrow.
    */
    expect(
      shouldRaiseService({ worthNotifying: true, lastNotifiedOn: 'not-a-date', today: TODAY })
    ).toBe(false);
  });

  it('stays quiet if the stored date is somehow in the future', () => {
    // Clock skew, or a row written by a different timezone. Negative days are
    // below the threshold, which suppresses — the safe direction again.
    expect(
      shouldRaiseService({ worthNotifying: true, lastNotifiedOn: '2026-12-01', today: TODAY })
    ).toBe(false);
  });

  it('reads a stored timestamp, not just a bare date', () => {
    // Postgres `timestamptz` comes back as an ISO datetime. Comparing that to a
    // date without truncating is how a cooldown quietly never elapses.
    expect(daysBetween('2026-06-01T14:32:11.000Z', TODAY)).toBeGreaterThan(SERVICE_COOLDOWN_DAYS);
  });
});

describe('the send cap', () => {
  it('lets an ordinary night through untouched', () => {
    const plan = applySendCap([1, 2, 3]);

    expect(plan.send).toEqual([1, 2, 3]);
    expect(plan.capped).toBe(false);
    expect(plan.considered).toBe(3);
  });

  it('truncates a runaway', () => {
    const plan = applySendCap(Array.from({ length: SWEEP_SEND_CAP + 50 }, (_, i) => i));

    expect(plan.send).toHaveLength(SWEEP_SEND_CAP);
    expect(plan.considered).toBe(SWEEP_SEND_CAP + 50);
  });

  it('says out loud that it truncated', () => {
    /*
      The important half. Truncating silently would make a runaway look like an
      ordinary quiet night — the sweep sends its 200, reports success, and does
      it again tomorrow. `capped` is what gets a human involved on the first
      night rather than the fortieth.
    */
    const plan = applySendCap(Array.from({ length: SWEEP_SEND_CAP + 1 }, (_, i) => i));

    expect(plan.capped).toBe(true);
  });

  it('does not fire at exactly the cap', () => {
    // Off-by-one in the direction that cries wolf. Exactly 200 is allowed.
    const plan = applySendCap(Array.from({ length: SWEEP_SEND_CAP }, (_, i) => i));

    expect(plan.capped).toBe(false);
    expect(plan.send).toHaveLength(SWEEP_SEND_CAP);
  });
});

describe('headlineService', () => {
  /**
   * Built by hand, **deliberately out of urgency order**.
   *
   * `evaluateSchedule` already sorts by urgency, so a milestone taken straight
   * from it has its most urgent service first — and `services[0]` and "find the
   * overdue one" give the same answer for every input. A test built that way
   * cannot tell the two apart, which is exactly what the first version of this
   * did: it asserted `expect.any(String)` and passed against either.
   *
   * The real risk is a caller that re-sorts for display — by priority, or
   * alphabetically — and changes what the notification says without touching
   * the notification code. So the fixture is ordered the way such a caller
   * would leave it.
   */
  function service(name: string, status: 'overdue' | 'due' | 'soon') {
    return {
      service: name,
      description: '',
      priority: 'Critical' as const,
      intervalMiles: 7_500,
      intervalMonths: null,
      dueAtMiles: 92_500,
      milesRemaining: status === 'overdue' ? -2_300 : 100,
      dueOn: null,
      monthsRemaining: null,
      drivenBy: 'miles' as const,
      status,
      basedOnHistory: true,
      evidence: 'records' as const,
    };
  }

  /*
    Typed as `Milestone`, not cast through `unknown`.

    The first version cast, and the cast hid a real mistake: the fixture called
    the field `atMiles`, which `Milestone` does not have — it is `mileage`. The
    tests passed anyway because `headlineService` only reads `services`, so a
    fixture describing a shape that cannot exist sat here looking authoritative.
    The same wrong name then went into the route, where tsc did catch it.
  */
  const outOfOrder: Milestone = {
    mileage: 92_500,
    services: [service('Tyre rotation', 'soon'), service('Engine oil and filter', 'overdue')],
  };

  it('names the overdue service even when it is not first', () => {
    expect(headlineService(outOfOrder)).toBe('Engine oil and filter');
  });

  it('prefers overdue over merely due', () => {
    const mixed: Milestone = {
      mileage: 92_500,
      services: [service('Tyre rotation', 'due'), service('Engine oil and filter', 'overdue')],
    };

    expect(headlineService(mixed)).toBe('Engine oil and filter');
  });

  it('falls back to the first service when none is overdue or due', () => {
    const quiet: Milestone = {
      mileage: 92_500,
      services: [service('Tyre rotation', 'soon')],
    };

    expect(headlineService(quiet)).toBe('Tyre rotation');
  });

  it('always has something to say when the milestone is worth sending', () => {
    /*
      Unconditional, and the previous version was not — it wrapped the
      assertion in `if (isWorthNotifying(...))`, so a fixture that stopped being
      worth notifying would have made the test vacuous rather than red.

      This asserts the precondition first, so the tie between the two functions
      is proven rather than assumed: a notification whose body is empty is worse
      than no notification.
    */
    const services = evaluateSchedule({
      schedule: [
        { service: 'Engine oil and filter', interval_miles: 7_500, priority: 'Critical' },
      ],
      currentMileage: 94_800,
      lastServiceMileage: () => 85_000,
    });
    const milestone = nextMilestone(services, { horizonMiles: 5_000 });

    expect(isWorthNotifying(milestone)).toBe(true);
    expect(headlineService(milestone!)).toBe('Engine oil and filter');
  });
});

/**
 * C4 — which cars get a schedule generated at 3am, and which are left alone.
 *
 * This is the only decision in the sweep that spends **money** rather than
 * attention, so the tests are weighted differently from the ones above. There,
 * the cost of a wrong answer is a notification somebody did not want. Here it
 * is a Pro-model call, repeated nightly, for as long as nobody notices.
 *
 * Every filter below is a brake on that. The mutation note on each says what
 * removing it would cost, because a filter whose absence is survivable does not
 * need to exist and a filter whose absence is not should be hard to delete by
 * accident.
 */
describe('vehiclesToGenerate', () => {
  function candidate(overrides: Partial<GenerationCandidate> = {}): GenerationCandidate {
    return {
      vehicleId: 'v1',
      userId: 'u1',
      researchStatus: 'pending',
      hasPushToken: true,
      mileage: 61_000,
      ...overrides,
    };
  }

  it('generates for a pending car whose owner has a device and an odometer reading', () => {
    const plan = vehiclesToGenerate([candidate()]);

    expect(plan.send).toHaveLength(1);
    expect(plan.capped).toBe(false);
  });

  it('never regenerates a car whose research already failed', () => {
    /*
      The most expensive mutation in this file. `failed` means the model has
      already run three times and been paid for three times; selecting it here
      would retry every one of those, every night, forever — and the user
      already has a retry button owned by a request that waits for it.

      Flip the filter to include 'failed' and this goes red.
    */
    expect(vehiclesToGenerate([candidate({ researchStatus: 'failed' })]).send).toHaveLength(0);
  });

  it('never regenerates a completed car that simply has no schedule', () => {
    /*
      The same runaway wearing a different status. A `completed` row with an
      empty schedule is research that succeeded and produced nothing; asking
      again tonight asks again every night.
    */
    expect(vehiclesToGenerate([candidate({ researchStatus: 'completed' })]).send).toHaveLength(0);
  });

  it('never regenerates a car the model has said it cannot help with', () => {
    expect(vehiclesToGenerate([candidate({ researchStatus: 'unsupported' })]).send).toHaveLength(0);
  });

  it('skips a vehicle with no knowledge-base row at all', () => {
    /*
      The subtle one, and the reason `null` is not treated as "as good as
      pending". Generation reports failure by UPDATEing `research_status` to
      'failed' — which does nothing when there is no row to update. So a
      vehicle in this state could fail nightly and never record that it had:
      a paid call with no brake on it.
    */
    expect(vehiclesToGenerate([candidate({ researchStatus: null })]).send).toHaveLength(0);
  });

  it('does not spend a model call for an account with no registered device', () => {
    expect(vehiclesToGenerate([candidate({ hasPushToken: false })]).send).toHaveLength(0);
  });

  it('does not generate for a car with no odometer reading', () => {
    /*
      `collectService` already refuses a car at zero miles, so generating for
      one could not produce a notification even if it worked perfectly.
    */
    expect(vehiclesToGenerate([candidate({ mileage: 0 })]).send).toHaveLength(0);
    expect(vehiclesToGenerate([candidate({ mileage: null })]).send).toHaveLength(0);
  });

  it('spends the budget and leaves the rest for tomorrow, rather than refusing the run', () => {
    /*
      The degradation this cap is supposed to produce. Eleven eligible cars on
      a cap of ten is not an incident — it is a backlog, and the right answer
      is ten tonight and one tomorrow. A cap that threw, or that skipped the
      whole run, would turn a good night into an outage.
    */
    const many = Array.from({ length: SWEEP_GENERATE_CAP + 1 }, (_, i) =>
      candidate({ vehicleId: `v${i}` })
    );

    const plan = vehiclesToGenerate(many);

    expect(plan.send).toHaveLength(SWEEP_GENERATE_CAP);
    expect(plan.considered).toBe(SWEEP_GENERATE_CAP + 1);
    expect(plan.capped).toBe(true);
  });

  it('costs strictly less per night than the send cap allows', () => {
    /*
      Not a tautology — it is the assertion that these two numbers never get
      collapsed into one. A send costs attention and 200 of them is a circuit
      breaker; a generation costs money and 200 of those is a bill nobody
      authorised. Someone reaching for "why are there two caps?" should find
      this line.
    */
    expect(SWEEP_GENERATE_CAP).toBeLessThan(SWEEP_SEND_CAP);
  });

  it('filters before capping, so ineligible cars cannot consume the budget', () => {
    /*
      Order matters and the wrong order is invisible in the happy path. If the
      cap were applied first, ten failed rows ahead of one pending car would
      spend the whole budget on nothing and starve the one car that needed it.

      The fixture puts the ineligible ones first for exactly that reason.
    */
    const blockers = Array.from({ length: SWEEP_GENERATE_CAP }, (_, i) =>
      candidate({ vehicleId: `bad${i}`, researchStatus: 'failed' })
    );
    const real = candidate({ vehicleId: 'good' });

    const plan = vehiclesToGenerate([...blockers, real]);

    expect(plan.send).toHaveLength(1);
    expect(plan.send[0].vehicleId).toBe('good');
    expect(plan.capped).toBe(false);
  });
});
