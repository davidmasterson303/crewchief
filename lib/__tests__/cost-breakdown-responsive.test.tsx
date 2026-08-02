/**
 * The cost breakdown says the same thing in both of its shapes.
 *
 * R8 gave this component two presentations: a card per line item below `md`,
 * the table above it. That is the right answer to five columns carrying ten
 * figures inside 231px of content — but it introduces the failure that every
 * responsive-duplicate has, which is that the two copies drift and only one of
 * them is ever looked at.
 *
 * This is the artefact the consultant produces to justify a number. It *is* the
 * answer, and someone takes it to a shop. A phone showing a different total
 * from the desktop is worse than the clipped numerals R8 set out to fix,
 * because it is legible and wrong.
 *
 * jsdom evaluates no media queries, so `md:hidden` and `hidden md:block` do
 * nothing here and both branches are in the tree at once. That is exactly what
 * makes this comparison possible: the assertions below are about agreement
 * between the two, not about which one is showing.
 */

import { render, screen, within } from '@testing-library/react';
import { CostBreakdownTable } from '@/components/CostBreakdownTable';

const ESTIMATE = {
  regional_labor_rate: 'Denver metro, $145/hr',
  // The sum of the two items below. Deliberately distinct from either line's
  // own total: the first draft of this fixture made item one's total equal the
  // grand total, and every assertion then matched two elements and could not
  // tell which shape it was reading.
  total_low: 530,
  total_high: 675,
  items: [
    {
      description: 'Brake pads & rotors, front',
      parts_cost_low: 180,
      parts_cost_high: 240,
      labor_hours_low: 2,
      labor_hours_high: 2.5,
      labor_cost_low: 260,
      labor_cost_high: 260,
      notes: 'Ceramic pads assumed; semi-metallic is cheaper.',
    },
    {
      description: 'Brake fluid flush',
      parts_cost_low: 20,
      parts_cost_high: 30,
      labor_hours_low: 0.5,
      labor_hours_high: 1,
      labor_cost_low: 70,
      labor_cost_high: 145,
      notes: '',
    },
  ],
};

function cards(container: HTMLElement) {
  return container.querySelector('.md\\:hidden') as HTMLElement;
}

function table(container: HTMLElement) {
  return container.querySelector('.hidden.md\\:block') as HTMLElement;
}

describe('both shapes render', () => {
  it('renders a card per line item below md', () => {
    const { container } = render(<CostBreakdownTable costBreakdown={ESTIMATE} />);

    expect(within(cards(container)).getByText('Brake pads & rotors, front')).toBeInTheDocument();
    expect(within(cards(container)).getByText('Brake fluid flush')).toBeInTheDocument();
  });

  it('still renders the table for md and up', () => {
    const { container } = render(<CostBreakdownTable costBreakdown={ESTIMATE} />);

    expect(within(table(container)).getByRole('table')).toBeInTheDocument();
  });

  it('keeps the wrapper that stops the table scrolling sideways', () => {
    /*
      `overflow-hidden` is deliberate and the audit is explicit that removing it
      is not the fix — a sideways-scrolling estimate is not an answer either.
      The cards are what make the clipping unnecessary; they are not a licence
      to unclip the table.
    */
    const { container } = render(<CostBreakdownTable costBreakdown={ESTIMATE} />);

    expect(table(container).className).toContain('overflow-hidden');
  });
});

describe('the two shapes agree, figure for figure', () => {
  /*
    The whole point of computing `rows` once in the component. If someone later
    edits one branch's formatting — a currency symbol, a rounding rule, a
    range separator — these fail rather than shipping two different answers to
    the same question.
  */
  it.each([
    ['first item total', '$440 – $500'],
    ['second item total', '$90 – $175'],
  ])('%s appears in both', (_label, value) => {
    const { container } = render(<CostBreakdownTable costBreakdown={ESTIMATE} />);

    expect(within(cards(container)).getAllByText(value).length).toBeGreaterThan(0);
    expect(within(table(container)).getAllByText(value).length).toBeGreaterThan(0);
  });

  it('shows the same estimated total in both', () => {
    const { container } = render(<CostBreakdownTable costBreakdown={ESTIMATE} />);

    expect(within(cards(container)).getByText('$530 – $675')).toBeInTheDocument();
    expect(within(table(container)).getByText('$530 – $675')).toBeInTheDocument();
  });

  it('collapses a range whose ends are equal, in both', () => {
    // Labor cost on the first item is 260 to 260. "$260 – $260" is noise
    // pretending to be precision.
    const { container } = render(<CostBreakdownTable costBreakdown={ESTIMATE} />);

    expect(within(cards(container)).queryByText(/\$260 – \$260/)).toBeNull();
    expect(within(table(container)).queryByText(/\$260 – \$260/)).toBeNull();
    expect(within(table(container)).getByText('$260')).toBeInTheDocument();
  });
});

describe('the card shape carries what the table hides behind hover', () => {
  it('shows the estimate note as text rather than a tooltip', () => {
    /*
      The table puts `notes` in a tooltip. A tooltip is a hover affordance, and
      the surface these cards exist for has no hover — so the note would be
      unreachable on precisely the device the cards were written for. It is one
      line of context on a number someone is about to spend money against.
    */
    const { container } = render(<CostBreakdownTable costBreakdown={ESTIMATE} />);

    expect(
      within(cards(container)).getByText('Ceramic pads assumed; semi-metallic is cheaper.')
    ).toBeInTheDocument();
  });

  it('renders no empty note block for an item without one', () => {
    const { container } = render(<CostBreakdownTable costBreakdown={ESTIMATE} />);
    const second = within(cards(container)).getByText('Brake fluid flush').closest('div')!;

    expect(second.textContent).not.toMatch(/Estimate details/);
  });

  it('labels every figure, since there is no column header to inherit from', () => {
    // A card has no header row. An unlabelled "$180 – $240" is a number with no
    // question attached to it.
    const { container } = render(<CostBreakdownTable costBreakdown={ESTIMATE} />);
    const scope = within(cards(container));

    expect(scope.getAllByText('Parts').length).toBe(2);
    expect(scope.getAllByText('Labor').length).toBe(2);
    expect(scope.getAllByText('Total').length).toBe(2);
  });
});
