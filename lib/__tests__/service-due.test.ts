/**
 * Which services are due, and which ones travel together.
 *
 * @jest-environment node
 *
 * This decides what an unprompted notification says about someone's car, so
 * the cases that matter are the ones where a plausible-looking rule gets it
 * wrong in a way nobody would notice:
 *
 *   - **A second-hand car is not overdue for everything.** With no service
 *     history, counting from zero makes a car bought at 60,000 miles 52,500
 *     miles late for an oil change. That opens the app on a wall of red and
 *     teaches the owner the alerts are noise.
 *   - **Overdue work anchors the milestone.** Announcing an upcoming 60,000
 *     service while the oil is 2,000 miles past due gets the priority exactly
 *     backwards.
 *   - **The screen and the notification must agree.** Tapping an alert that
 *     says "overdue" and landing on a screen that says "due soon" is two
 *     claims about one car.
 */

import {
  evaluateSchedule,
  isWorthNotifying,
  milestoneReason,
  nextDueMileage,
  nextMilestone,
  type ScheduleEntry,
} from '@crewchief/core/service-due';

const OIL: ScheduleEntry = {
  service: 'Engine oil and filter',
  interval_miles: 7_500,
  interval_months: 12,
  description: 'Drain the oil, replace the filter.',
  priority: 'Critical',
};

const PLUGS: ScheduleEntry = {
  service: 'Spark plugs',
  interval_miles: 30_000,
  description: 'Replace all four plugs.',
  priority: 'Recommended',
};

const TRANS: ScheduleEntry = {
  service: 'Transmission fluid',
  interval_miles: 60_000,
  description: 'Drain and refill.',
  priority: 'Critical',
};

describe('nextDueMileage', () => {
  it('counts from the last recorded service when there is one', () => {
    expect(nextDueMileage(7_500, 61_000, 58_000)).toBe(65_500);
  });

  it('does not make a second-hand car overdue for everything', () => {
    // The case this rule exists for. A car first seen at 60,000 miles with a
    // 7,500-mile interval is due at 67,500 — not 52,500 miles late.
    expect(nextDueMileage(7_500, 60_000, null)).toBe(67_500);
  });

  it('treats a car sitting exactly on a boundary as due now, not next', () => {
    // 60,000 with a 30,000 interval: the service is wanted at 60,000, and it
    // has arrived. Rounding up here would skip a whole interval.
    expect(nextDueMileage(30_000, 60_000, 30_000)).toBe(60_000);
  });

  it('handles a brand-new car with no history', () => {
    expect(nextDueMileage(7_500, 0, null)).toBe(7_500);
  });

  it('reports overdue when history says so', () => {
    // History is authoritative when present: serviced at 50,000, interval
    // 7,500, now at 60,000 — genuinely 2,500 miles late.
    expect(nextDueMileage(7_500, 60_000, 50_000)).toBe(57_500);
  });
});

describe('evaluateSchedule', () => {
  it('orders by urgency, soonest first', () => {
    const due = evaluateSchedule({ schedule: [TRANS, OIL, PLUGS], currentMileage: 59_000 });

    expect(due.map((d) => d.service)).toEqual([
      'Transmission fluid',
      'Engine oil and filter',
      'Spark plugs',
    ]);
  });

  it('skips a legacy entry rather than guessing an interval', () => {
    // Prose intervals from before 7 Aug 2026. Inventing a number would produce
    // a confident notification from data that cannot support one.
    const due = evaluateSchedule({
      schedule: [OIL, { service: 'Coolant', interval: 'every 2 years' } as unknown as ScheduleEntry],
      currentMileage: 60_000,
    });

    expect(due).toHaveLength(1);
    expect(due[0].service).toBe('Engine oil and filter');
  });

  it('records whether an answer came from history or from the odometer', () => {
    // The milestone screen shows this. "Based on your service records" and
    // "estimated from your mileage" are different claims and one is weaker.
    const [fromHistory] = evaluateSchedule({
      schedule: [OIL],
      currentMileage: 60_000,
      lastServiceMileage: () => 58_000,
    });
    const [fromOdometer] = evaluateSchedule({ schedule: [OIL], currentMileage: 60_000 });

    expect(fromHistory.basedOnHistory).toBe(true);
    expect(fromOdometer.basedOnHistory).toBe(false);
  });

  // Oil interval is 7,500 and the car reads 60,000, so the last-service figure
  // sets the distance: 50,000 → due at 57,500 (2,500 late), 53,000 → due at
  // 60,500 (500 to go), 54,500 → due at 62,000 (2,000 to go).
  it.each([
    ['overdue', 50_000, 'overdue'],
    ['due within 1,000 miles', 53_000, 'due'],
    ['approaching', 54_500, 'soon'],
  ])('bands %s correctly', (_label, lastService, expected) => {
    const [due] = evaluateSchedule({
      schedule: [OIL],
      currentMileage: 60_000,
      lastServiceMileage: () => lastService,
    });

    expect(due.status).toBe(expected);
  });

  it('has no grace band on the overdue side', () => {
    // One mile past is past. Softening this is how an "almost due" oil change
    // becomes a rod bearing.
    const [due] = evaluateSchedule({
      schedule: [OIL],
      currentMileage: 60_001,
      lastServiceMileage: () => 52_500,
    });

    expect(due.status).toBe('overdue');
  });

  it('survives an empty schedule', () => {
    expect(evaluateSchedule({ schedule: [], currentMileage: 60_000 })).toEqual([]);
  });
});

