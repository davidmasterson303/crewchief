import { formatCurrency } from './formatting-utils';

/**
 * Answers as ranges, never verdicts.
 *
 * Advisory item **B3**, scored **7.8** — the highest in the 2 Aug matrix, and
 * the only one business, marketing and design all rated ≥ 8 *for different
 * reasons*. Staged in the knowledge base as `cc-design-0003`.
 *
 * ── What this is actually for, and it is three things at once ───────────────
 *
 * **Liability.** "That quote is a ripoff" is an assertion about a named local
 * business, made by a product with no way to verify the work that shop actually
 * quoted. A range plus a comparison is the same information without the
 * defamation surface.
 *
 * ⚠ This said "no entity behind it yet" until 30 Aug, when Southmoor Digital
 * LLC became the operator. An entity changes where the exposure lands, not
 * whether the assertion is checkable — and truthfulness below is the reason
 * this posture actually rests on. Nothing about the posture changes.
 *
 * **Credibility.** A confident single number invites one disproof — the user
 * pays $1,180 against a $900 "answer" and the product was wrong. A range that
 * contains the outcome was right, and is more useful, because the spread *is*
 * the finding: a wide range on a job means the price genuinely varies and
 * shopping around pays.
 *
 * **Truthfulness.** This is the one that matters and the reason the other two
 * are not rationalisations. The model does not know what the job costs. It
 * knows a distribution. Emitting a point estimate reports a precision the
 * underlying inference does not have, and every downstream reader — including
 * the user's decision — inherits a false confidence.
 *
 * ── The posture applies everywhere, not just the front door ─────────────────
 *
 * `cc-design-0003` is deliberately written for *every* advice surface,
 * anonymous or signed in. A rule the consultant follows and the front door does
 * not is a rule that will drift back within two features.
 */

export interface AdviceRange {
  low: number;
  high: number;
}

/**
 * The narrowest a range may be, as a fraction of its midpoint.
 *
 * A "range" of $1,000–$1,010 is a verdict wearing a range's clothes: it claims
 * the answer is known to 1%, which no estimate from a language model over an
 * unseen job is. `widenToHonestSpread` opens anything tighter.
 *
 * 20% is not tuned — it is a floor chosen to be obviously-a-range rather than
 * derived from data, and it should be re-set once the front door has produced
 * real quotes to compare against. Recorded as a guess so it is not later cited
 * as a measurement.
 */
export const MIN_SPREAD_FRACTION = 0.2;

/**
 * Words that turn a comparison into a judgement.
 *
 * Not a content filter — it is a **build-time and test-time guard** on copy this
 * codebase emits. The failure it prevents is gradual: someone adds "that looks
 * like too much" to a template because it reads better, and the liability
 * posture is gone with no diff that looks like a policy change.
 *
 * Split by who the verdict is about, because they fail differently. The `shop`
 * list is a statement about a third party and is the legal exposure. The
 * `certainty` list overclaims what the model knows and is the credibility one.
 */
export const VERDICT_TERMS = {
  shop: [
    'ripoff',
    'rip-off',
    'ripping you off',
    'scam',
    'scamming',
    'overcharging',
    'overcharged',
    'gouging',
    'dishonest',
    'cheating',
  ],
  certainty: [
    'definitely',
    'certainly',
    'guaranteed',
    'without a doubt',
    'you should pay',
    'the correct price is',
    'the right price is',
  ],
} as const;

const ALL_VERDICT_TERMS: readonly string[] = [...VERDICT_TERMS.shop, ...VERDICT_TERMS.certainty];

/**
 * Whether a piece of advice copy states a verdict.
 *
 * Substring matching on a lowercased haystack, deliberately. Word-boundary
 * matching would miss "overcharging" inside "overchargingly" and, more to the
 * point, this is a guard on copy *this project writes* rather than a filter on
 * hostile input — a false positive costs one reworded sentence, a false
 * negative costs the posture.
 */
export function statesVerdict(text: string): boolean {
  const haystack = text.toLowerCase();
  return ALL_VERDICT_TERMS.some((term) => haystack.includes(term));
}

