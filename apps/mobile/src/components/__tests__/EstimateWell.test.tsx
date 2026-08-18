import { render } from '@testing-library/react-native';

import EstimateWell from '../EstimateWell';

/**
 * The estimate under an advisor answer — `Well`'s first caller.
 *
 * These are about the two things that could make a rendered price untrue: a
 * total that looks like a sum when it is not one, and a claim of local
 * knowledge nobody supplied. The layout is not tested; the assertions are.
 */

const TWO_LINES = {
  lines: [
    { label: 'Fluid flush', range: { low: 110, high: 160 } },
    { label: 'Master cylinder, if needed', range: { low: 380, high: 520 } },
  ],
  likely: { low: 110, high: 160 },
};

describe('what the numbers say they are', () => {
  it('prices every line as a range', async () => {
    const view = await render(<EstimateWell estimate={TWO_LINES} />);

    /*
      `$110–$160` twice, and that is the board's example working rather than a
      loose matcher: the flush is the first line, and it is also the likely
      figure, because the master cylinder is the "if needed" one and it probably
      is not. Asserting one occurrence would fail on the correct render.
    */
    expect(view.getAllByText('$110–$160')).toHaveLength(2);
    expect(view.getByText('$380–$520')).toBeTruthy();
    await view.unmount();
  });

  it('calls the summary “most likely”, never a total', async () => {
    /*
      ⚠ The wording carries the design. The server takes this figure from the
      model rather than summing the lines, precisely so "Master cylinder, if
      needed" is not charged for when it probably is not needed — here the two
      lines run to $490 at the low end and the likely figure is $110.

      A reader who adds up the rows and gets a different number is seeing the
      feature. The word "Total" would tell them they were seeing a bug.
    */
    const view = await render(<EstimateWell estimate={TWO_LINES} />);

    expect(view.getByText('Most likely')).toBeTruthy();
    expect(view.queryByText(/total/i)).toBeNull();
    expect(view.queryByText(/\$490/)).toBeNull();
    await view.unmount();
  });

  it('shows only the lines when the model gave no likely figure', async () => {
    // Absent must render as absent here too, not as a $0 row or a computed one.
    const view = await render(
      <EstimateWell estimate={{ lines: [{ label: 'Pads', range: { low: 240, high: 310 } }] }} />
    );

    expect(view.getByText('$240–$310')).toBeTruthy();
    expect(view.queryByText('Most likely')).toBeNull();
    await view.unmount();
  });

  it('opens a range too tight to be honest, at render', async () => {
    /*
      `formatRange` widens on the way to the screen as well as at the API
      boundary. Belt and braces on purpose: this is the last point before a
      number becomes a claim, and the cost of the second check is nothing.
    */
    const view = await render(
      <EstimateWell estimate={{ lines: [{ label: 'Belt', range: { low: 1000, high: 1010 } }] }} />
    );

    // Midpoint 1005 held exactly, spread opened to 20% of it: 904.5–1105.5,
    // rounded for display. Only the claimed confidence moves.
    expect(view.queryByText('$1,000–$1,010')).toBeNull();
    expect(view.getByText('$905–$1,106')).toBeTruthy();
    await view.unmount();
  });
});

describe('what it does not claim', () => {
  it('does not say “in your area”', async () => {
    /*
      The board's drawn copy reads "for this vehicle in your area". This app has
      no location — the consultant prompt receives no postcode and no region —
      so the phrase is dropped rather than defaulted, the same rule
      `describeQuote` already follows for its optional `area`. Saying it anyway
      would be a claim of local knowledge nobody supplied.
    */
    const view = await render(<EstimateWell estimate={TWO_LINES} />);

    expect(view.queryByText(/in your area/i)).toBeNull();
    expect(view.getByText('Estimated, for this vehicle')).toBeTruthy();
    await view.unmount();
  });
});
