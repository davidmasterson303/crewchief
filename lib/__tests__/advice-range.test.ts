/**
 * Answers as ranges, never verdicts. Advisory B3 (7.8), `cc-design-0003`.
 *
 * @jest-environment node
 *
 * The posture is three things at once — liability, credibility and
 * truthfulness — and it decays in one specific way: someone rewrites a template
 * because a flatter sentence reads better, and the change looks like copy
 * rather than policy. Most of what is asserted here is that the copy this
 * project emits cannot quietly acquire a judgement.
 */

import {
  MIN_SPREAD_FRACTION,
  VERDICT_TERMS,
  describeQuote,
  formatRange,
  positionAgainstRange,
  statesVerdict,
  verdictTermsIn,
  widenToHonestSpread,
} from '@wellkept/core/advice-range';

describe('statesVerdict', () => {
  it.each([...VERDICT_TERMS.shop])('catches the verdict term %s', (term) => {
    expect(statesVerdict(`This quote is a ${term} honestly`)).toBe(true);
  });

  it.each([...VERDICT_TERMS.certainty])('catches the overclaim %s', (term) => {
    expect(statesVerdict(`This is ${term} the number`)).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(statesVerdict('That is a RIPOFF')).toBe(true);
  });

  it('passes an honest comparison', () => {
    expect(
      statesVerdict('Typical for front brake pads is $300–$450. Yours is $520, which is above the usual range.')
    ).toBe(false);
  });

  it('names what it found, so a failure says why', () => {
    expect(verdictTermsIn('a total scam and definitely wrong')).toEqual(
      expect.arrayContaining(['scam', 'definitely'])
    );
  });
});

describe('widenToHonestSpread', () => {
  it('leaves an honestly wide range alone', () => {
    expect(widenToHonestSpread({ low: 900, high: 1300 })).toEqual({ low: 900, high: 1300 });
  });

  it('opens a range too tight to be an estimate', () => {
    /*
      $1,000–$1,010 claims the answer is known to 1%, which no inference over an
      unseen job is. It is a verdict wearing a range's clothes, and it is how
      the posture is lost without anyone editing a word of copy.
    */
    const widened = widenToHonestSpread({ low: 1000, high: 1010 });
    expect(widened.high - widened.low).toBeCloseTo(1005 * MIN_SPREAD_FRACTION);
  });

  it('preserves the midpoint exactly — the estimate is not discarded', () => {
    const widened = widenToHonestSpread({ low: 1000, high: 1010 });
    expect((widened.low + widened.high) / 2).toBeCloseTo(1005);
  });

  it('handles a point estimate', () => {
    const widened = widenToHonestSpread({ low: 500, high: 500 });
    expect(widened.high).toBeGreaterThan(widened.low);
    expect((widened.low + widened.high) / 2).toBeCloseTo(500);
  });

  it('swaps a reversed pair rather than throwing', () => {
    // Field-order mistakes must not put an exception on a stranger's answer
    // path when the intent is unambiguous.
    expect(widenToHonestSpread({ low: 1300, high: 900 })).toEqual({ low: 900, high: 1300 });
  });

  it('never produces a negative low', () => {
    expect(widenToHonestSpread({ low: 10, high: 10 }).low).toBeGreaterThanOrEqual(0);
  });

  it('leaves a zero or nonsensical midpoint alone rather than inventing a spread', () => {
    expect(widenToHonestSpread({ low: 0, high: 0 })).toEqual({ low: 0, high: 0 });
  });
});

describe('formatRange', () => {
  it('renders a span with an en dash, not a minus sign', () => {
    expect(formatRange({ low: 900, high: 1300 })).toBe('$900–$1,300');
    expect(formatRange({ low: 900, high: 1300 })).not.toContain('-');
  });

  it('widens before rendering, so no displayed range is dishonestly tight', () => {
    const rendered = formatRange({ low: 1000, high: 1005 });
    expect(rendered).not.toBe('$1,000–$1,005');
  });
});

describe('positionAgainstRange', () => {
  const range = { low: 900, high: 1300 };

  it('places a quote inside, below and above', () => {
    expect(positionAgainstRange(1100, range)).toBe('within');
    expect(positionAgainstRange(700, range)).toBe('below');
    expect(positionAgainstRange(1600, range)).toBe('above');
  });

  it('treats the bounds as inside', () => {
    expect(positionAgainstRange(900, range)).toBe('within');
    expect(positionAgainstRange(1300, range)).toBe('within');
  });

  it('judges against the widened range, not the raw one', () => {
    // Otherwise a dishonestly tight range would push ordinary quotes to
    // 'above', and the tightness would express itself as a verdict after all.
    expect(positionAgainstRange(1080, { low: 1000, high: 1010 })).toBe('within');
  });
});

describe('describeQuote — the sentence the front door returns', () => {
  const range = { low: 900, high: 1300 };
  const cases = [
    ['within', 1100],
    ['below', 700],
    ['above', 1600],
  ] as const;

  it.each(cases)('states no verdict when the quote is %s the range', (_position, quoted) => {
    const sentence = describeQuote({ quoted, range, job: 'a timing belt', area: 'Denver' });
    expect(verdictTermsIn(sentence)).toEqual([]);
  });

  it.each(cases)('never says the word "fair" (%s)', (_position, quoted) => {
    /*
      The question the user asked, and the one word the product cannot honestly
      say back. Asserted separately from the verdict list because "fair" is not
      a slur — it is the specific overclaim this feature is about, and it would
      look harmless in a template review.
    */
    const sentence = describeQuote({ quoted, range, job: 'a timing belt' });
    expect(sentence.toLowerCase()).not.toContain('fair');
  });

  it.each(cases)('always gives the range and the quote (%s)', (_position, quoted) => {
    const sentence = describeQuote({ quoted, range, job: 'a timing belt' });
    expect(sentence).toContain('$900–$1,300');
    expect(sentence).toContain('Typical for a timing belt');
  });

  it('omits the location when none was supplied', () => {
    // "in your area" with no location is a claim of local knowledge the caller
    // did not provide.
    const sentence = describeQuote({ quoted: 1100, range, job: 'a timing belt' });
    expect(sentence).not.toContain(' in ');
    expect(describeQuote({ quoted: 1100, range, job: 'a timing belt', area: 'Denver' })).toContain(
      'in Denver'
    );
  });

  it('gives an over-range quote an action instead of an accusation', () => {
    /*
      The case B3 exists for. It must be useful to someone probably being
      overcharged without asserting that they are: the position is observable,
      the offered reasons are the honest alternatives, and the recommended
      action is the one the product can actually help with.
    */
    const sentence = describeQuote({ quoted: 1600, range, job: 'a timing belt' });
    expect(sentence).toContain('above the usual range');
    expect(sentence.toLowerCase()).toContain('second quote');
    expect(verdictTermsIn(sentence)).toEqual([]);
  });

  it('warns on a suspiciously low quote rather than celebrating it', () => {
    // Below the range is not good news by default — it usually means the quote
    // does not cover the same work.
    const sentence = describeQuote({ quoted: 400, range, job: 'a timing belt' });
    expect(sentence.toLowerCase()).toContain('below the usual range');
    expect(sentence.toLowerCase()).toContain('same parts and labour');
  });
});
