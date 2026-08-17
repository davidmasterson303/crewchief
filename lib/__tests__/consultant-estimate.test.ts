/**
 * @jest-environment node
 *
 * The structured estimate behind the advisor's well.
 *
 * ── What these are actually defending ───────────────────────────────────────
 *
 * Not "does the regex work". The estimate is the one place in this product
 * where a language model's output is rendered **as prices, in the product's own
 * voice, inside a styled panel** — which is the strongest claim of precision
 * anything here makes. Every test below is about a way that claim could become
 * untrue: a range too tight to be honest, a total invented by addition, a well
 * that renders at $0 on an answer that priced nothing.
 *
 * The parsing is the easy half and it is covered because it has to be. The
 * judgements are the half worth reading.
 */

import { MIN_SPREAD_FRACTION } from '@crewchief/core/advice-range';
import { parseEstimate } from '@crewchief/core/consultant-estimate';

/** The board's own worked example, as the model would emit it. */
const BOARD_EXAMPLE = `Brake fluid's looking tired. Here's the damage:

[ESTIMATE: Fluid flush|110|160]
[ESTIMATE: Master cylinder, if needed|380|520]
[ESTIMATE_TOTAL: 110|160]

My money says it's just the flush.`;

describe('absent means absent', () => {
  it('returns no estimate for an answer that priced nothing', () => {
    /*
      ⚠ The load-bearing case, and the reason `estimate` is optional rather
      than an empty object. Most advisor answers are not quotes. A well that
      renders empty — or worse, at $0 — on every non-pricing answer is a worse
      screen than no well at all.
    */
    const result = parseEstimate("You're fine on brakes. Check back at 60k.");

    expect(result.estimate).toBeUndefined();
    expect(result.cleaned).toBe("You're fine on brakes. Check back at 60k.");
  });

  it('refuses a total with no lines to explain it', () => {
    // A bare number in a well with nothing under it is not an estimate; the
    // itemisation is the entire reason the well is a well.
    const result = parseEstimate('About four hundred.\n\n[ESTIMATE_TOTAL: 380|420]');

    expect(result.estimate).toBeUndefined();
    expect(result.cleaned).toBe('About four hundred.');
  });

  it('leaves no machinery in the prose when a tag is dropped', () => {
    /*
      Dropping a line and leaving its tag visible would be the worst of both:
      no price in the well and `[ESTIMATE: ...]` in the chat bubble. Cleaning
      is unconditional for that reason — it does not depend on whether parsing
      succeeded.
    */
    const result = parseEstimate('Here:\n\n[ESTIMATE: Flush|not a number|160]\n\nThat is the job.');

    expect(result.estimate).toBeUndefined();
    expect(result.cleaned).not.toContain('ESTIMATE');
    expect(result.cleaned).toBe('Here:\n\nThat is the job.');
  });
});

describe('the total is asked for, never computed', () => {
  it('takes the model’s likely total over the sum of the lines', () => {
    /*
      ⚠ The single most important assertion in this file.

      The board prices two lines at $110–$160 and $380–$520 and gives "Most
      likely total" as **$110–$160** — because the second line is "Master
      cylinder, *if needed*" and the likely case is that it is not. Summing
      would charge the owner for every contingency the advisor was careful to
      mark as one, turning a considered answer into a worst case and reporting
      it as the expected one.

      Only the model knows which lines are conditional. So only the model says
      this, and 490 must never appear.
    */
    const { estimate } = parseEstimate(BOARD_EXAMPLE);

    expect(estimate?.lines).toHaveLength(2);
    expect(estimate?.likely).toEqual({ low: 110, high: 160 });

    const summed = estimate!.lines.reduce((total, line) => total + line.range.low, 0);
    expect(estimate!.likely!.low).not.toBe(summed);
  });

  it('omits the total rather than deriving one', () => {
    const { estimate } = parseEstimate('[ESTIMATE: Fluid flush|110|160]');

    expect(estimate?.lines).toHaveLength(1);
    expect(estimate?.likely).toBeUndefined();
    expect('likely' in estimate!).toBe(false);
  });

  it('keeps the first of two totals, not the last', () => {
    // A second total is the model contradicting itself. Preferring the later
    // one would silently pick whichever it happened to write second.
    const { estimate } = parseEstimate(
      '[ESTIMATE: Flush|110|160]\n[ESTIMATE_TOTAL: 110|160]\n[ESTIMATE_TOTAL: 900|1100]'
    );

    expect(estimate?.likely).toEqual({ low: 110, high: 160 });
  });
});

