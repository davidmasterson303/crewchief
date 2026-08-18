/**
 * What it takes to mark a wishlist item done, and what the record will say.
 *
 * Pure — no clock of its own, no network. The caller supplies `today`.
 *
 * ── Why this is not just a form ─────────────────────────────────────────────
 *
 * Completing an item is the only action in the wishlist that **writes into the
 * car's permanent history**: `POST /api/v1/wishlist/complete` inserts a
 * `maintenance_line_items` row and deletes the wishlist entry. There is no undo
 * and the row is what the advisor, the health score and the service schedule
 * all read afterwards.
 *
 * That route is forgiving about what it is given — a missing shop becomes
 * `'Unknown'`, missing costs become `0`, a missing date becomes today. Forgiving
 * is right for a route and wrong for a form: submitted empty, it writes a row
 * that *looks* like a maintenance record and carries no information. This
 * project already has a name for that shape — a UI implying data it does not
 * have — and `enrichVehicle`'s docblock calls it "the §21 provenance problem in
 * a new costume."
 *
 * So the rule below asks for the one fact that makes the row worth having, and
 * refuses to invent the rest.
 */

export interface CompletionDraft {
  /** True when the owner did the work themselves. */
  isDIY: boolean;
  /** Who did it, when `isDIY` is false. */
  shopName: string;
  /** Free text; both are optional because a cost is often not known yet. */
  partsCost: string;
  laborCost: string;
  /** ISO date (`YYYY-MM-DD`). */
  serviceDate: string;
}

export interface CompletionProblem {
  field: 'shopName' | 'serviceDate' | 'partsCost' | 'laborCost';
  message: string;
}

/** A blank draft, dated today. */
export function emptyCompletion(today: string): CompletionDraft {
  return { isDIY: false, shopName: '', partsCost: '', laborCost: '', serviceDate: today };
}

/**
 * Whether this draft may be submitted, and what is wrong if not.
 *
 * ── The one required field, and why it is *who* rather than *how much* ───────
 *
 * **Who did the work is required. Cost is not.**
 *
 * Cost is genuinely often unknown at the moment a job finishes — the invoice
 * arrives later, or the parts were bought over three weeks. Requiring it would
 * push people to type a number they are guessing at, and a guessed cost in
 * permanent history is worse than an absent one, because nothing downstream can
 * tell them apart.
 *
 * Who did it is known the instant it is done, is one tap for the DIY case, and
 * is the field that makes the row legible a year later. Without it the record
 * reads "Unknown", which is the route's default and tells the reader nothing
 * about whether it happened at all.
 */
export function completionProblems(
  draft: CompletionDraft,
  today: string
): CompletionProblem[] {
  const problems: CompletionProblem[] = [];

  if (!draft.isDIY && draft.shopName.trim().length === 0) {
    problems.push({ field: 'shopName', message: 'Say who did the work, or mark it as DIY.' });
  }

  const day = draft.serviceDate.slice(0, 10);
  const parsed = Date.parse(`${day}T00:00:00Z`);

  if (Number.isNaN(parsed)) {
    problems.push({ field: 'serviceDate', message: 'That is not a date.' });
  } else if (day > today.slice(0, 10)) {
    /*
      A future service date is refused rather than clamped. The schedule reads
      these rows to work out when a service is next due, so a date in the future
      silently pushes the next interval out — the car looks freshly serviced and
      the reminder never fires. Clamping to today would hide a typo that the
      person could have corrected.
    */
    problems.push({ field: 'serviceDate', message: 'That date has not happened yet.' });
  }

  for (const [field, raw] of [
    ['partsCost', draft.partsCost],
    ['laborCost', draft.laborCost],
  ] as const) {
    if (raw.trim().length === 0) continue;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) {
      problems.push({ field, message: 'Enter a number, or leave it blank.' });
    }
  }

  return problems;
}

/** A blank cost stays blank rather than becoming a claimed zero. */
export function parseCost(raw: string): number | undefined {
  if (raw.trim().length === 0) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

export interface CompletionPayload {
  itemId: string;
  serviceDate: string;
  isDIY: boolean;
  shopName?: string;
  partsCost?: number;
  laborCost?: number;
}

/**
 * The body to send, with absent facts left absent.
 *
 * ⚠ **A blank cost is omitted, not sent as `0`.** The route reads `partsCost ||
 * 0`, so either way the stored column ends up `0` — but the two mean different
 * things to every future reader of this code, and sending an explicit zero is a
 * claim that the job was free. Omission says "not recorded", which is true.
 *
 * `shopName` is omitted for DIY because the route sets `'DIY'` itself, and
 * sending both would let the two disagree.
 */
export function completionPayload(itemId: string, draft: CompletionDraft): CompletionPayload {
  const parts = parseCost(draft.partsCost);
  const labor = parseCost(draft.laborCost);

  return {
    itemId,
    serviceDate: draft.serviceDate.slice(0, 10),
    isDIY: draft.isDIY,
    ...(draft.isDIY ? {} : { shopName: draft.shopName.trim() }),
    ...(parts === undefined ? {} : { partsCost: parts }),
    ...(labor === undefined ? {} : { laborCost: labor }),
  };
}

/**
 * One line describing what will be written, shown before the user commits.
 *
 * The action is irreversible and its result lands somewhere the user is not
 * looking — the service history, not this screen. Naming the destination is
 * what makes "Done" an informed tap rather than a hopeful one.
 */
export function describeCompletion(itemName: string, draft: CompletionDraft): string {
  const who = draft.isDIY ? 'you' : draft.shopName.trim() || 'a shop';
  const parts = parseCost(draft.partsCost) ?? 0;
  const labor = parseCost(draft.laborCost) ?? 0;
  const total = parts + labor;

  const cost = total > 0 ? ` for ${formatWhole(total)}` : '';

  return `“${itemName}” goes into this car's service history as done by ${who}${cost}, and leaves the wishlist.`;
}

/** Whole pounds/dollars, no decimals — this is a summary, not an invoice. */
function formatWhole(value: number): string {
  return `$${Math.round(value).toLocaleString('en-US')}`;
}
