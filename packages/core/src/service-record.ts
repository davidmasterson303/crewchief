/**
 * What one row of a car's service history claims, and on whose word.
 *
 * Pure. Shared, because the phone and the web render the same rows and a second
 * spelling of "where did this come from" is exactly the drift
 * `service-provenance.ts` was written to end.
 *
 * ── Why a row needs a provenance label at all ───────────────────────────────
 *
 * `maintenance_line_items.source` distinguishes an invoice from a recollection,
 * and `20260808150000` argued the case: *"An invoice is evidence. 'I think it
 * was around 85,000' is a recollection, offered on a sign-up screen by someone
 * who wants to finish sign-up."*
 *
 * That distinction already governs what the *schedule* may claim. A history
 * list is where it becomes visible: four rows in one column, identical in
 * weight, are read as four equally solid facts. One of them may be a memory.
 *
 * ── This is deliberately not `SERVICE_BASIS_LABELS` ─────────────────────────
 *
 * Those answer "what did we compute this due date from" and are phrased as
 * conclusions — "From your service records". These answer "where did this row
 * come from" and are phrased as attributions. Same underlying `source`, two
 * different sentences, and folding them would make one of the two wrong.
 */

/** The values `maintenance_line_items_source_check` permits, plus absence. */
export type RecordSource = 'vision' | 'manual' | 'seed' | 'owner-onboarding' | null;

/**
 * How each source is described to the owner.
 *
 * Short, because these sit under a service name in a list and a sentence there
 * competes with the thing it is annotating.
 */
export const RECORD_SOURCE_LABELS: Record<Exclude<RecordSource, null>, string> = {
  /*
    "Read from an invoice" rather than "Scanned": the claim is about where the
    figures came from, and a scan that produced nothing would still have been
    a scan. This wording is also honest about the weak link — a model read it,
    and the number in the column is the model's account of the document.
  */
  vision: 'Read from an invoice you uploaded',
  manual: 'Added in the app',
  /*
    Demo data. It appears only on the seeded vehicles, and saying so plainly is
    better than letting a recruiter-facing garage present fiction as record.
  */
  seed: 'Example data',
  // Quoted because of the hyphen, and the value is the schema's own — see
  // `20260808150000`, which introduced it rather than reusing `'manual'`
  // precisely so this sentence could be different from the one above.
  'owner-onboarding': 'What you told us at sign-up',
};

/**
 * The label for a row, or `null` when there is nothing honest to say.
 *
 * A missing `source` returns `null` rather than a guess. Rows predate the
 * column — `20260801120000` added it — so an unattributed row is *old*, not
 * suspicious, and inventing an attribution for it would be the exact failure
 * the column exists to prevent.
 */
export function recordSourceLabel(source: string | null | undefined): string | null {
  if (source === null || source === undefined) return null;
  return Object.prototype.hasOwnProperty.call(RECORD_SOURCE_LABELS, source)
    ? RECORD_SOURCE_LABELS[source as Exclude<RecordSource, null>]
    : null;
}

/**
 * Whether a row is a record or a recollection.
 *
 * The one distinction worth carrying into the UI beyond the label itself: a
 * recollection may deserve a quieter treatment, and `owner-onboarding` is the
 * only source that is one.
 */
export function isRecollection(source: string | null | undefined): boolean {
  return source === 'owner-onboarding';
}

export interface ServiceRecord {
  id?: string;
  item_description?: string | null;
  service_date?: string | null;
  shop_name?: string | null;
  total_cost?: number | null;
  mileage_at_service?: number | null;
  source?: string | null;
  /**
   * True when invoice extraction merged a labour line with its matching parts
   * lines into this one record. Not half of a pair — there is nothing to
   * orphan — but the row covers more than its description says.
   */
  is_combined?: boolean | null;
  /** The scanned document this was read from, if any. Survives a removal. */
  source_document_id?: string | null;
}

/**
 * The line under a service name: when, at what mileage, and by whom.
 *
 * Absent facts are omitted rather than filled. `shop_name` in particular
 * defaults to `'Unknown'` at the route when a completion did not name one, and
 * printing "Unknown" in a history list is worse than printing nothing — it
 * reads as a fact about the shop rather than as an absence of one.
 */
export function describeRecord(record: ServiceRecord): string {
  const parts: string[] = [];

  const date = formatRecordDate(record.service_date);
  if (date) parts.push(date);

  const mileage = record.mileage_at_service;
  if (typeof mileage === 'number' && Number.isFinite(mileage) && mileage > 0) {
    parts.push(`${mileage.toLocaleString('en-US')} miles`);
  }

  const shop = (record.shop_name ?? '').trim();
  if (shop && shop.toLowerCase() !== 'unknown') parts.push(shop);

  return parts.join(' · ');
}

/** `2026-08-02` → `2 Aug 2026`. Returns null rather than echoing bad input. */
export function formatRecordDate(value: string | null | undefined): string | null {
  if (!value) return null;

  const day = value.slice(0, 10);
  const parsed = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(parsed)) return null;

  const date = new Date(parsed);
  const month = date.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
  return `${date.getUTCDate()} ${month} ${date.getUTCFullYear()}`;
}

/**
 * What removing one record actually costs, said before it happens.
 *
 * ── Why this is not "are you sure?" ─────────────────────────────────────────
 *
 * Deleting a service record is irreversible and the consequences are not
 * obvious from the row. Three things are worth saying and none of them is
 * visible on the card:
 *
 * **The invoice survives.** `delete-maintenance-item` removes the line from
 * `maintenance_line_items` and does not touch `vehicle_documents`, so the
 * scanned document stays and the row can be recreated by re-scanning. That is
 * the difference between a correction and a loss, and someone deciding needs it.
 *
 * **A combined row is more than its title.** Invoice extraction merges a labour
 * line with its matching parts lines into one record (`app/actions.ts:2890`),
 * so "Front brake pads & rotors, replace" at £678 may be labour *and* three
 * parts lines. Removing it removes all of them.
 *
 * **The schedule reads these rows.** A service's next due date is counted from
 * the last record of it, so removing the only record of a job makes that
 * service look never-done — which is the right answer if it never happened and
 * a wrong one if the row was merely inaccurate.
 */
export function describeRemoval(record: ServiceRecord): string {
  const parts: string[] = [];

  if (record.source === 'vision' && record.source_document_id) {
    parts.push('The invoice it came from stays, so this can be scanned again.');
  }

  if (record.is_combined) {
    parts.push('This row covers labour and its parts together — all of it goes.');
  }

  parts.push('Anything due is worked out from these records, so removing it may change a due date.');

  return parts.join(' ');
}

/**
 * What the whole history cost, for the rows that say.
 *
 * Rows without a cost are skipped rather than counted as zero, and the count of
 * what was included is returned alongside — a total over four of nine rows is a
 * different number from a total over nine, and a figure presented without that
 * distinction invites someone to read it as the second.
 */
export function totalRecorded(records: ServiceRecord[]): { total: number; counted: number } {
  let total = 0;
  let counted = 0;

  for (const record of records) {
    const cost = record.total_cost;
    if (typeof cost === 'number' && Number.isFinite(cost) && cost > 0) {
      total += cost;
      counted += 1;
    }
  }

  return { total, counted };
}
