/**
 * Turning stored service history into the three lookups `evaluateSchedule`
 * asks for.
 *
 * Track A2a's consuming half. `evaluateSchedule` has accepted
 * `lastServiceMileage`, `lastServiceDate` and (since the data model landed)
 * `lastServiceEvidence` from the start — and **nothing has ever supplied
 * them**. `ServiceMilestoneScreen` calls it with none, which is why every
 * time-based service on that screen reports `unknown` and every mileage-based
 * one falls back to the next boundary above the odometer.
 *
 * This is the missing adapter. It is deliberately pure: rows in, closures out,
 * no IO, no client, no table names. Both apps can call it and a test can drive
 * it with four literals.
 *
 * ── Why not `syncCategoryFromHistory` ───────────────────────────────────────
 *
 * `maintenance-sync.ts` already matches history to categories and was the
 * obvious thing to reuse. Two reasons it cannot be, and the second is a
 * correctness problem rather than a preference:
 *
 * 1. **It matches the ten fixed keys of `CATEGORY_KEYWORD_MAP`.** The schedule
 *    this feeds is model-generated per vehicle — "Engine oil and filter",
 *    "Brake fluid replacement" — and those strings are not those keys. It needs
 *    to match in both directions, which is what `categoryFor` below does.
 *
 * 2. **`const mileage = getItemMileage(best) || currentMileage`.** When a row
 *    records no mileage, it reports the *current* odometer as the service
 *    mileage — that is, "this was done just now". Defensible for a category
 *    card that is showing you what it found; catastrophic here, because
 *    `nextDueMileage` would take it as a baseline and push every service a full
 *    interval into the future. A car with one undated receipt would report
 *    nothing due, forever.
 *
 * So an unrecorded mileage returns `null` here — "we do not know" — and
 * `evaluateSchedule` already has a well-defined behaviour for that.
 *
 * ── Matching through a shared category ──────────────────────────────────────
 *
 * A schedule entry and a history row are compared by mapping *both* onto the
 * same category vocabulary, rather than by comparing their free text to each
 * other. "Engine oil and filter" and "Oil change — Motul 5W-30, OEM filter"
 * share no useful substring; they both map to `Oil Change`.
 *
 * The longest matching keyword wins, which is what keeps "brake fluid
 * replacement" out of `Brake Inspection`. Substring matching on short tokens is
 * how "brake" would have matched everything.
 */

import { getKeywordsForCategory } from './maintenance-sync';
import type { ServiceEvidence } from './service-provenance';

/**
 * A `maintenance_line_items` row, as much of one as this needs.
 *
 * Loosely typed on purpose: the mobile client reads these off a JSON response
 * where every field is genuinely `unknown` whatever the route's type says, and
 * a strict interface here would be a claim about data that has crossed a
 * network.
 */
export interface ServiceHistoryRow {
  item_description?: string | null;
  description?: string | null;
  service_date?: string | null;
  mileage_at_service?: number | null;
  source?: string | null;
}

export interface HistoryLookups {
  lastServiceMileage: (service: string) => number | null;
  lastServiceDate: (service: string) => string | null;
  lastServiceEvidence: (service: string) => ServiceEvidence;
}

/**
 * Every category the keyword map knows.
 *
 * Listed rather than derived because `CATEGORY_KEYWORD_MAP` is not exported —
 * only `getKeywordsForCategory` is. Pinned by a test against that function, so
 * a category added there without being added here fails rather than silently
 * going unmatched.
 */
export const MATCHABLE_CATEGORIES = [
  'Oil Change',
  'Tire Rotation',
  'Air Filter',
  'Cabin Air Filter',
  'Brake Inspection',
  'Spark Plugs',
  'Transmission Fluid',
  'Coolant Flush',
  'Brake Fluid',
  'Timing Belt',
] as const;

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Which category a free-text service description belongs to, or `null`.
 *
 * **Longest keyword wins.** `Brake Fluid` and `Brake Inspection` both describe
 * brakes, and a first-match-wins loop would assign "brake fluid flush" to
 * whichever category happened to be declared first — a bug that depends on
 * object key order, which is exactly the kind that survives review.
 */
