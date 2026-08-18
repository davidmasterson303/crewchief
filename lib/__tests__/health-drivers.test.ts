/**
 * The three health drivers — computed, never generated.
 *
 * @jest-environment node
 *
 * David chose the computed route on 15 Aug over adding three fields to the
 * health-summary prompt. These tests are what that choice buys: every number
 * below is checkable against its inputs, which is the whole argument — a driver
 * the model invented could not be asserted on at all.
 */

import {
  healthDrivers,
  maintenanceDriver,
  mileageLoadDriver,
  recallDriver,
} from '@crewchief/core/health-drivers';
import type { ServiceDue } from '@crewchief/core/service-due';

/** A `ServiceDue` with only the fields the drivers read. */
const due = (
  status: ServiceDue['status'],
  priority: ServiceDue['priority'] = 'Recommended'
): ServiceDue =>
  ({
    service: 'Engine oil and filter',
    description: '',
    priority,
    intervalMiles: 7500,
    intervalMonths: null,
    dueAtMiles: 60_000,
    milesRemaining: 0,
    dueOn: null,
    monthsRemaining: null,
    drivenBy: 'miles',
    status,
    basedOnHistory: true,
    evidence: 'records',
  }) as ServiceDue;

describe('maintenanceDriver', () => {
  it('says it does not know rather than scoring a car with no schedule', () => {
    /*
      The rule the garage card already follows for a missing health score. A
      car whose knowledge base has not generated is not a car in bad condition,
      and `null` is how that difference reaches the screen.
    */
    const driver = maintenanceDriver([]);

    expect(driver.score).toBeNull();
    expect(driver.detail).toMatch(/no service schedule/i);
  });

  it('scores a fully up-to-date car at the top', () => {
    const driver = maintenanceDriver([due('later'), due('later'), due('later')]);

    expect(driver.score).toBe(100);
    expect(driver.detail).toMatch(/Nothing overdue/);
  });

  it('charges an overdue critical service more than an overdue optional one', () => {
    // The knowledge base already grades priority; this reads that grade rather
    // than holding a second opinion about which services matter.
    const critical = maintenanceDriver([due('overdue', 'Critical')]).score;
    const optional = maintenanceDriver([due('overdue', 'Optional')]).score;

    expect(critical).toBeLessThan(optional!);
    expect(critical).toBe(78);
    expect(optional).toBe(93);
  });

  it('does not charge for a service it has no record of', () => {
    /*
      ⚠ The load-bearing one. A time-only service with no date to count from is
      a gap in *our records*, not a fault in the car. Charging for it would let
      a car with no invoices score worse than one with a genuine overdue brake
      fluid — punishing the owner for our missing data.
    */
    const blind = maintenanceDriver([due('unknown'), due('unknown'), due('unknown')]);

    expect(blind.score).toBe(100);
    // Reported rather than absorbed. "—" on its own reads as a bug.
    expect(blind.detail).toMatch(/3 services with no record to count from/);
  });

  it('describes the same car the number does', () => {
    const driver = maintenanceDriver([
      due('overdue', 'Critical'),
      due('due'),
      due('later'),
      due('unknown'),
    ]);

    expect(driver.detail).toBe(
      '1 service overdue, 1 due now, across 4 tracked services. 1 service with no record to count from.'
    );
  });

  it('never falls below the floor, however far behind the car is', () => {
    const wrecked = maintenanceDriver(
      Array.from({ length: 30 }, () => due('overdue', 'Critical'))
    );

    expect(wrecked.score).toBe(1);
  });
});

describe('recallDriver', () => {
  const recall = (extra: Record<string, unknown> = {}) => ({
    NHTSACampaignNumber: '21V123',
    Component: 'AIR BAGS',
    Summary: 'Inflator may rupture.',
    Remedy: 'Dealer will replace the inflator.',
    ...extra,
  });

  it('does not clear a car whose recalls were never checked', () => {
    /*
      Absent is not empty. Scoring an unchecked vehicle 100 is a claim about
      NHTSA's completeness this product cannot make — the same argument
      `worstSeverity` makes for rendering nothing rather than a green badge.
    */
    expect(recallDriver(null).score).toBeNull();
    expect(recallDriver(undefined).detail).toMatch(/have not been checked/i);
  });

  it('scores a checked car with none at the top', () => {
    const driver = recallDriver([]);

    expect(driver.score).toBe(100);
    expect(driver.detail).toBe('No recalls on record.');
  });

  it('charges the first recall most', () => {
    // One open recall and three are both "a car with an unfixed safety
    // defect"; that difference matters less than the difference from none.
    const one = recallDriver([recall()]).score!;
    const two = recallDriver([recall(), recall()]).score!;
    const three = recallDriver([recall(), recall(), recall()]).score!;

    expect(100 - one).toBeGreaterThan(one - two);
    expect(one - two).toBe(two - three);
  });

  it('puts a do-not-drive recall below anything a count could reach', () => {
    /*
      A do-not-drive recall is not a score, it is an instruction. No amount of
      otherwise-good news may lift the card out of the alarming range.
    */
    // `parkIt` and `parkOutSide` — NHTSA's own field names, which is why the
    // driver goes through `normaliseRecalls` rather than reading raw fields.
    const driver = recallDriver([recall({ parkIt: true })]);

    expect(driver.score).toBeLessThanOrEqual(5);
    expect(driver.detail).toMatch(/do-not-drive/);
  });

  it('is not fooled by NHTSA s string booleans', () => {
    /*
      `"false"` is truthy in JavaScript, which is exactly how a do-not-drive
      flag ends up on every recall in the list. `recalls.ts` already handles it;
      this asserts the driver inherits that rather than re-reading the raw field.
    */
    const driver = recallDriver([recall({ parkIt: 'false' })]);

    expect(driver.score).toBeGreaterThan(5);
    expect(driver.detail).not.toMatch(/do-not-drive/);
  });

  it('says "on record" rather than "open", because completion is not tracked', () => {
    // A recall the owner had fixed last year still counts. Conservative in the
    // right direction, but the wording must not overclaim.
    expect(recallDriver([recall()]).detail).toMatch(/on record/);
    expect(recallDriver([recall()]).detail).not.toMatch(/\bopen\b/i);
  });
});

