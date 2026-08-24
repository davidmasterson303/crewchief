/**
 * The advisor's answer is drawn as elements, not as asterisks.
 *
 * ── Why this exists (FN-14, 24 Aug) ─────────────────────────────────────────
 *
 * The renderer drew **bold** and treated everything else as plain text, so
 * single-asterisk emphasis reached the screen as literal asterisks. Seen live on
 * the deployed demo: *"of \*if\* it fails, it's \*when\*"* and *"you \*always\*
 * replace them as a pair"* — on the product's flagship feature. A screen reader
 * says "asterisk when asterisk".
 *
 * ── Why the *element* mapping needed its own test ───────────────────────────
 *
 * `answer-markup.test.ts` has 23 cases on the tokeniser and none on what gets
 * drawn from it. The mapping went from two branches to four in that fix, and it
 * lived inside a 1,000-line client component pulling in react-query, the toast
 * system and half a dozen dialogs — so nothing was ever going to mount it, and a
 * typo would have rendered nothing while showing nothing wrong. The mobile
 * renderer of the same four branches *is* covered; this closed the gap on the
 * side that shipped the defect.
 *
 * ⚠ `<em>` and `<strong>` rather than font classes, and asserted as such: the
 * emphasis has to survive for a screen reader as well as for the eye. A
 * `font-style: italic` span reads identically to plain text, which is the same
 * failure as the asterisks it replaced.
 */

import { render, screen } from '@testing-library/react';

import { AnswerLine } from '@/components/AnswerLine';

describe('AnswerLine', () => {
  it('draws single-asterisk emphasis as emphasis', () => {
    const { container } = render(<AnswerLine line="it's not *if* it fails" lineKey={0} />);

    expect(container.querySelector('em')?.textContent).toBe('if');
    expect(container.textContent).toBe("it's not if it fails");
    expect(container.textContent).not.toContain('*');
  });

  it('draws bold as bold', () => {
    const { container } = render(<AnswerLine line="that ran **$1,461** all-in" lineKey={0} />);

    expect(container.querySelector('strong')?.textContent).toBe('$1,461');
    expect(container.textContent).toBe('that ran $1,461 all-in');
  });

  it('draws the triple form as both, nested', () => {
    /*
      ⚠ The case that used to render corrupted: the bold rule consumed four of
      the six markers and left a stray `*` at each end. The pair has to be
      checked before `bold`, or the emphasis is silently dropped.
    */
    const { container } = render(<AnswerLine line="this is ***urgent***" lineKey={0} />);

    const strong = container.querySelector('strong');
    expect(strong?.querySelector('em')?.textContent).toBe('urgent');
    expect(container.textContent).toBe('this is urgent');
  });

  it('leaves arithmetic alone', () => {
    // The case that makes this hard, and the one a naive regex breaks.
    const { container } = render(<AnswerLine line="torque to 25 ft-lb * 2" lineKey={0} />);

    expect(container.querySelector('em')).toBeNull();
    expect(container.textContent).toBe('torque to 25 ft-lb * 2');
  });

  it('leaves an unclosed marker as text', () => {
    const { container } = render(<AnswerLine line="**unfinished" lineKey={0} />);

    expect(container.querySelector('strong')).toBeNull();
    expect(container.textContent).toBe('**unfinished');
  });

  it('renders an ordinary line as one span', () => {
    // Anti-vacuous: a renderer that dropped everything would pass the negatives.
    render(<AnswerLine line="Nothing special here." lineKey={0} />);

    expect(screen.getByText('Nothing special here.')).toBeTruthy();
  });
});