export function categoryFor(description: string): string | null {
  const text = normalise(description);
  if (!text) return null;

  let best: { category: string; length: number } | null = null;

  for (const category of MATCHABLE_CATEGORIES) {
    for (const keyword of getKeywordsForCategory(category)) {
      if (!text.includes(keyword)) continue;
      if (best === null || keyword.length > best.length) {
        best = { category, length: keyword.length };
      }
    }
  }

  return best?.category ?? null;
}

/**
 * A row's evidence kind, from the column that records it.
 *
 * Only `'owner-onboarding'` is demoted. Everything else — `vision`, `manual`,
 * `seed`, and the `NULL` that every row written before `20260801120000`
 * carries — counts as a record, because each of those is a thing that was
 * written down at the time rather than recalled later.
 *
 * The `NULL` case is a deliberate, documented over-claim. That migration's own
 * note says unprovenanced rows cannot be distinguished from vision-extracted
 * ones and refuses to guess; treating them as records keeps the pre-existing
 * behaviour rather than silently reclassifying months of real history the day
 * A2a shipped.
 */
function evidenceFor(source: string | null | undefined): ServiceEvidence {
  return source === 'owner-onboarding' ? 'owner-reported' : 'records';
}

function textOf(row: ServiceHistoryRow): string {
  return row.item_description || row.description || '';
}

function mileageOf(row: ServiceHistoryRow): number | null {
  const value = row.mileage_at_service;
  // Not `|| null`: a genuine 0 is a legitimate reading on a new car, and a
  // truthiness test would discard it as missing.
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function dateOf(row: ServiceHistoryRow): string | null {
  return row.service_date || null;
}

/**
 * Build the lookups for one vehicle's history.
 *
 * Grouped once up front rather than scanned per service: `evaluateSchedule`
 * calls each lookup for every entry in the schedule, so a naive implementation
 * is O(services x rows x keywords) on a screen a push notification opens.
 */
export function historyLookups(rows: ServiceHistoryRow[]): HistoryLookups {
  const byCategory = new Map<string, ServiceHistoryRow>();

  for (const row of rows) {
    const category = categoryFor(textOf(row));
    if (category === null) continue;

    const held = byCategory.get(category);
    if (held === undefined || isMoreRecent(row, held)) {
      byCategory.set(category, row);
    }
  }

  const rowFor = (service: string): ServiceHistoryRow | null => {
    const category = categoryFor(service);
    return category === null ? null : byCategory.get(category) ?? null;
  };

  return {
    lastServiceMileage: (service) => {
      const row = rowFor(service);
      return row === null ? null : mileageOf(row);
    },
    lastServiceDate: (service) => {
      const row = rowFor(service);
      return row === null ? null : dateOf(row);
    },
    lastServiceEvidence: (service) => {
      const row = rowFor(service);
      return row === null ? null : evidenceFor(row.source);
    },
  };
}

/**
 * Which of two rows describes the more recent work.
 *
 * Date first, because a date is what an invoice always carries and a mileage
 * often is not. Mileage breaks a tie or stands in when neither has a date —
 * an odometer is monotonic, so a higher reading is later by definition.
 *
 * A row with neither never wins, which matters: an undated, unmetered receipt
 * would otherwise be able to displace a fully recorded service and take its
 * baseline with it.
 */
function isMoreRecent(candidate: ServiceHistoryRow, held: ServiceHistoryRow): boolean {
  const candidateDate = dateOf(candidate);
  const heldDate = dateOf(held);

  if (candidateDate !== null && heldDate !== null) {
    if (candidateDate !== heldDate) return candidateDate > heldDate;
  } else if (candidateDate !== null) {
    return true;
  } else if (heldDate !== null) {
    return false;
  }

  const candidateMiles = mileageOf(candidate);
  const heldMiles = mileageOf(held);

  if (candidateMiles === null) return false;
  if (heldMiles === null) return true;
  return candidateMiles > heldMiles;
}
