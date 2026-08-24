import { evaluateSchedule, type DueStatus, type ServiceDue } from './service-due';
import { historyLookups, type ServiceHistoryRow } from './service-history';
import { normaliseRecalls, worstSeverity, type NormalisedRecall } from './recalls';

/**
 * What the health score is made of — the three drivers.
 *
 * ── Why these are computed and not generated ────────────────────────────────
 *
 * David chose this on 15 Aug against the alternative of asking the model for
 * three more numbers in the health-summary prompt. The alternative was cheaper
 * and it was wrong: **a model asked for a number produces one whether or not it
 * has grounds.** `vehicle_health_summary.maintenance_status` is prose about real
 * data — *"Several intervals coming due. Prioritize CVT fluid and brake fluid"* —
 * and a 73 next to it would be a judgement about nothing.
 *
 * The product's claim is that it shows you *why*. A driver the model invented
 * cannot be explained when the owner taps it, and the health card exists to be
 * tapped. So every input here is a fact the database holds, and every driver
 * carries the sentence that explains its own number.
 *
 * ── ⚠ These do not add up to `health_score`, and must not be shown as if ────
 *
 * `health_score` comes from the model. These three do not, so they explain the
 * *subject* without arithmetically explaining the *total*. That is defensible
 * for one release and awkward forever; whether `health_score` eventually
 * becomes a function of these is a product decision, not a refactor.
 *
 * Until it is taken, a caller must not render "74 = 60 + 90 + 72" or anything
 * that implies it. They are drivers, not terms.
 *
 * ── Null is not zero, and this file says so four times ──────────────────────
 *
 * A missing driver scores `null`, never 0. The same rule the garage card
 * already follows for a missing health score: banding an unmeasured value
 * paints a car red about a condition nobody checked. Every `null` here has a
 * `detail` explaining what is missing, because "—" on its own reads as a bug.
 */

export type HealthDriverKey = 'maintenance' | 'recalls' | 'mileage-load';

export interface HealthDriver {
  key: HealthDriverKey;
  /** The word on the card. One wording across every client. */
  label: string;
  /**
   * 1–100, the same scale and direction as `health_score` — higher is better.
   *
   * `null` when there is not enough on record to judge, which is a different
   * statement from a low score and has to render differently.
   */
  score: number | null;
  /** One line saying what the number is made of. Always present, even at null. */
  detail: string;
}

/* ── Maintenance ─────────────────────────────────────────────────────────── */

/**
 * What each state costs, before priority weighting.
 *
 * `unknown` costs nothing, and that is the load-bearing choice. A time-only
 * service with no date to count from is a **gap in our records**, not a fault in
 * the car, and charging for it would let a car with no invoices score worse than
 * one with a genuine overdue brake fluid. `service-due.ts` makes the same
 * argument for keeping those services visible rather than dropping them: say we
 * do not know, do not pretend it is bad news.
 *
 * The gap is reported in `detail` instead, where it belongs.
 */
const STATUS_PENALTY: Record<DueStatus, number> = {
  overdue: 22,
  due: 10,
  soon: 3,
  later: 0,
  unknown: 0,
};

/**
 * Priority weighting.
 *
 * An overdue cabin filter is not an overdue timing belt. The knowledge base
 * already grades every entry, so this reads that grade rather than inventing a
 * second opinion about which services matter.
 */
const PRIORITY_WEIGHT: Record<string, number> = {
  Critical: 1,
  Recommended: 0.6,
  Optional: 0.3,
};

const clamp = (score: number) => Math.max(1, Math.min(100, Math.round(score)));

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * How far behind this car is on its own schedule.
 *
 * Penalty from 100 rather than a ratio of good-to-bad, because a car with two
 * tracked services and one overdue is not "50% healthy" — it is one service
 * behind. The number should move with the amount of work owed, not with how
 * many rows the knowledge base happened to write.
 */