describe('nextMilestone', () => {
  it('groups services that a shop would do in one visit', () => {
    // Plugs at 60,000 and transmission at 60,000 are one appointment, not two
    // notifications.
    // Plugs last done at 30,000 on a 30,000 interval, transmission never done
    // on a 60,000 interval — both land on 60,000.
    const due = evaluateSchedule({
      schedule: [PLUGS, TRANS],
      currentMileage: 59_500,
      lastServiceMileage: (service) => (service === 'Spark plugs' ? 30_000 : 0),
    });

    const milestone = nextMilestone(due, { horizonMiles: 5_000 });

    expect(milestone?.services).toHaveLength(2);
    expect(milestone?.mileage).toBe(60_000);
  });

  it('does not sweep in work that is a separate visit', () => {
    // 2,500 miles is the window. Work due at 65,000 is not part of "the 60,000
    // service", and billing it as such is a bill nobody agreed to.
    const due = evaluateSchedule({
      schedule: [
        { ...PLUGS, interval_miles: 60_000 },
        { ...OIL, service: 'Far off', interval_miles: 65_000 },
      ],
      currentMileage: 59_500,
    });

    const milestone = nextMilestone(due, { horizonMiles: 5_000 });

    expect(milestone?.services.map((s) => s.service)).toEqual(['Spark plugs']);
  });

  it('anchors on overdue work rather than on the next scheduled visit', () => {
    // Announcing an upcoming service while something is already late gets the
    // priority backwards.
    const due = evaluateSchedule({
      schedule: [OIL, TRANS],
      currentMileage: 60_000,
      lastServiceMileage: (service) => (service === 'Engine oil and filter' ? 50_000 : 59_000),
    });

    const milestone = nextMilestone(due);

    expect(milestone?.services[0].service).toBe('Engine oil and filter');
    expect(milestone?.services[0].status).toBe('overdue');
  });

  it('returns null when nothing is close, rather than an empty screen', () => {
    const due = evaluateSchedule({ schedule: [TRANS], currentMileage: 1_000 });

    expect(nextMilestone(due)).toBeNull();
  });

  it('returns null for a car with no usable schedule', () => {
    expect(nextMilestone([])).toBeNull();
  });
});

describe('isWorthNotifying', () => {
  it('fires on overdue work', () => {
    const due = evaluateSchedule({
      schedule: [OIL],
      currentMileage: 60_000,
      lastServiceMileage: () => 50_000,
    });

    expect(isWorthNotifying(nextMilestone(due))).toBe(true);
  });

  it('does not fire on work that is merely approaching', () => {
    // A screen someone opened should show a milestone 2,500 miles out. A push
    // should not — that is the alert that teaches people to swipe.
    const due = evaluateSchedule({
      schedule: [OIL],
      currentMileage: 60_000,
      lastServiceMileage: () => 55_000,
    });

    const milestone = nextMilestone(due);

    expect(milestone?.services[0].status).toBe('soon');
    expect(isWorthNotifying(milestone)).toBe(false);
  });

  it('does not fire on nothing', () => {
    expect(isWorthNotifying(null)).toBe(false);
  });
});

describe('milestoneReason', () => {
  it('leads with the overdue service and how late it is', () => {
    const due = evaluateSchedule({
      schedule: [OIL],
      currentMileage: 60_000,
      lastServiceMileage: () => 50_000,
    });

    const reason = milestoneReason(nextMilestone(due)!, 60_000);

    expect(reason).toContain('Engine oil and filter');
    expect(reason).toContain('2,500');
    expect(reason).toContain('overdue');
  });

  it('counts the visit when several services share it', () => {
    const due = evaluateSchedule({
      schedule: [PLUGS, TRANS],
      currentMileage: 59_500,
      lastServiceMileage: (service) => (service === 'Spark plugs' ? 30_000 : 0),
    });

    expect(milestoneReason(nextMilestone(due, { horizonMiles: 5_000 })!, 59_500)).toBe(
      '2 services are due in 500 miles.'
    );
  });

  it('names the single service when there is only one', () => {
    const due = evaluateSchedule({
      schedule: [OIL],
      currentMileage: 59_800,
      lastServiceMileage: () => 52_500,
    });

    expect(milestoneReason(nextMilestone(due)!, 59_800)).toBe(
      'Engine oil and filter is due in 200 miles.'
    );
  });
});
