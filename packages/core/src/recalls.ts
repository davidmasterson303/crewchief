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
 * NHTSA dates arrive as `MM/DD/YYYY`.
 *
 * Parsed rather than passed through, because `new Date("06/15/2020")` is
 * locale-dependent in exactly the way that turns 6 June into 15 June without
 * anyone noticing — and a recall's date is how the list is ordered.
 */
export function parseRecallDate(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;

  const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    const [, month, day, year] = match;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  // Already ISO, or something we should not guess at.
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : null;
}

export function severityOf(raw: Record<string, unknown>): RecallSeverity {
  if (flag(raw.parkIt)) return 'do-not-drive';
  if (flag(raw.parkOutSide)) return 'park-outside';
  return 'standard';
}

/** One raw NHTSA record → the shape a screen can render. */
export function normaliseRecall(raw: unknown): NormalisedRecall | null {
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
    reportedOn: parseRecallDate(record.ReportReceivedDate ?? record.date),
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

  return raw
    .map(normaliseRecall)
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