export function maintenanceDriver(services: ServiceDue[]): HealthDriver {
  const label = 'Maintenance';

  if (services.length === 0) {
    return {
      key: 'maintenance',
      label,
      score: null,
      detail: 'No service schedule on record for this car yet.',
    };
  }

  const penalty = services.reduce((total, service) => {
    const weight = PRIORITY_WEIGHT[service.priority] ?? PRIORITY_WEIGHT.Recommended;
    return total + STATUS_PENALTY[service.status] * weight;
  }, 0);

  const count = (status: DueStatus) => services.filter((s) => s.status === status).length;
  const overdue = count('overdue');
  const due = count('due');
  const unknown = count('unknown');

  /*
    ── ⚠ FN-01b · nothing known is not "nothing overdue" ─────────────────────

    `STATUS_PENALTY.unknown` is **0**, and that is right: an owner should not be
    marked down for records we do not have. But 0 penalty across every service
    produces `100 - 0 = 100`, and the sentence beside it read *"Nothing overdue,
    across 8 tracked services"* — a **perfect maintenance score for a car with
    no service records at all**, in the one module written to stop absence being
    rendered as an all-clear. Confirmed live on 23 Aug against the M235i.

    The two halves were each defensible and the combination was not. Not
    penalising an unknown is correct; **scoring at all when everything is
    unknown is not**, because a score computed from no evidence is a claim.

    `null` already means "we cannot say" here — the no-schedule branch above
    returns it — so the fix is to reach the same conclusion from the same
    absence, arrived at one step later.
  */
  if (unknown === services.length) {
    return {
      key: 'maintenance',
      label,
      score: null,
      detail: `No service records yet for any of ${plural(services.length, 'tracked service')}.`,
    };
  }

  /*
    The sentence is assembled from the same counts the score is, so it can never
    describe a different car than the number does.

    ⚠ **The absence leads when there is nothing else to report.** "Nothing
    overdue, across 8 tracked services. 3 services with no record to count from."
    reads as a clean bill with a footnote, and the footnote is the load-bearing
    half. When the only thing to say is that records are missing, that is what
    the sentence opens with.
  */
  const parts: string[] = [];
  if (overdue > 0) parts.push(`${plural(overdue, 'service')} overdue`);
  if (due > 0) parts.push(`${due} due now`);

  const counted = services.length - unknown;

  if (parts.length === 0) {
    const detail =
      unknown > 0
        ? `${plural(unknown, 'service')} with no record to count from. Nothing overdue among the ${counted} we can check.`
        : `Nothing overdue, across ${plural(services.length, 'tracked service')}.`;

    return { key: 'maintenance', label, score: clamp(100 - penalty), detail };
  }

  let detail = `${parts.join(', ')}, across ${plural(services.length, 'tracked service')}.`;
  if (unknown > 0) {
    // Stated, never absorbed into the score. See STATUS_PENALTY.
    detail += ` ${plural(unknown, 'service')} with no record to count from.`;
  }

  return { key: 'maintenance', label, score: clamp(100 - penalty), detail };
}

/* ── Recalls ─────────────────────────────────────────────────────────────── */

/**
 * The first recall costs most.
 *
 * A car with one open recall and a car with three are both "a car with an
 * unfixed safety defect"; the difference between them matters less than the
 * difference between either and none. A linear count would make the third
 * recall as costly as the first, which overstates it.
 */
const FIRST_RECALL = 45;
const EACH_FURTHER_RECALL = 20;

/**
 * A do-not-drive recall is not a score, it is an instruction.
 *
 * These two ceilings exist so no amount of otherwise-good news can lift the
 * driver out of the range where the card has to look alarming. NHTSA's own
 * severity flags carry it; `recalls.ts` already parses them, including the
 * `"false"`-as-a-string trap that would otherwise put "do not drive" on every
 * recall in the list.
 */
const CEILING: Record<string, number> = { 'do-not-drive': 5, 'park-outside': 25 };

/**
 * Open recalls against this vehicle.
 *
 * ⚠ **The product does not track recall completion**, so a recall the owner had
 * fixed last year still counts here. That is the conservative direction to be
 * wrong in — overstating a safety issue costs a wasted phone call to a dealer,
 * understating it costs the thing the recall was issued for — but it is a real
 * limitation and `detail` says "on record" rather than "open" because of it.
 */
