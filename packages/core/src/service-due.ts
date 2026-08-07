/**
 * Which services this car needs next, and which ones travel together.
 *
 * Phase 5.6. The service-due notification and the milestone screen it opens
 * both ask this question, and the notification asks it on a schedule with
 * nobody watching — so the answer has to be defensible without a human reading
 * it first.
 *
 * ── Why this is not `UpcomingMaintenance.tsx` ───────────────────────────────
 *
 * That component exists, renders nowhere, and carries a hardcoded
 * `COMMON_INTERVALS` table: oil every 5,000 miles, plugs every 30,000, for
 * every car in the product. A generic table is a reasonable placeholder on a
 * screen someone chose to open and a bad basis for an unprompted notification —
 * "your transmission fluid is due" is a claim about *this* car, and a Honda and
 * a BMW do not share an interval. R14 recorded the component as unrendered; the
 * table is the likelier reason it never was.
 *
 * This reads the vehicle's own schedule instead, which is why `81022f9` had to
 * make that schedule structured first.
 *
 * ── The milestone is the product, not the individual service ────────────────
 *
 * Owners do not think in twelve independent countdowns; they think "the 60,000
 * service". A shop bundles the work, the labour overlaps, and one visit covers
 * it. So the unit here is a **milestone** — every service falling due around
 * the same odometer reading, grouped — and the add-to-wishlist affordance
 * operates on the group. That is also what makes the notification worth
 * sending: one alert about a visit, rather than four about filters.
 */

export type DueStatus = 'overdue' | 'due' | 'soon' | 'later';

export interface ScheduleEntry {
  service: string;
  interval_miles: number;
  interval_months?: number | null;
  description?: string;
  priority?: 'Critical' | 'Recommended' | 'Optional';
}

export interface ServiceDue {
  service: string;
  description: string;
  priority: 'Critical' | 'Recommended' | 'Optional';
  intervalMiles: number;
  /** The odometer reading this service is next wanted at. */
  dueAtMiles: number;
  /** Negative when overdue. */
  milesRemaining: number;
  status: DueStatus;
  /** Whether a completed service was found to count from. */
  basedOnHistory: boolean;
}

export interface Milestone {
  /** The reading the milestone is named for — "the 60,000 service". */
  mileage: number;
  /** Everything due at it, most urgent first. */
  services: ServiceDue[];
}

/**
 * Past this, a service is overdue rather than due.
 *
 * Zero, deliberately. There is no grace band on the overdue side: a service is
 * either still ahead of you or behind you, and softening that is how an
 * "almost due" oil change becomes a rod bearing.
 */
const OVERDUE_AT = 0;

/** Within this many miles, a service is due now rather than approaching. */
const DUE_WINDOW_MILES = 1_000;

/** Within this many miles, it is worth mentioning but not worth a trip. */
const SOON_WINDOW_MILES = 3_000;

/**
 * How far apart two services can fall due and still be one visit.
 *
 * 2,500 miles is roughly a quarter of a year of average driving, and the whole
 * point of the grouping is that a shop does them in one appointment. Tighter
 * and a 58,000 and a 60,000 service become two notifications a month apart;
 * looser and "the 60,000 service" starts including work due at 65,000, which
 * is a bill nobody agreed to.
 */
const MILESTONE_WINDOW_MILES = 2_500;

const PRIORITY_ORDER: Record<string, number> = { Critical: 0, Recommended: 1, Optional: 2 };

/**
 * When is this service next wanted?
 *
 * With a recorded last service, the answer is that reading plus the interval.
 *
 * **Without one, it is the next interval boundary at or above the current
 * odometer** — not the interval itself. A car bought at 60,000 miles with a
 * 7,500-mile oil interval is not 52,500 miles overdue for an oil change; it is
 * due at 67,500. Treating an unknown history as "never done" would open the
 * app on a wall of red for every second-hand car, which is both wrong and the
 * fastest way to teach someone the alerts are noise.
 */
export function nextDueMileage(
  intervalMiles: number,
  currentMileage: number,
  lastServiceMileage: number | null
): number {
  if (lastServiceMileage !== null && lastServiceMileage >= 0) {
    return lastServiceMileage + intervalMiles;
  }

  // Ceiling to the next boundary; a car exactly on one is due now, not next.
  const intervalsElapsed = Math.floor(currentMileage / intervalMiles);
  return (intervalsElapsed + 1) * intervalMiles;
}

function statusFor(milesRemaining: number): DueStatus {
  if (milesRemaining < OVERDUE_AT) return 'overdue';
  if (milesRemaining <= DUE_WINDOW_MILES) return 'due';
  if (milesRemaining <= SOON_WINDOW_MILES) return 'soon';
  return 'later';
}