describe('mileageLoadDriver', () => {
  const today = '2026-08-15';

  it('needs both an odometer reading and a year', () => {
    expect(mileageLoadDriver({ currentMileage: 66_000, year: null, today }).score).toBeNull();
    expect(mileageLoadDriver({ currentMileage: null, year: 2015, today }).score).toBeNull();
  });

  it('scores a lightly used car at the top', () => {
    // 5,000 a year over 11 years — well under half the 12,000 average.
    const driver = mileageLoadDriver({ currentMileage: 55_000, year: 2015, today });

    expect(driver.score).toBe(100);
  });

  it('puts an average car high but not at the top', () => {
    /*
      12,000 a year is the yardstick, not a fault. A car being used normally
      should not read as a problem — the ramp is gentle on purpose, because the
      steep version made an ordinary high-mileage car look like a wreck.
    */
    const driver = mileageLoadDriver({ currentMileage: 132_000, year: 2015, today });

    expect(driver.score).toBe(85);
  });

  it('does not send a heavy commuter to the floor', () => {
    // 30,000 a year is hard use, not a write-off. This is the range real cars
    // occupy, and it has to stay legible rather than pinning at the bottom.
    const driver = mileageLoadDriver({ currentMileage: 330_000, year: 2015, today });

    expect(driver.score).toBe(40);
  });

  it('floors rather than going negative at the extreme', () => {
    /*
      The ramp is linear and reaches the floor at about 3.8x the average —
      roughly 46,000 miles a year. A car there genuinely is at the bottom of a
      mileage-load scale, so the floor is the honest answer rather than a
      clamp hiding a broken formula. Asserted so the clamp cannot quietly
      become the thing every high-mileage car hits.
    */
    expect(mileageLoadDriver({ currentMileage: 528_000, year: 2015, today }).score).toBe(1);
    // 20,000 a year, still well clear of the floor.
    expect(mileageLoadDriver({ currentMileage: 220_000, year: 2015, today }).score).toBe(65);
  });

  it('does not divide by zero on a current-model-year car', () => {
    const driver = mileageLoadDriver({ currentMileage: 3_000, year: 2026, today });

    expect(driver.score).toBe(100);
    expect(Number.isFinite(driver.score!)).toBe(true);
  });

  it('shows its working', () => {
    const driver = mileageLoadDriver({ currentMileage: 66_000, year: 2015, today });

    expect(driver.detail).toBe('About 6,000 miles a year over 11 years, against a 12,000 average.');
  });
});

describe('healthDrivers', () => {
  it('returns the three in the order the card shows them', () => {
    /*
      Maintenance first because it is the one the owner can act on today,
      recalls second because they can be urgent, mileage load last because it is
      context rather than a task. One function, so no caller assembles its own
      order.
    */
    const drivers = healthDrivers({
      services: [due('later')],
      recalls: [],
      currentMileage: 66_000,
      year: 2015,
      today: '2026-08-15',
    });

    expect(drivers.map((driver) => driver.key)).toEqual([
      'maintenance',
      'recalls',
      'mileage-load',
    ]);
  });

  it('gives every driver a sentence, including the ones it cannot score', () => {
    // A card cell showing "—" and nothing else reads as a bug rather than as
    // an honest absence.
    const drivers = healthDrivers({ services: [], recalls: null });

    for (const driver of drivers) {
      expect(driver.score).toBeNull();
      expect(driver.detail.length).toBeGreaterThan(10);
    }
  });

  it('never scores anything outside the health scale', () => {
    const drivers = healthDrivers({
      services: Array.from({ length: 40 }, () => due('overdue', 'Critical')),
      recalls: [{ NHTSACampaignNumber: '1' }, { NHTSACampaignNumber: '2' }],
      currentMileage: 600_000,
      year: 2015,
      today: '2026-08-15',
    });

    for (const driver of drivers) {
      expect(driver.score).toBeGreaterThanOrEqual(1);
      expect(driver.score).toBeLessThanOrEqual(100);
    }
  });
});