export function recallDriver(raw: unknown): HealthDriver {
  const label = 'Recalls';

  /*
    Absent is not empty. A vehicle whose NHTSA lookup has never run has not been
    cleared, and scoring it 100 would be a claim about NHTSA's completeness that
    this product cannot make — the same argument `worstSeverity` makes for
    rendering nothing rather than a reassuring badge.
  */
  if (raw === null || raw === undefined) {
    return {
      key: 'recalls',
      label,
      score: null,
      detail: 'Recalls have not been checked for this vehicle.',
    };
  }

  const recalls: NormalisedRecall[] = normaliseRecalls(raw);

  if (recalls.length === 0) {
    return { key: 'recalls', label, score: 100, detail: 'No recalls on record.' };
  }

  const penalty = FIRST_RECALL + (recalls.length - 1) * EACH_FURTHER_RECALL;
  const worst = worstSeverity(recalls);
  const ceiling = worst ? CEILING[worst] : undefined;

  const score = clamp(ceiling === undefined ? 100 - penalty : Math.min(100 - penalty, ceiling));

  let detail = `${plural(recalls.length, 'recall')} on record.`;
  if (worst === 'do-not-drive') detail += ' One is a do-not-drive.';
  else if (worst === 'park-outside') detail += ' One says park outside.';

  return { key: 'recalls', label, score, detail };
}

/* ── Mileage load ────────────────────────────────────────────────────────── */

/**
 * The yardstick: 12,000 miles a year.
 *
 * The long-running US average, and it is a *yardstick* rather than a target —
 * a car above it is being used, not abused. That is why the ramp below is
 * gentle and why the label is "load" rather than "wear": this driver says how
 * hard the car has worked, and nothing about whether it was worked well.
 */
const AVERAGE_MILES_PER_YEAR = 12_000;

/**
 * Half the average scores 100; every further half-average costs 15.
 *
 * `100 - 30 × (ratio - 0.5)`. 12k/yr lands at 85, 20k at 65, 30k at 40 — the
 * range real cars actually occupy stays legible rather than pinning at the
 * bottom. A steeper ramp would make an ordinary high-mileage car read as a
 * wreck, which is the overclaim this product's health wording was rewritten to
 * remove.
 *
 * ⚠ Linear, so it **reaches the floor at about 3.8x the average** — roughly
 * 46,000 miles a year. That is the honest answer at that reading rather than a
 * clamp papering over the formula, but it does mean the driver stops
 * discriminating above it. If delivery and rideshare vehicles ever matter to
 * this product, the tail wants a curve rather than a clamp.
 */
export function mileageLoadDriver(params: {
  currentMileage?: number | null;
  /** Model year. Ahead of the build year on most cars, which is why age floors at 1. */
  year?: number | null;
  /** Injectable so a test is not at the mercy of the clock. */
  today?: string;
}): HealthDriver {
  const label = 'Mileage load';
  const { currentMileage, year } = params;

  if (typeof currentMileage !== 'number' || typeof year !== 'number' || currentMileage < 0) {
    return {
      key: 'mileage-load',
      label,
      score: null,
      detail: 'Needs both an odometer reading and a model year.',
    };
  }

  const thisYear = Number((params.today ?? new Date().toISOString()).slice(0, 4));

  /*
    Floored at 1. A current-model-year car is not zero years old for this
    purpose — it has been driven — and dividing by zero would score every new
    car at the floor.
  */
  const age = Math.max(1, thisYear - year);
  const expected = age * AVERAGE_MILES_PER_YEAR;
  const perYear = Math.round(currentMileage / age);

  const score = clamp(100 - 30 * (currentMileage / expected - 0.5));

  return {
    key: 'mileage-load',
    label,
    score,
    detail: `About ${perYear.toLocaleString('en-US')} miles a year over ${plural(age, 'year')}, against a ${AVERAGE_MILES_PER_YEAR.toLocaleString('en-US')} average.`,
  };
}

/* ── The three together ──────────────────────────────────────────────────── */

/**
 * All three drivers, in the order the card shows them.
 *
 * Maintenance first because it is the one the owner can act on today, recalls
 * second because they are the one that can be urgent, mileage load last because
 * it is context rather than a task. One function so no caller assembles its own
 * subset or its own order.
 */