/**
 * Evaluate every schedule entry against the odometer.
 *
 * `lastServiceMileage` is a lookup the caller supplies, because resolving "has
 * this been done" means reading service history and invoice line items — IO
 * this module deliberately does not do. `maintenance-sync.ts` already holds
 * that matching logic.
 *
 * **Entries without a usable interval are skipped, not guessed at.** Every
 * vehicle onboarded before 7 Aug 2026 carries prose intervals, and inventing a
 * number for them would produce confident notifications from data that cannot
 * support one.
 */
export function evaluateSchedule(params: {
  schedule: ScheduleEntry[];
  currentMileage: number;
  lastServiceMileage?: (service: string) => number | null;
}): ServiceDue[] {
  const { schedule, currentMileage, lastServiceMileage } = params;

  return schedule
    .filter((entry) => typeof entry?.interval_miles === 'number' && entry.interval_miles > 0)
    .map((entry) => {
      const lastMileage = lastServiceMileage ? lastServiceMileage(entry.service) : null;
      const dueAtMiles = nextDueMileage(entry.interval_miles, currentMileage, lastMileage);
      const milesRemaining = dueAtMiles - currentMileage;

      return {
        service: entry.service,
        description: entry.description ?? '',
        priority: entry.priority ?? 'Recommended',
        intervalMiles: entry.interval_miles,
        dueAtMiles,
        milesRemaining,
        status: statusFor(milesRemaining),
        basedOnHistory: lastMileage !== null,
      };
    })
    .sort((a, b) => a.milesRemaining - b.milesRemaining);
}

/**
 * The next visit worth making, and everything that should happen at it.
 *
 * **Overdue work anchors the milestone.** If anything is behind, the milestone
 * is named for the earliest overdue reading and carries the overdue items —
 * telling someone about their upcoming 60,000 service while their oil change
 * is 2,000 miles past due gets the priority exactly backwards.
 *
 * Returns `null` when nothing is due within the horizon, which is a real
 * answer: a car with nothing coming up should produce no notification rather
 * than an empty screen.
 */
export function nextMilestone(
  services: ServiceDue[],
  options: { horizonMiles?: number } = {}
): Milestone | null {
  const horizon = options.horizonMiles ?? SOON_WINDOW_MILES;

  // Already sorted by `evaluateSchedule`, but callers may hand us anything.
  const ordered = [...services].sort((a, b) => a.milesRemaining - b.milesRemaining);
  const anchor = ordered[0];

  if (!anchor || anchor.milesRemaining > horizon) return null;

  const grouped = ordered.filter(
    (item) => Math.abs(item.dueAtMiles - anchor.dueAtMiles) <= MILESTONE_WINDOW_MILES
  );

  return {
    /*
      Named for the anchor's reading rather than an average or a round number.
      "The 62,300 service" is odd phrasing but it is the truth; rounding it to
      60,000 would name a milestone the car has already passed.
    */
    mileage: anchor.dueAtMiles,
    services: grouped.sort(
      (a, b) =>
        a.milesRemaining - b.milesRemaining ||
        (PRIORITY_ORDER[a.priority] ?? 1) - (PRIORITY_ORDER[b.priority] ?? 1)
    ),
  };
}

/**
 * Is this milestone worth interrupting someone for?
 *
 * Separate from `nextMilestone` because they are different questions and the
 * second one is a product judgement. A screen the owner chose to open should
 * show a milestone 2,500 miles out; a push notification should not — an alert
 * about work that is months away is the one that teaches people to swipe the
 * next one away without reading it.
 *
 * So: notify on overdue or due, never on soon.
 */
export function isWorthNotifying(milestone: Milestone | null): boolean {
  if (!milestone) return false;

  return milestone.services.some(
    (service) => service.status === 'overdue' || service.status === 'due'
  );
}

/**
 * One line describing why this milestone is being raised.
 *
 * Lives here rather than at either call site because the notification body and
 * the screen's subheading must agree — someone who taps an alert saying "2,000
 * miles overdue" and lands on a screen saying "due soon" has been told two
 * things about one car.
 */
export function milestoneReason(milestone: Milestone, currentMileage: number): string {
  const overdue = milestone.services.filter((service) => service.status === 'overdue');

  if (overdue.length > 0) {
    const worst = overdue[overdue.length - 1];
    const by = Math.abs(worst.milesRemaining).toLocaleString('en-US');
    return `${worst.service} is ${by} miles overdue.`;
  }

  const remaining = Math.max(0, milestone.mileage - currentMileage).toLocaleString('en-US');
  const count = milestone.services.length;

  return count === 1
    ? `${milestone.services[0].service} is due in ${remaining} miles.`
    : `${count} services are due in ${remaining} miles.`;
}