describe('no range claims more precision than it has', () => {
  it('opens a range too tight to be honest', () => {
    /*
      $1,000–$1,010 claims the answer is known to 1%, which no estimate from a
      language model over an unseen job is. `widenToHonestSpread` is applied at
      this boundary rather than in the renderer, so every reader of a
      `ConsultantEstimate` gets the honest spread without asking.
    */
    const { estimate } = parseEstimate('[ESTIMATE: Timing belt|1000|1010]');

    const { low, high } = estimate!.lines[0].range;
    expect(high - low).toBeCloseTo(1005 * MIN_SPREAD_FRACTION);
    // The midpoint is preserved exactly — only the claimed confidence moves.
    expect((low + high) / 2).toBeCloseTo(1005);
  });

  it('leaves an already-honest range alone', () => {
    const { estimate } = parseEstimate('[ESTIMATE: Fluid flush|110|160]');

    expect(estimate?.lines[0].range).toEqual({ low: 110, high: 160 });
  });

  it('widens the total too, not only the lines', () => {
    // Easy to wire one and forget the other, and the total is the number a
    // reader will actually quote back at a shop.
    const { estimate } = parseEstimate(
      '[ESTIMATE: Flush|110|160]\n[ESTIMATE_TOTAL: 1000|1010]'
    );

    expect(estimate!.likely!.high - estimate!.likely!.low).toBeCloseTo(
      1005 * MIN_SPREAD_FRACTION
    );
  });
});

describe('what the model writes for a human', () => {
  it('reads dollar signs and thousands separators', () => {
    const { estimate } = parseEstimate('[ESTIMATE: Clutch| $1,200 |$1,800]');

    expect(estimate?.lines[0]).toEqual({
      label: 'Clutch',
      range: { low: 1200, high: 1800 },
    });
  });

  it('drops a line priced at zero rather than showing it as free', () => {
    /*
      ⚠ Rejected, not clamped. A zero-dollar line is either a parse failure or
      the model saying "free" — and "free" rendered in a priced well is a claim
      about a shop's pricing that nobody actually made.
    */
    const { estimate } = parseEstimate('[ESTIMATE: Inspection|0|0]\n[ESTIMATE: Flush|110|160]');

    expect(estimate?.lines.map((l) => l.label)).toEqual(['Flush']);
  });

  it('keeps the other prices when one line is unusable', () => {
    // One malformed line should not cost the owner the three good ones.
    const { estimate } = parseEstimate(
      '[ESTIMATE: Flush|110|160]\n[ESTIMATE: Broken|abc|def]\n[ESTIMATE: Pads|240|310]'
    );

    expect(estimate?.lines.map((l) => l.label)).toEqual(['Flush', 'Pads']);
  });
});

describe('a line item is advice copy, and answers to the same rule', () => {
  it('drops a label that states a verdict about a shop', () => {
    /*
      `cc-design-0003` is deliberately written for *every* advice surface, not
      just the front door — a rule the consultant follows and the well does not
      is a rule that drifts back within two features. "Fluid flush (they're
      overcharging)" set in a styled panel next to a price is a statement about
      a named local business made by a product with no entity behind it.
    */
    const { estimate } = parseEstimate(
      "[ESTIMATE: Fluid flush, they're overcharging|110|160]\n[ESTIMATE: Pads|240|310]"
    );

    expect(estimate?.lines.map((l) => l.label)).toEqual(['Pads']);
  });

  it('drops a label that overclaims certainty', () => {
    const { estimate } = parseEstimate(
      '[ESTIMATE: The correct price is a flush|110|160]\n[ESTIMATE: Pads|240|310]'
    );

    expect(estimate?.lines.map((l) => l.label)).toEqual(['Pads']);
  });
});

describe('the prose survives the tags being removed', () => {
  it('leaves a paragraph break, not a hole', () => {
    const { cleaned } = parseEstimate(BOARD_EXAMPLE);

    expect(cleaned).toBe(
      "Brake fluid's looking tired. Here's the damage:\n\nMy money says it's just the flush."
    );
  });

  it('does not read a total as a line item', () => {
    /*
      The `:` in the line pattern is what keeps `[ESTIMATE_TOTAL:` from matching
      it. Without that, every total arrived as a line labelled "TOTAL" — priced,
      itemised, and counted twice.
    */
    const { estimate } = parseEstimate('[ESTIMATE: Flush|110|160]\n[ESTIMATE_TOTAL: 110|160]');

    expect(estimate?.lines).toHaveLength(1);
    expect(estimate?.lines[0].label).toBe('Flush');
  });

  it('parses the same input twice with the same result', () => {
    // A module-level `/g/` regex carries `lastIndex` between calls, which makes
    // every second parse in a long-lived server process return nothing. This is
    // the test that fails if the fresh-`RegExp` helper is ever inlined away.
    expect(parseEstimate(BOARD_EXAMPLE)).toEqual(parseEstimate(BOARD_EXAMPLE));
  });
});