/** Which verdict terms a string contains. For test output that names the problem. */
export function verdictTermsIn(text: string): string[] {
  const haystack = text.toLowerCase();
  return ALL_VERDICT_TERMS.filter((term) => haystack.includes(term));
}

/**
 * Open a range that is too tight to be honest, around its own midpoint.
 *
 * Widening rather than rejecting is the right move: the model's central
 * estimate is still the best information available, and discarding it to avoid
 * overstating precision would throw away the answer to protect the framing.
 * The midpoint is preserved exactly; only the claimed confidence changes.
 *
 * A reversed pair is treated as unordered input rather than an error — swapping
 * is unambiguous, and throwing here would put an exception on a stranger's
 * answer path over a field-order mistake.
 */
export function widenToHonestSpread(
  range: AdviceRange,
  minSpreadFraction: number = MIN_SPREAD_FRACTION
): AdviceRange {
  const low = Math.min(range.low, range.high);
  const high = Math.max(range.low, range.high);
  const midpoint = (low + high) / 2;

  if (midpoint <= 0) return { low, high };

  const minSpread = midpoint * minSpreadFraction;
  if (high - low >= minSpread) return { low, high };

  return {
    low: Math.max(0, midpoint - minSpread / 2),
    high: midpoint + minSpread / 2,
  };
}

/**
 * Render a range for display. En dash, not a hyphen — it is a span, not a minus.
 */
export function formatRange(range: AdviceRange): string {
  const { low, high } = widenToHonestSpread(range);
  return `${formatCurrency(Math.round(low))}–${formatCurrency(Math.round(high))}`;
}

export type QuotePosition = 'below' | 'within' | 'above';

/**
 * Where a quoted figure sits against the typical range.
 *
 * Returns a *position*, not a judgement, and the naming is the whole point: a
 * function called `isQuoteFair` would have one caller and that caller would
 * print the word "fair". `above` is a fact about two numbers. Whether it means
 * the shop is expensive, the job is unusual, or the estimate is wrong is
 * exactly what this product cannot know and must not imply.
 */
export function positionAgainstRange(quoted: number, range: AdviceRange): QuotePosition {
  const { low, high } = widenToHonestSpread(range);
  if (quoted < low) return 'below';
  if (quoted > high) return 'above';
  return 'within';
}

/**
 * The sentence the front door returns.
 *
 * The tagline's promise, answered in the only form that is true: here is the
 * spread, here is where yours falls, here is what to do about it. It never uses
 * the word "fair" — which is the question the user asked and the one word the
 * product cannot honestly say back.
 *
 * `area` is optional and omitted rather than defaulted, because "in your area"
 * with no location is a claim of local knowledge the caller did not supply.
 */
export function describeQuote({
  quoted,
  range,
  job,
  area,
}: {
  quoted: number;
  range: AdviceRange;
  job: string;
  area?: string;
}): string {
  const honest = widenToHonestSpread(range);
  const where = area ? ` in ${area}` : '';
  const typical = `Typical for ${job}${where} is ${formatRange(honest)}.`;
  const yours = `Yours is ${formatCurrency(Math.round(quoted))}`;

  switch (positionAgainstRange(quoted, honest)) {
    case 'within':
      return `${typical} ${yours}, which sits inside that range.`;
    case 'below':
      return `${typical} ${yours}, which is below the usual range — worth checking the quote covers the same parts and labour.`;
    case 'above':
      /*
        The hardest of the three to write, and the one B3 exists for. It has to
        be useful to someone who is probably being overcharged without asserting
        that they are. "Above the range" is observable; the reasons offered are
        the honest alternatives, in the order a mechanic would actually rank
        them; and the recommended action is to get another quote, which is both
        the correct advice and the thing the product can actually help with.
      */
      return `${typical} ${yours}, which is above the usual range. That can happen with dealer labour rates, OEM parts, or additional work included in the quote — a second quote is the cheapest way to find out which.`;
  }
}
