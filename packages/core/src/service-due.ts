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
 * That component rendered nowhere and carried a hardcoded `COMMON_INTERVALS`
 * table: oil every 5,000 miles, plugs every 30,000, for every car in the
 * product. A generic table is a reasonable placeholder on a screen someone
 * chose to open and a bad basis for an unprompted notification — "your
 * transmission fluid is due" is a claim about *this* car, and a Honda and a BMW
 * do not share an interval. R14 recorded the component as unrendered; the table
 * is the likelier reason it never was.
 *
 * It has since been deleted, so the table is no longer in the tree to be
 * reached for. The heading stays because the argument is about *approach* and
 * outlives the file: a schedule this module cannot source from the vehicle is a
 * schedule it should decline to assert, not one to fill in from an average.
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

/*
  The only import in this module, and it points at the vocabulary rather than
  the other way round.

  `service-provenance.ts` describes *what a claim means*; this file decides
  *what happened*. The concept "which kind of record did we count from" is a
  provenance idea, so it is defined there and consumed here — and the
  dependency stays one-directional because `service-provenance` types its own
  inputs structurally and never imports this file.
*/
import type { ServiceEvidence } from './service-provenance';

/**
 * `unknown` is not a fifth severity — it means **we cannot say**.
 *
 * A time-based service with no recorded service date has no computable due
 * point. The first version of this module had no such state and filtered those
 * entries out, which is how brake fluid disappeared from all four cars in the
 * product. Saying "we don't know when this was last done" keeps a safety item
 * on the screen; dropping it silently does not.
 */
export type DueStatus = 'overdue' | 'due' | 'soon' | 'later' | 'unknown';

export interface ScheduleEntry {
  service: string;
  /** Absent on time-only services — brake fluid, most commonly. */
  interval_miles?: number | null;
  interval_months?: number | null;
  description?: string;
  priority?: 'Critical' | 'Recommended' | 'Optional';
}

export interface ServiceDue {
  service: string;
  description: string;
  priority: 'Critical' | 'Recommended' | 'Optional';
  intervalMiles: number | null;
  intervalMonths: number | null;
  /** The odometer reading this is next wanted at, or null when time-only. */
  dueAtMiles: number | null;
  /** Negative when overdue. Null when this service is not mileage-based. */
  milesRemaining: number | null;
  /** ISO `YYYY-MM-DD` the time interval elapses, when one can be computed. */
  dueOn: string | null;
  /** Negative when overdue. Null when not time-based or no date is recorded. */
  monthsRemaining: number | null;
  /** Which interval is driving `status` — "whichever comes first". */
  drivenBy: 'miles' | 'time' | null;
  status: DueStatus;
  /** Whether a completed service was found to count from. */
  basedOnHistory: boolean;
  /**
   * *What kind* of thing was found — Track A2a.
   *
   * `basedOnHistory` answers "did we find anything", which was enough while
   * everything came from invoices. Once an owner can type a baseline at
   * sign-up, a boolean cannot tell a document from a recollection, and
   * `service-provenance.ts` has to say which. Kept alongside rather than
   * replacing it: the two answer different questions and both have callers.
   */
  evidence: ServiceEvidence;
}

