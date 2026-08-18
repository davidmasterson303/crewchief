import { formatDate, formatMileage } from './formatting-utils';

/**
 * The garage card's third row — *"Next service · Oil & filter · in 420 mi"*.
 *
 * ── The thing this file exists to get right ─────────────────────────────────
 *
 * `docs/step4-api-gaps.md` §3 blocked the whole row on one sentence: *"'No
 * schedule yet' is not the same as 'nothing due', and the card must not imply
 * the second."* `nextService`'s own docblock says the same. That is the
 * decision, and everything below follows from it.
 *
 * ⚠ **It is decided here rather than at the shop counter of a component**
 * because it is a claim about a car, not a layout. The same rule holds
 * wherever this line is drawn.
 *
 * ── What actually disambiguates the empty state, and it is not the copy ─────
 *
 * The obvious worry is that "No schedule yet" sitting alone on a card reads as
 * "this car has nothing coming up" — reassurance the product has not earned.
 * The fix is not a cleverer phrase. **It is that the label never leaves.** The
 * row is always *"Next service — <something>"*, so the subject of the sentence
 * is fixed before the value is read, and "No schedule yet" can only be heard as
 * an answer to *that* question: we do not have a schedule. A row that vanishes
 * when the answer is unknown is the version that lies, because a card with no
 * next-service line, next to one that has it, reads as a car with nothing due.
 *
 * This is also why the phrasing matches `GarageBay`'s sibling **"No score
 * yet"** rather than inventing a new form of words. Two absences on one card
 * that phrase themselves differently read as two different kinds of problem.
 *
 * ── ⚠ Timing is required, and a named service without it is worse than none ──
 *
 * If a label survives but nothing says *when*, this returns `unknown` rather
 * than a bare service name. "Oil & filter" alone under a heading that says
 * "Next service" reads as *now*, which is the loudest thing this row can say
 * and the one it would be saying by accident.
 */

/**
 * The three stored columns, as `vehicles` holds them.
 *
 * ⚠ Every field is nullable and each null means something different — see
 * `describeNextService`. This is deliberately the raw row rather than a
 * pre-digested shape, so the null-handling has exactly one home.
 */
export interface StoredNextService {
  /** The headline service, worded by the knowledge base. Null when unswept. */
  label: string | null;
  /** The odometer reading it falls due at. Null on a purely time-driven service. */
  atMiles: number | null;
  /** `YYYY-MM-DD` it falls due. Null on a purely mileage-driven service. */
  dueOn: string | null;
}

export type NextServiceLine =
  | {
      kind: 'known';
      /** The service, as the knowledge base worded it. Never composed here. */
      service: string;
      /** When, in words. Never empty — see the note on timing above. */
      timing: string;
    }
  /**
   * We cannot say. **Not** "nothing is due" — the distinction this file exists
   * for. Callers render `UNKNOWN_TIMING` beside the row's permanent label.
   */
  | { kind: 'unknown' };

/**
 * The words for "we have no schedule for this car".
 *
 * Exported so the copy has one home and a test can assert the row without
 * duplicating the string. Matches `GarageBay`'s "No score yet" in form on
 * purpose.
 */
export const UNKNOWN_TIMING = 'No schedule yet';

/**
 * Turn the stored row into the line the card draws.
 *
 * `currentMileage` and `today` are passed rather than read, for the reason the
 * rest of this package does it: a function with a clock of its own cannot be
 * tested at a date that matters.
 *
 * ── Why staleness is not a case here, though the migration warns about it ───
 *
 * `next_service_at_miles` is an **absolute odometer reading**, not a distance,
 * so "in 420 mi" is recomputed against live mileage on every read. A sweep
 * that ran three days ago is still right about the reading the service falls
 * due at, and the countdown corrects itself as the car is driven. That is a
 * quiet virtue of storing the answer as a position rather than a remainder,
 * and it is worth stating because a remainder would have needed a fourth
 * column and a freshness rule.
 *
 * The staleness the migration does accept is different and real: a service
 * completed since the last sweep still shows as due. Vehicle detail computes
 * live from the schedule, and this row is a glance.
 */
export function describeNextService(
  stored: StoredNextService,
  currentMileage: number | null,
  today: string
): NextServiceLine {
  const service = (stored.label ?? '').trim();
  if (service === '') return { kind: 'unknown' };

  const timing = describeTiming(stored, currentMileage, today);
  // A named service with no "when" reads as "now". Better to say nothing than
  // to say that by accident.
  if (timing === null) return { kind: 'unknown' };

  return { kind: 'known', service, timing };
}

function describeTiming(
  stored: StoredNextService,
  currentMileage: number | null,
  today: string
): string | null {
  if (stored.atMiles !== null) {
    /*
      ⚠ No odometer is not zero miles. A car with no recorded mileage still has
      a service due at a known reading, and naming that reading is both true and
      useful — "at 70,000 mi" tells the owner exactly what to watch for. The
      alternative, treating a missing odometer as 0 and reporting "in 70,000
      mi", invents a car that has never been driven.
    */
    if (currentMileage === null) return `at ${formatMileage(stored.atMiles)} mi`;

    const remaining = stored.atMiles - currentMileage;

    // Zero is its own case, and it is not "in 0 mi".
    if (remaining === 0) return 'due now';
    if (remaining < 0) return `overdue by ${formatMileage(Math.abs(remaining))} mi`;

    return `in ${formatMileage(remaining)} mi`;
  }

  if (stored.dueOn !== null) {
    /*
      Compared as `YYYY-MM-DD` strings rather than `Date` objects. Both sides
      are calendar dates with no time and no zone; parsing them into `Date`
      makes them midnight UTC, which is the previous day for every owner west
      of Greenwich — and this row would then call a service overdue a day early
      for most of the product's users.
    */
    if (stored.dueOn < today) return `overdue since ${formatCalendarDate(stored.dueOn)}`;
    if (stored.dueOn === today) return 'due now';

    return `by ${formatCalendarDate(stored.dueOn)}`;
  }

  return null;
}

/**
 * Today, as the calendar day the reader is actually living in.
 *
 * ⚠ **Not `new Date().toISOString().slice(0, 10)`**, which is the idiom already
 * in this codebase and is wrong for half of every day. `toISOString` reports
 * **UTC**, so at 6pm in California it returns tomorrow's date — and this row
 * would call a service overdue a day early for every owner in the Americas,
 * every evening.
 *
 * The offset is applied before formatting rather than after, so the arithmetic
 * happens on the timestamp and the string is only ever read out.
 */
export function localToday(now: Date = new Date()): string {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

/**
 * Render a `YYYY-MM-DD` as the day it actually names.
 *
 * ⚠ **Not `formatDate`, and this is the same timezone trap as the comparison
 * above rather than a style preference.** `formatDate` does
 * `new Date('2026-03-12')`, which the spec parses as **midnight UTC**, and
 * `toLocaleDateString` then renders that in the reader's zone — "Mar 11" for
 * everyone west of Greenwich, which is most of this product's users. A row that
 * says a service is due the day before it is would be a small, constant,
 * unfalsifiable-looking wrongness.
 *
 * Splitting the parts and building a **local** date sidesteps it: the numbers
 * the string names are the numbers rendered, in any zone.
 *
 * ⚠ This is a narrow fix for this row. `formatDate` has the same flaw for every
 * date-only string in the product and that is a wider change than this file
 * should make on its way past.
 */
function formatCalendarDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  if (!year || !month || !day) return iso;

  return formatDate(new Date(year, month - 1, day));
}
