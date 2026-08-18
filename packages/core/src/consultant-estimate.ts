import { type AdviceRange, statesVerdict, widenToHonestSpread } from './advice-range';

/**
 * The structured estimate behind the advisor's estimate well.
 *
 * ── Why this exists at all ──────────────────────────────────────────────────
 *
 * Board screen 04 is the advisor, and its own summary line is *"Answers are
 * unboxed; **the estimate is a well**; provenance is a claim, never a badge."*
 * The drawn screen carries priced lines:
 *
 * > Fluid flush — $110 – $160
 * > Master cylinder, if needed — $380 – $520
 * > Most likely total — $110 – $160
 *
 * `POST /api/v1/consultant` returned prose and nothing else, so the well could
 * not be built and `Well` sat in the primitive kit with no caller. That is the
 * fourth API gap in `docs/step4-api-gaps.md`, found on 16 Aug after the first
 * three were written up.
 *
 * ── Why the numbers are asked for, not read back out of the prose ───────────
 *
 * Regexing "$110–$160" out of a sentence is the obvious shortcut and it is the
 * wrong one. It cannot tell a price from a part number, an estimate from a
 * figure the owner quoted in their own question, or a total from a line item —
 * and a mis-parsed dollar range rendered as a priced line item is exactly the
 * overclaim the provenance work exists to prevent. This codebase's standing
 * position is that it does not invent precision.
 *
 * So the model emits tags, on the pattern `consultant-commands.ts` already
 * established for wishlist and status write-backs, and this parses them.
 *
 * ── ⚠ Absent must mean absent ───────────────────────────────────────────────
 *
 * Most advisor answers are not quotes. A well that renders empty — or worse, at
 * $0 — on every non-pricing answer is a worse screen than no well at all, so
 * the estimate is **optional at every level**: no tags means no estimate, and a
 * tag whose numbers do not survive validation is dropped rather than repaired
 * into something plausible.
 */

export interface EstimateLine {
  label: string;
  range: AdviceRange;
}

export interface ConsultantEstimate {
  lines: EstimateLine[];
  /**
   * What the job most likely comes to — **not** the sum of the lines.
   *
   * ⚠ `docs/step4-api-gaps.md` §4 proposed this as required and as a total.
   * Building it changed both, and the board is the reason: its own example
   * prices two lines at $110–$160 and $380–$520 and then gives "Most likely
   * total" as **$110–$160**. The second line is "Master cylinder, *if needed*",
   * and the likely case is that it is not.
   *
   * Summing would therefore charge the owner for every contingency the advisor
   * was careful to mark as one — turning a considered answer into a worst case
   * and reporting it as the expected one. Only the model knows which lines are
   * conditional, so only the model can say this, and when it does not say it
   * the field is absent.
   */
  likely?: AdviceRange;
}

/**
 * `[ESTIMATE: label|low|high]`, one per priced line.
 *
 * The `:` is load-bearing — it is what keeps this from also matching
 * `[ESTIMATE_TOTAL:`, which would otherwise arrive as a line with the label
 * `TOTAL`.
 */
const LINE_TAG = /\[ESTIMATE:\s*([^|\]]+)\|([^|\]]+)\|([^\]]+)\]/g;

/** `[ESTIMATE_TOTAL: low|high]`, at most one. */
const TOTAL_TAG = /\[ESTIMATE_TOTAL:\s*([^|\]]+)\|([^\]]+)\]/g;

/**
 * Read a figure the model wrote for a human.
 *
 * `$1,250`, `1250`, ` 1250.00 ` all mean the same number and the model will
 * produce all three. Anything else — a range inside a field, a word, an empty
 * string — returns `null` and takes its line with it.
 *
 * ⚠ Negative and zero are rejected, not clamped. A zero-dollar line item is
 * either a parse failure or the model saying "free", and "free" rendered in a
 * priced well is a claim about a shop's pricing that nobody made.
 */
function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, '');
  if (cleaned === '') return null;

  const value = Number(cleaned);
  if (!Number.isFinite(value) || value <= 0) return null;

  return value;
}