export interface Milestone {
  /**
   * The reading the milestone is named for — "the 60,000 service".
   *
   * **Null when the visit is driven purely by a date.** A brake-fluid flush due
   * by calendar has no odometer figure, and naming the visit after an invented
   * one would be the same lie as inventing the interval.
   */
  mileage: number | null;
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

/** Within this many months, a time-based service is due rather than approaching. */
const DUE_WINDOW_MONTHS = 1;

/** Within this many months, worth mentioning but not worth a trip. */
const SOON_WINDOW_MONTHS = 3;

function statusForMiles(milesRemaining: number): DueStatus {
  if (milesRemaining < OVERDUE_AT) return 'overdue';
  if (milesRemaining <= DUE_WINDOW_MILES) return 'due';
  if (milesRemaining <= SOON_WINDOW_MILES) return 'soon';
  return 'later';
}

function statusForMonths(monthsRemaining: number): DueStatus {
  if (monthsRemaining < OVERDUE_AT) return 'overdue';
  if (monthsRemaining <= DUE_WINDOW_MONTHS) return 'due';
  if (monthsRemaining <= SOON_WINDOW_MONTHS) return 'soon';
  return 'later';
}

/** Ordered by how much attention each state deserves. `unknown` sorts last. */
const STATUS_URGENCY: Record<DueStatus, number> = {
  overdue: 0,
  due: 1,
  soon: 2,
  later: 3,
  unknown: 4,
};

/**
 * Add whole months to a date without letting the runtime roll a short month.
 *
 * `setMonth` on 31 January + 1 gives 3 March, which would report a service due
 * two days late every time the arithmetic crossed February. Clamped to the last
 * valid day instead.
 */
function addMonths(iso: string, months: number): string | null {
  const start = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return null;

  const day = start.getUTCDate();
  const shifted = new Date(start);
  shifted.setUTCDate(1);
  shifted.setUTCMonth(shifted.getUTCMonth() + months);

  const lastDayOfMonth = new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 0)
  ).getUTCDate();

  shifted.setUTCDate(Math.min(day, lastDayOfMonth));
  return shifted.toISOString().slice(0, 10);
}

/** Fractional months between two ISO dates. Negative when `to` is past. */
function monthsBetween(from: string, to: string): number {
  const a = new Date(`${from.slice(0, 10)}T00:00:00Z`).getTime();
  const b = new Date(`${to.slice(0, 10)}T00:00:00Z`).getTime();

  // 30.44 days is the mean month, and matches `mileage-tracking.ts`'s constant.
  return (b - a) / (1000 * 60 * 60 * 24 * 30.44);
}

/**
 * Evaluate every schedule entry against the odometer.
 *
 * `lastServiceMileage` is a lookup the caller supplies, because resolving "has
 * this been done" means reading service history and invoice line items — IO
 * this module deliberately does not do. `maintenance-sync.ts` already holds
 * that matching logic.
 *
 * **Entries with no usable interval at all are skipped, not guessed at.** Every
 * vehicle onboarded before 7 Aug 2026 carries prose intervals, and inventing a
 * number for them would produce confident notifications from data that cannot
 * support one.
 *
 * ── "Whichever comes first", which is how a real schedule reads ─────────────
 *
 * A service carrying both intervals — "every 10,000 miles or 12 months" — is
 * due when *either* elapses, and the status reflects whichever is more urgent.
 * `drivenBy` records which one, because "due in 400 miles" and "due next month"
 * are different sentences and the screen should say the true one.
 *
 * ── Why time-only services are kept even when unanswerable ──────────────────
 *
 * The first version of this module filtered on `interval_miles` alone, and
 * **every one of the four cars in the product has a time-only brake-fluid
 * entry** — so brake fluid, a safety item, silently vanished from every
 * milestone. That is the same defect as the hardcoded `COMMON_INTERVALS` table
 * this module was written to replace, only worse: that table at least mentioned
 * it.
 *
 * A time-based service with no recorded service date has no computable due
 * point, so it comes back `unknown` rather than being dropped. The screen shows
 * it and says why; `isWorthNotifying` ignores it, because "we cannot tell when
 * this is due" is not something to wake someone up for.
 */