export function healthDrivers(params: {
  /** Already evaluated — the caller owns the schedule and history lookups. */
  services: ServiceDue[];
  /** Raw `nhtsa_data.recalls`. Pass `null`/`undefined` when it was never fetched. */
  recalls: unknown;
  currentMileage?: number | null;
  year?: number | null;
  today?: string;
}): HealthDriver[] {
  return [
    maintenanceDriver(params.services),
    recallDriver(params.recalls),
    mileageLoadDriver({
      currentMileage: params.currentMileage,
      year: params.year,
      today: params.today,
    }),
  ];
}

/* ── One assembly, for every client ──────────────────────────────────────── */

/**
 * The three drivers for one vehicle, from the rows a client actually holds.
 *
 * ── ⚠ Why the assembly is here and not at each call site ────────────────────
 *
 * `healthDrivers` takes *evaluated* services, so every caller first has to run
 * `evaluateSchedule` over the knowledge base's schedule with `historyLookups`
 * built from the vehicle's maintenance rows — and get three separate things
 * right while doing it: that a missing schedule is `[]` rather than a throw,
 * that a failed history read degrades to no history rather than to no services,
 * and that `recalls` stays `undefined` when NHTSA was never asked instead of
 * becoming an empty array.
 *
 * `app/api/v1/load-vehicle/route.ts` got all three right. It was also the
 * **only** caller, which is why the web dashboard rendered no drivers at all —
 * and the reason D10 could specify "refuse to render a band when all three
 * drivers return null" against a client that had no drivers to consult.
 *
 * Duplicating that assembly to fix it would be this codebase's most repeated
 * defect volunteered for a second time: a capability that is subtly right in
 * one client and subtly different in the other. So the assembly moves here,
 * where both read it, and the third client that needs it inherits the three
 * decisions rather than re-making them.
 */
export function driversForVehicle(params: {
  /** `vehicle_knowledge_base.maintenance_schedule`. Anything not an array means no schedule. */
  schedule: unknown;
  /** `maintenance_line_items` rows. Pass `[]` for a read that failed — see below. */
  historyRows: ServiceHistoryRow[];
  /**
   * Raw `nhtsa_data.recalls`.
   *
   * ⚠ `undefined` when the lookup never ran or did not resolve. `recallDriver`
   * reads that as "not checked" and an empty array as "checked, none found",
   * and they must not be collapsed.
   */
  recalls: unknown;
  currentMileage?: number | null;
  year?: number | null;
  today?: string;
}): HealthDriver[] {
  /*
    A failed history read degrades to *no history*, never to no services. Every
    mileage-driven service still evaluates from the odometer alone; what is lost
    is the date evidence, which `maintenanceDriver` reports as `unknown` and is
    explicitly built not to charge for.
  */
  const services = Array.isArray(params.schedule)
    ? evaluateSchedule({
        schedule: params.schedule as Parameters<typeof evaluateSchedule>[0]['schedule'],
        currentMileage: params.currentMileage ?? 0,
        ...historyLookups(params.historyRows),
        ...(params.today === undefined ? {} : { today: params.today.slice(0, 10) }),
      })
    : [];

  return healthDrivers({
    services,
    recalls: params.recalls,
    currentMileage: params.currentMileage,
    year: params.year,
    today: params.today,
  });
}

/**
 * Whether the drivers support showing a band at all.
 *
 * ── ⚠ D10 · "refuse to render a band when all three drivers return null" ────
 *
 * The health score comes from the model and the drivers are computed, so the
 * two can disagree — and the disagreement that matters is the one where the
 * model returns a confident number for a car about which *nothing computable is
 * known*. Every driver `null` means: no service schedule or no records against
 * it, no recall lookup, and no odometer-and-year pair. A score presented as a
 * reading on top of that is a judgement about nothing, which is the same defect
 * as the hardcoded 70 arriving by a longer route.
 *
 * ⚠ This is deliberately **all** rather than **any**. One null driver is
 * normal and is exactly the case the drivers are written to report honestly —
 * a car with an odometer and no recall check still supports a reading. Refusing
 * on any null would suppress the band on most real vehicles and teach everyone
 * to ignore the rule.
 */
export function driversSupportAScore(drivers: HealthDriver[]): boolean {
  if (drivers.length === 0) return false;
  return drivers.some((driver) => driver.score !== null);
}
