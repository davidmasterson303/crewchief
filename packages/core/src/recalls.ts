/**
 * A recall notice, turned into something an owner can act on.
 *
 * ── Why this is not just field renaming ─────────────────────────────────────
 *
 * NHTSA writes for a regulator. "FMVSS 111 rear visibility" and a
 * 400-word summary of a remedy procedure are the record, not the answer, and
 * the one thing this product does that a recall lookup does not is turn the
 * first into the second.
 *
 * ── Two flags that change what the notification is ──────────────────────────
 *
 * `parkIt` and `parkOutSide` are the reason this module exists rather than a
 * mapping function. They are NHTSA's own escalation:
 *
 *   - **`parkIt`** — do not drive the vehicle. Not "book an appointment".
 *   - **`parkOutSide`** — fire risk while parked; keep it away from structures.
 *
 * A recall carrying either is not a maintenance reminder, and rendering it in
 * the same tone as a rear-view-camera notice is the product failing at the one
 * moment it matters most. `severityOf` is what keeps them from being flattened
 * into the list.
 *
 * ── The stored data is poorer than the API, and that is load-bearing ────────
 *
 * The live `nhtsa_data.recalls` rows carry five fields — `Summary`,
 * `Component`, `Consequence`, `ReportReceivedDate`, `NHTSACampaignNumber` — and
 * **no `Remedy`**, because the seeded demo rows were written by hand as a
 * subset. The API returns `Remedy`, `Notes`, `Manufacturer` and the two flags
 * above as well, so a fresh fetch is richer than anything stored today.
 *
 * Every field here is therefore optional and every consumer has to cope with
 * absence. A "How it gets fixed" section rendered empty because the row predates
 * the field is worse than no section: it reads as "nobody knows how to fix
 * this". `hasRemedy` exists so a screen can ask before it draws.
 */

export type RecallSeverity = 'do-not-drive' | 'park-outside' | 'standard';

/** One recall, normalised. Every field optional — see the header. */
export interface NormalisedRecall {
  campaignNumber: string | null;
  component: string | null;
  summary: string | null;
  consequence: string | null;
  remedy: string | null;
  notes: string | null;
  manufacturer: string | null;
  /** ISO `YYYY-MM-DD`, or null when unparseable. */
  reportedOn: string | null;
  severity: RecallSeverity;
}

/**
 * NHTSA's booleans arrive as real booleans from the API and as the strings
 * `"true"`/`"false"` from some stored payloads. Both are treated as truthy
 * only when they genuinely mean yes — a bare `"false"` string is truthy in
 * JavaScript, which is precisely how a "do not drive" flag would end up on
 * every recall in the list.
 */