/**
 * Turn two raw fields into a range that is honest about its own precision.
 *
 * `widenToHonestSpread` is applied **here, at the boundary**, rather than left
 * to the renderer. A range of $1,000–$1,010 is a verdict wearing a range's
 * clothes: it claims the answer is known to 1%, which no estimate from a
 * language model over an unseen job is. Widening at the edge means every reader
 * of a `ConsultantEstimate` — the well, a future summary, a test — gets the
 * same honest spread without having to remember to ask for it.
 */
function parseRange(rawLow: string, rawHigh: string): AdviceRange | null {
  const low = parseAmount(rawLow);
  const high = parseAmount(rawHigh);
  if (low === null || high === null) return null;

  return widenToHonestSpread({ low, high });
}

/**
 * Pull the estimate out of a model response, and return the prose without it.
 *
 * `cleaned` is returned on the same contract as the parsers in
 * `consultant-commands.ts`: the tags are stripped whether or not they parsed,
 * because a tag that failed validation must not survive into the chat bubble
 * as visible machinery. A dropped line is silent to the reader, which is the
 * point — the prose still says what the advisor meant.
 */
export function parseEstimate(response: string): {
  estimate?: ConsultantEstimate;
  cleaned: string;
} {
  const lines: EstimateLine[] = [];

  for (const match of matchAllOf(LINE_TAG, response)) {
    const label = match[1].trim();
    const range = parseRange(match[2], match[3]);

    if (label.length < 2 || range === null) continue;

    /*
      ⚠ The label is copy this product renders in its own voice, inside a
      styled well, next to a price — so it is held to the same rule as every
      other advice surface. `cc-design-0003` is deliberately written for *all*
      of them, and "Fluid flush (they're overcharging)" as a line item is the
      exact failure `statesVerdict` exists to catch: a statement about a named
      local business, made by a product with no entity behind it.

      The line is dropped rather than the whole estimate. One badly worded
      label should not cost the owner the other three prices.
    */
    if (statesVerdict(label)) continue;

    lines.push({ label, range });
  }

  let likely: AdviceRange | undefined;
  for (const match of matchAllOf(TOTAL_TAG, response)) {
    const range = parseRange(match[1], match[2]);
    // First one wins. A second total is the model contradicting itself, and
    // picking the later one would silently prefer whichever it wrote last.
    if (range !== null && likely === undefined) likely = range;
  }

  const cleaned = response
    .replace(/\[ESTIMATE:\s*[^\]]*\]/g, '')
    .replace(/\[ESTIMATE_TOTAL:\s*[^\]]*\]/g, '')
    /*
      Tags sit on their own line, so removing one leaves a blank line behind and
      a run of them leaves a gap in the middle of the answer. Collapse three or
      more newlines to a paragraph break rather than stripping all whitespace —
      the prose's own paragraphing is deliberate and worth keeping.
    */
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // ⚠ A total with no lines is not an estimate — it is a bare number in a well
  // with nothing explaining it, which is the point of the well.
  if (lines.length === 0) return { cleaned };

  return { estimate: { lines, ...(likely ? { likely } : {}) }, cleaned };
}

/**
 * `matchAll` without the downlevel-iteration requirement.
 *
 * ⚠ The web package's `tsconfig` targets below ES2015 iteration, so
 * `String.prototype.matchAll` fails the typecheck there even though it runs
 * fine. A fresh `RegExp` per call also avoids the `lastIndex` sharing that
 * makes a module-level `/g/` regex stateful across calls — the bug that would
 * make every second parse in a process return nothing.
 */
function matchAllOf(pattern: RegExp, input: string): RegExpExecArray[] {
  const regex = new RegExp(pattern.source, pattern.flags);
  const found: RegExpExecArray[] = [];

  let match: RegExpExecArray | null = regex.exec(input);
  while (match !== null) {
    found.push(match);
    match = regex.exec(input);
  }

  return found;
}
