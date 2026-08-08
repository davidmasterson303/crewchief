/**
 * The one service question a new owner is asked, and what it turns into.
 *
 * Track A2a. Rev F's constraint is the whole design brief: *"**One** question —
 * most recent visit, mileage and roughly when — plus a 'skip, I'll scan my
 * receipts' path. Not a twelve-category matrix; every onboarding question costs
 * completion on the first screen a paying user meets."*
 *
 * ── Why it asks about the oil change specifically ───────────────────────────
 *
 * "When was it last serviced?" is the natural phrasing and it does not work,
 * for a mechanical reason rather than a stylistic one: the answer has to be
 * matched to a scheduled service, `categoryFor('service')` is `null`, and a
 * baseline that matches nothing is a question asked for no benefit.
 *
 * So the question names the work. **Oil change** is the right one to name on
 * three counts, and they happen to agree:
 *
 *   - It is the service people actually remember. "Last oil change" gets an
 *     answer; "last service" gets "erm, the dealer did something".
 *   - It has the shortest interval in almost every schedule, so it is the item
 *     most likely to be due and the one where a wrong baseline costs most.
 *   - It maps cleanly and unambiguously onto `Oil Change`.
 *
 * The other services stay estimated, and the receipts path is how they stop
 * being. That is a smaller claim than "we know your history" and it is the true
 * one.
 *
 * ── Erring toward due, never toward fine ────────────────────────────────────
 *
 * "Roughly when" cannot produce a date, so each option resolves to **the oldest
 * date in its range**. Someone choosing "in the last 6 months" is recorded as
 * six months ago, not three.
 *
 * The asymmetry is deliberate and it is a safety judgement rather than a
 * statistical one. Reporting a service as *more recently done than it was*
 * suppresses a real alert — the app quietly tells someone their brakes are fine
 * — and reporting it as *older than it was* raises one slightly early, which
 * costs an unnecessary glance. Those two errors are not equal, so the estimate
 * is not centred.
 */

/** How long ago the owner reckons it was. */
export type BaselineAge = 'under-6-months' | 'six-to-twelve' | 'over-a-year' | 'not-sure';

export interface BaselineAgeOption {
  value: BaselineAge;
  label: string;
  /**
   * The oldest point in the range, in months. `null` means the answer carries
   * no date at all.
   */
  months: number | null;
}

/**
 * Four options, and the fourth is not a filler.
 *
 * "Not sure" has to be reachable, and reachable *without feeling like a
 * failure*, or people guess — and a guessed date recorded as an owner-reported
 * baseline is worse than no baseline, because it is indistinguishable from a
 * real one afterwards. A mileage with no date is still useful on its own: every
 * mileage-based service can count from it.
 */
export const BASELINE_AGE_OPTIONS: BaselineAgeOption[] = [
  { value: 'under-6-months', label: 'In the last 6 months', months: 6 },
  { value: 'six-to-twelve', label: '6 to 12 months ago', months: 12 },
  { value: 'over-a-year', label: 'Over a year ago', months: 18 },
  { value: 'not-sure', label: "I'm not sure", months: null },
];

export function isBaselineAge(value: unknown): value is BaselineAge {
  return BASELINE_AGE_OPTIONS.some((option) => option.value === value);
}

/**
 * The date an age answer resolves to, or `null`.
 *
 * `over-a-year` resolves to 18 months rather than 12. "Over a year" is an open
 * range with no upper bound, and taking its *lower* bound would be the one
 * place this function rounds toward "recently done" — the direction the whole
 * module is built to avoid. Eighteen months is a reasonable middle for an
 * unbounded answer and still errs old.
 */
export function baselineDate(age: BaselineAge, today: string): string | null {
  const option = BASELINE_AGE_OPTIONS.find((candidate) => candidate.value === age);
  if (!option || option.months === null) return null;

  const date = new Date(`${today}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;

  const target = new Date(date);
  target.setUTCMonth(target.getUTCMonth() - option.months);

  /*
    Clamped for the same reason `addMonths` in `service-due.ts` is: stepping
    back a month from the 31st lands on a date that does not exist, and
    `setUTCMonth` silently rolls it forward into the next month — so "6 months
    before 31 August" would come out as 3 March rather than 28 February. Rolling
    *forward* is precisely the wrong direction here.
  */
  if (target.getUTCDate() !== date.getUTCDate()) {
    target.setUTCDate(0);
  }

  return target.toISOString().slice(0, 10);
}

/**
 * What gets written to `maintenance_line_items`, or `null` when the answer
 * carries nothing worth storing.
 *
 * Returns a plain object rather than performing the insert: this is `core`, and
 * the caller owns the client. It also means the whole rule is testable with no
 * database.
 */
export interface BaselineRow {
  item_description: string;
  service_date: string | null;
  mileage_at_service: number | null;
  source: 'owner-onboarding';
}

/**
 * The description is fixed, and says on the row itself where it came from.
 *
 * It has to contain a phrase `categoryFor` recognises — that is the point of
 * asking — and the trailing clause means anyone reading the maintenance list
 * later can see this was typed at sign-up rather than taken off an invoice.
 * The `source` column is the machine-readable version of the same fact; this is
 * for the person looking at the screen.
 */
export const BASELINE_DESCRIPTION = 'Oil change — reported at sign-up';

export function buildBaselineRow(params: {
  mileage: number | null;
  age: BaselineAge | null;
  today: string;
}): BaselineRow | null {
  const { mileage, age, today } = params;

  const usableMileage =
    typeof mileage === 'number' && Number.isFinite(mileage) && mileage >= 0 ? mileage : null;

  const serviceDate = age === null ? null : baselineDate(age, today);

  /*
    Nothing to record is not an error, it is the "skip" path and the "not sure"
    answer with no mileage. Writing a row with neither a date nor a mileage
    would put an entry in someone's service history that says only "we asked
    and they did not know" — visible on the maintenance screen, matched by
    `categoryFor`, and capable of displacing nothing but confusing everyone.
  */
  if (usableMileage === null && serviceDate === null) return null;

  return {
    item_description: BASELINE_DESCRIPTION,
    service_date: serviceDate,
    mileage_at_service: usableMileage,
    source: 'owner-onboarding',
  };
}