export function evaluateSchedule(params: {
  schedule: ScheduleEntry[];
  currentMileage: number;
  lastServiceMileage?: (service: string) => number | null;
  lastServiceDate?: (service: string) => string | null;
  /**
   * Which kind of record the two lookups above answered from — Track A2a.
   *
   * Optional, and its absence means `'records'` rather than `null`: every
   * caller that existed before A2a supplied history from
   * `maintenance_line_items` rows extracted from invoices, so treating a
   * missing answer as "no evidence" would silently downgrade every existing
   * claim. A caller that has owner-reported baselines says so.
   */
  lastServiceEvidence?: (service: string) => ServiceEvidence;
  /** Injectable so a test is not at the mercy of the clock. */
  today?: string;
}): ServiceDue[] {
  const { schedule, currentMileage, lastServiceMileage, lastServiceDate } = params;
  const lastServiceEvidence = params.lastServiceEvidence;
  const today = params.today ?? new Date().toISOString().slice(0, 10);

  return schedule
    .filter((entry) => usableMiles(entry) !== null || usableMonths(entry) !== null)
    .map((entry) => {
      const intervalMiles = usableMiles(entry);
      const intervalMonths = usableMonths(entry);

      const lastMileage = lastServiceMileage ? lastServiceMileage(entry.service) : null;
      const lastDate = lastServiceDate ? lastServiceDate(entry.service) : null;
      const found = lastMileage !== null || lastDate !== null;

      let dueAtMiles: number | null = null;
      let milesRemaining: number | null = null;
      if (intervalMiles !== null) {
        dueAtMiles = nextDueMileage(intervalMiles, currentMileage, lastMileage);
        milesRemaining = dueAtMiles - currentMileage;
      }

      /*
        A time interval needs a date to count from and there is no odometer
        equivalent to fall back on — the "next boundary above current" trick
        works for mileage because the odometer *is* a running total. Nothing
        plays that role for time, so an unknown date stays unknown.
      */
      let dueOn: string | null = null;
      let monthsRemaining: number | null = null;
      if (intervalMonths !== null && lastDate) {
        dueOn = addMonths(lastDate, intervalMonths);
        if (dueOn) monthsRemaining = monthsBetween(today, dueOn);
      }

      const byMiles = milesRemaining !== null ? statusForMiles(milesRemaining) : null;
      const byMonths = monthsRemaining !== null ? statusForMonths(monthsRemaining) : null;

      let status: DueStatus;
      let drivenBy: 'miles' | 'time' | null;

      if (byMiles !== null && byMonths !== null) {
        // Whichever comes first.
        const monthsWins = STATUS_URGENCY[byMonths] < STATUS_URGENCY[byMiles];
        status = monthsWins ? byMonths : byMiles;
        drivenBy = monthsWins ? 'time' : 'miles';
      } else if (byMiles !== null) {
        status = byMiles;
        drivenBy = 'miles';
      } else if (byMonths !== null) {
        status = byMonths;
        drivenBy = 'time';
      } else {
        // Time-only, and nothing records when it was last done.
        status = 'unknown';
        drivenBy = null;
      }

      return {
        service: entry.service,
        description: entry.description ?? '',
        priority: entry.priority ?? 'Recommended',
        intervalMiles,
        intervalMonths,
        dueAtMiles,
        milesRemaining,
        dueOn,
        monthsRemaining,
        drivenBy,
        status,
        basedOnHistory: found,
        /*
          Only claim an evidence kind when something was actually found. A
          caller supplying `lastServiceEvidence` for every service in the
          schedule would otherwise have its answer recorded for services whose
          lookups returned nothing — a provenance label on a figure that rests
          on no record at all, which is the exact defect this vocabulary exists
          to prevent.
        */
        evidence: found ? lastServiceEvidence?.(entry.service) ?? 'records' : null,
      };
    })
    .sort(
      (a, b) =>
        STATUS_URGENCY[a.status] - STATUS_URGENCY[b.status] ||
        (a.milesRemaining ?? Number.MAX_SAFE_INTEGER) - (b.milesRemaining ?? Number.MAX_SAFE_INTEGER)
    );
}

function positive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function usableMiles(entry: ScheduleEntry): number | null {
  return positive(entry?.interval_miles);
}