function flag(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.trim().toLowerCase() === 'true';
  return false;
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * ── ⚠ NHTSA sends **both** date orders, and the stored data holds both ──────
 *
 * This function read every `d/d/YYYY` as `MM/DD/YYYY`. On 23 Aug the M235i's
 * recall card rendered **`Issued 2025-17-12`** — there is no month 17 — from a
 * stored `ReportReceivedDate` of `17/12/2025`.
 *
 * Counted across the live `nhtsa_data` rows, 29 recall dates in `d/d/YYYY`
 * form: **17 can only be day-first** (`24/04/2024`, `27/06/2019`), **3 can only
 * be month-first** (`06/15/2020`, `09/22/2021`), and **9 are ambiguous** —
 * both fields under 13, readable either way and identical in shape. So this is
 * not one wrong assumption to flip; the corpus genuinely contains two formats,
 * and a fixed reading is wrong for a fifth of it whichever one is picked.
 *
 * ── The order is inferred per batch, and refused when it cannot be ──────────
 *
 * Every recall for a vehicle arrives in one API response, so they share a
 * format. `inferDateOrder` looks for **any** record in the batch with a field
 * above 12 and applies that reading to all of them — which resolves both real
 * cars in the database today.
 *
 * When nothing in the batch disambiguates, this returns `null`. That is §10:
 * a date we cannot read is "we cannot say", not a coin-flip rendered with the
 * confidence of a fact. A missing "Issued" line costs an owner nothing; a
 * transposed one tells them a 2019 campaign was issued last month.
 *
 * ⚠ The result is **validated** as well as parsed. `2025-17-12` was a string
 * this function built and handed on, and every layer after it rendered it
 * faithfully. Nothing downstream can catch a month of 17; this is where it has
 * to be caught.
 */
export type RecallDateOrder = 'day-first' | 'month-first' | 'unknown';

const SLASHED = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

/**
 * Which way a batch of NHTSA dates reads, decided by the ones that can only
 * read one way.
 *
 * ⚠ Disagreement inside a batch resolves to `unknown` rather than to a
 * majority. Two formats in one response means the assumption that a response
 * has *a* format is wrong, and voting on it would produce a confident answer
 * from evidence that has already contradicted itself.
 */
export function inferDateOrder(values: readonly unknown[]): RecallDateOrder {
  let dayFirst = false;
  let monthFirst = false;

  for (const value of values) {
    const match = text(value)?.match(SLASHED);
    if (!match) continue;

    const [, first, second] = match;
    if (Number(first) > 12) dayFirst = true;
    if (Number(second) > 12) monthFirst = true;
  }

  if (dayFirst && monthFirst) return 'unknown';
  if (dayFirst) return 'day-first';
  if (monthFirst) return 'month-first';

  return 'unknown';
}

export function parseRecallDate(
  value: unknown,
  order: RecallDateOrder = 'unknown'
): string | null {
  const raw = text(value);
  if (!raw) return null;

  const match = raw.match(SLASHED);
  if (match) {
    const [, first, second, year] = match;

    /*
      A record can disambiguate itself even when its batch could not: a 17 in
      either position rules that position out as a month. The batch's answer is
      only consulted when this one has nothing to say.
    */
    const self =
      Number(first) > 12 ? 'day-first' : Number(second) > 12 ? 'month-first' : order;
    if (self === 'unknown') return null;

    const [day, month] = self === 'day-first' ? [first, second] : [second, first];
    return isoDate(year, month, day);
  }

  // Already ISO, or something we should not guess at.
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? validIso(raw.slice(0, 10)) : null;
}

/** `YYYY-MM-DD`, or null if those numbers are not a date. */
function isoDate(year: string, month: string, day: string): string | null {
  return validIso(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
}

/**
 * ⚠ Round-tripped, not range-checked. `2025-02-31` passes every bound and is
 * not a day; building the date and reading it back is the only check that
 * catches it, and it is the check that would have stopped `2025-17-12` leaving
 * this file.
 */
function validIso(iso: string): string | null {
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;

  return parsed.toISOString().slice(0, 10) === iso ? iso : null;
}

export function severityOf(raw: Record<string, unknown>): RecallSeverity {
  if (flag(raw.parkIt)) return 'do-not-drive';
  if (flag(raw.parkOutSide)) return 'park-outside';
  return 'standard';
}

/** One raw NHTSA record → the shape a screen can render. */
export function normaliseRecall(
  raw: unknown,
  /** The batch's date order — see `normaliseRecalls`. */
  order: RecallDateOrder = 'unknown'
): NormalisedRecall | null {
  if (typeof raw !== 'object' || raw === null) return null;

  const record = raw as Record<string, unknown>;

  const normalised: NormalisedRecall = {
    campaignNumber: text(record.NHTSACampaignNumber) ?? text(record.campaign_number),
    component: text(record.Component) ?? text(record.component),
    // `description` is the older stored spelling; `app/actions.ts` already
    // reads both, and dropping one would empty the demo cars' recall list.
    summary: text(record.Summary) ?? text(record.summary) ?? text(record.description),
    consequence: text(record.Consequence) ?? text(record.consequence),
    remedy: text(record.Remedy) ?? text(record.remedy),
    notes: text(record.Notes) ?? text(record.notes),
    manufacturer: text(record.Manufacturer) ?? text(record.manufacturer),
    reportedOn: parseRecallDate(record.ReportReceivedDate ?? record.date, order),
    severity: severityOf(record),
  };

  /*
    A record with nothing to say is dropped. An entry rendering as a blank card
    with a campaign number is not information, and the recall list is one place
    where padding the count is actively harmful — "3 open recalls" should mean
    three things worth reading.
  */
  if (!normalised.summary && !normalised.component) return null;

  return normalised;
}

const SEVERITY_ORDER: Record<RecallSeverity, number> = {
  'do-not-drive': 0,
  'park-outside': 1,
  standard: 2,
};

/**
 * Every recall on a vehicle, most urgent first, then most recent.
 *
 * **Severity outranks recency, always.** A two-year-old "do not drive" notice
 * is more urgent than last month's trim-clip recall, and sorting by date alone
 * buries it — which is the one ordering mistake this list can make that gets
 * someone hurt.
 */
export function normaliseRecalls(raw: unknown): NormalisedRecall[] {
  if (!Array.isArray(raw)) return [];

  /*
    ⚠ The date order is decided over the **whole batch** before any record is
    normalised — see `inferDateOrder`. One vehicle's recalls arrive in one API
    response and share a format, so a record whose own fields are ambiguous
    (`06/03/2019`) is read correctly as long as a sibling is not
    (`24/04/2024`). Normalising each record in isolation is what left nine of
    twenty-nine dates unreadable.
  */
  const order = inferDateOrder(
    raw.map((entry) =>
      typeof entry === 'object' && entry !== null
        ? ((entry as Record<string, unknown>).ReportReceivedDate ??
          (entry as Record<string, unknown>).date)
        : null
    )
  );

  return raw
    .map((entry) => normaliseRecall(entry, order))
    .filter((recall): recall is NormalisedRecall => recall !== null)
    .sort(
      (a, b) =>
        SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
        (b.reportedOn ?? '').localeCompare(a.reportedOn ?? '')
    );
}

/**
 * Can a screen draw a "How it gets fixed" section for this recall?
 *
 * Asked rather than assumed, because the stored rows predate the field. An
 * empty remedy section reads as "nobody knows how to fix this", which is a
 * worse claim than saying nothing.
 */
export function hasRemedy(recall: NormalisedRecall): boolean {
  return recall.remedy !== null;
}

/**
 * The most severe thing true of this vehicle's recalls.
 *
 * What the garage card and the notification lead with. `null` when there are
 * none — a car with no recalls should render nothing rather than a reassuring
 * badge, which is a claim about NHTSA's completeness that we cannot make.
 */
export function worstSeverity(recalls: NormalisedRecall[]): RecallSeverity | null {
  if (recalls.length === 0) return null;

  return recalls.reduce<RecallSeverity>(
    (worst, recall) => (SEVERITY_ORDER[recall.severity] < SEVERITY_ORDER[worst] ? recall.severity : worst),
    'standard'
  );
}

/**
 * ── ⚠ `AIR BAGS:SIDE/WINDOW:HEAD` is a database enum, not a sentence ────────
 *
 * **R28.** That string was the recall card's **title**, in caps, colon-
 * delimited — and again in the vehicle hub's red banner as *"Worst: AIR
 * BAGS:SIDE/WINDOW:HEAD"*. It is NHTSA's internal component taxonomy, shown
 * verbatim to an owner on the most serious screen in the product.
 *
 * ── Why a map rather than a prettifier ─────────────────────────────────────
 *
 * The taxonomy is a colon-delimited hierarchy: system first, then narrowing
 * qualifiers. The **system** is a closed vocabulary and worth naming properly
 * — `FUEL SYSTEM, GASOLINE` is "Fuel system", not "Fuel system, gasoline". The
 * qualifiers are open-ended and are only lower-cased and joined, because
 * rewriting them means guessing at strings this codebase has never seen.
 *
 * Every entry in `SYSTEMS` below was read off the live `nhtsa_data` rows on
 * 23 Aug plus the common families those rows do not happen to contain. A system
 * that is not in the map falls back to sentence case, which is plain, always
 * correct, and never a database enum.
 *
 * ⚠ **The raw string is not thrown away.** It is what a dealer's service desk
 * will recognise, so a screen showing this must keep the original as
 * provenance-grade metadata beside the campaign number — `RecallDetailScreen`
 * does. This function renames the headline; it does not delete the record.
 */
const SYSTEMS: Record<string, string> = {
  'AIR BAGS': 'Airbags',
  'ELECTRICAL SYSTEM': 'Electrical system',
  'ENGINE AND ENGINE COOLING': 'Engine and cooling',
  'EQUIPMENT': 'Equipment',
  'EXTERIOR LIGHTING': 'Exterior lights',
  'FUEL SYSTEM, GASOLINE': 'Fuel system',
  'FUEL SYSTEM, DIESEL': 'Fuel system',
  'INTERIOR LIGHTING': 'Interior lights',
  'LATCHES/LOCKS/LINKAGES': 'Latches and locks',
  'PARKING BRAKE': 'Parking brake',
  'POWER TRAIN': 'Drivetrain',
  'SEAT BELTS': 'Seat belts',
  'SEATS': 'Seats',
  'SERVICE BRAKES': 'Brakes',
  'SERVICE BRAKES, HYDRAULIC': 'Brakes',
  'STEERING': 'Steering',
  'STRUCTURE': 'Body structure',
  'SUSPENSION': 'Suspension',
  'TIRES': 'Tires',
  'TRAILER HITCHES': 'Trailer hitch',
  'VEHICLE SPEED CONTROL': 'Throttle and cruise control',
  'VISIBILITY': 'Visibility',
  'WHEELS': 'Wheels',
};

/** `FOO BAR` → `Foo bar`. For a system the map has never seen. */
function sentenceCase(value: string): string {
  const lower = value.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export function componentPlainName(
  raw: string | null | undefined,
  /**
   * `short` drops the qualifiers and names the system alone.
   *
   * For the hub banner, which is one line carrying a severity, a component and
   * an instruction — *"Airbags — free to fix at a franchised dealer"*. The full
   * form belongs on the card, where there is room for it.
   */
  { short = false }: { short?: boolean } = {}
): string | null {
  const value = (raw ?? '').trim();
  if (!value) return null;

  const [system, ...rest] = value.split(':').map((part) => part.trim()).filter(Boolean);
  if (!system) return null;

  const named = SYSTEMS[system.toUpperCase()] ?? sentenceCase(system);
  if (short || rest.length === 0) return named;

  return `${named} — ${rest.join(', ').toLowerCase()}`;
}