function usableMonths(entry: ScheduleEntry): number | null {
  return positive(entry?.interval_months);
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
 *
 * ── Time-based work joins the visit it belongs to ───────────────────────────
 *
 * A brake-fluid flush that is due by date has no `dueAtMiles` to group on, so
 * the mileage window cannot see it. It joins the milestone on **status**
 * instead: anything already overdue or due is work you would have done at the
 * same appointment, whatever calendar or odometer said so.
 *
 * `unknown` entries never join. They belong on the screen — see
 * `evaluateSchedule` — but a milestone is a list of work to book, and "we
 * cannot tell when this was last done" is not bookable.
 */
export function nextMilestone(
  services: ServiceDue[],
  options: { horizonMiles?: number } = {}
): Milestone | null {
  const horizon = options.horizonMiles ?? SOON_WINDOW_MILES;

  const bookable = services.filter((service) => service.status !== 'unknown');

  // Already sorted by `evaluateSchedule`, but callers may hand us anything.
  const ordered = [...bookable].sort(
    (a, b) =>
      STATUS_URGENCY[a.status] - STATUS_URGENCY[b.status] ||
      (a.milesRemaining ?? Number.MAX_SAFE_INTEGER) - (b.milesRemaining ?? Number.MAX_SAFE_INTEGER)
  );

  const anchor = ordered[0];
  if (!anchor) return null;

  // Beyond the horizon in both dimensions is nothing to raise.
  const anchorMiles = anchor.milesRemaining;
  if (anchorMiles !== null && anchorMiles > horizon && anchor.status !== 'overdue') return null;
  if (anchorMiles === null && STATUS_URGENCY[anchor.status] > STATUS_URGENCY.due) return null;

  const grouped = ordered.filter((item) => {
    // Anything already on you is part of this visit, however it got there.
    if (item.status === 'overdue' || item.status === 'due') return true;

    if (item.dueAtMiles === null || anchor.dueAtMiles === null) return false;
    return Math.abs(item.dueAtMiles - anchor.dueAtMiles) <= MILESTONE_WINDOW_MILES;
  });

  return {
    /*
      Named for the anchor's reading rather than an average or a round number.
      "The 62,300 service" is odd phrasing but it is the truth; rounding it to
      60,000 would name a milestone the car has already passed.

      Null when the visit is driven purely by a date — there is no mileage to
      name it after, and inventing one would be the same lie as inventing an
      interval.
    */
    mileage: anchor.dueAtMiles,
    services: grouped.sort(
      (a, b) =>
        STATUS_URGENCY[a.status] - STATUS_URGENCY[b.status] ||
        (a.milesRemaining ?? Number.MAX_SAFE_INTEGER) -
          (b.milesRemaining ?? Number.MAX_SAFE_INTEGER) ||
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
    /*
      The *most* overdue, and it has to be found rather than taken off an end.
      The list is sorted by status then by miles remaining, and a time-driven
      entry sorts with a null distance — so `overdue[overdue.length - 1]` was
      picking whichever happened to land last, not the worst one.
    */
    const worst = overdue.reduce((a, b) => (overdueBy(b) > overdueBy(a) ? b : a));

    if (worst.drivenBy === 'time' && worst.monthsRemaining !== null) {
      const months = Math.max(1, Math.round(Math.abs(worst.monthsRemaining)));
      return `${worst.service} is ${months} month${months === 1 ? '' : 's'} overdue.`;
    }

    const by = Math.abs(worst.milesRemaining ?? 0).toLocaleString('en-US');
    return `${worst.service} is ${by} miles overdue.`;
  }

  const count = milestone.services.length;

  /*
    A visit with no mileage to name it after is driven by a date, and saying
    "due in 0 miles" would be both wrong and alarming.
  */
  if (milestone.mileage === null) {
    const soonest = milestone.services[0];
    const when = soonest?.dueOn ? ` by ${soonest.dueOn}` : '';

    return count === 1
      ? `${soonest.service} is due${when}.`
      : `${count} services are due${when}.`;
  }

  const remaining = Math.max(0, milestone.mileage - currentMileage).toLocaleString('en-US');

  return count === 1
    ? `${milestone.services[0].service} is due in ${remaining} miles.`
    : `${count} services are due in ${remaining} miles.`;
}

/** How far past due, in whichever unit drove it. Used only for ranking. */
function overdueBy(service: ServiceDue): number {
  if (service.drivenBy === 'time' && service.monthsRemaining !== null) {
    // Roughly a thousand miles a month, so the two rank against each other
    // sensibly rather than months always losing to miles.
    return Math.abs(service.monthsRemaining) * 1_000;
  }

  return Math.abs(service.milesRemaining ?? 0);
}
