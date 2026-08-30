/**
 * The quote panel narrates what it was handed, and nothing else.
 *
 * ── The third fake indicator, and the same shape as the other two ───────────
 *
 * `QuoteGenerationProgress` ran two `setInterval`s. One advanced a percentage
 * two points every 150ms to a hard 100 — reached at 7.5 seconds, whatever the
 * server was doing. The other ticked four hard-coded stages and drew green
 * checks behind them. The client awaits exactly one call, so there were no
 * stages to be on and no percentage to be at.
 *
 * Two of the four claimed work nobody does. *"Checking regional labor rates"*
 * describes a lookup this product does not perform — the ZIP is typed by the
 * owner and pasted into a prompt — and the closing line named "regional pricing
 * data" as a source. A progress step is a claim about work.
 *
 * ── Why these are rendered assertions and not a source scan ─────────────────
 *
 * `scan-progress-is-real.test.ts` reads its component's source, because the
 * fix there moved the figures into a shared core module and the question was
 * whether the component still owned a clock. Here the whole subject is what a
 * person sees: that the items are named, that no number claims to measure the
 * wait, and that the panel is inert. Rendering it is the only way to assert the
 * last one — a component with no timer produces identical output at 0ms and at
 * 20 seconds, and that is a property you can only observe by advancing time.
 */

import { act, render, screen } from '@testing-library/react';

import { QuoteGenerationProgress } from '@/components/QuoteGenerationProgress';

const ITEMS = [
  { id: '1', description: 'Front brake pads and rotors', category: 'Brakes' },
  { id: '2', description: 'Transmission fluid service', category: 'Drivetrain' },
];

describe('the quote panel owns no clock', () => {
  it('renders identically after twenty seconds', () => {
    /*
      ⚠ The assertion this suite exists for, and the one the old panel could
      never have passed: at 7.5 seconds it read 100% with every stage ticked
      green, while the request it described was still in flight.

      Twenty seconds is chosen against the measured call, not arbitrarily — a
      dossier-class Gemini request runs 23–30s, so this is inside the window
      where the old panel had already announced it was finished.
    */
    jest.useFakeTimers();
    try {
      const { container } = render(<QuoteGenerationProgress items={ITEMS} zipCode="80202" />);
      const atStart = container.innerHTML;

      act(() => {
        jest.advanceTimersByTime(20_000);
      });

      expect(container.innerHTML).toBe(atStart);
    } finally {
      jest.useRealTimers();
    }
  });

  it('shows no percentage anywhere', () => {
    const { container } = render(<QuoteGenerationProgress items={ITEMS} zipCode="80202" />);

    // A model call's progress is not measurable from the client. Any number
    // followed by a percent sign here is a measurement being claimed.
    expect(container.textContent).not.toMatch(/\d\s*%/);
  });

  it('claims no work the product does not do', () => {
    const { container } = render(<QuoteGenerationProgress items={ITEMS} zipCode="80202" />);
    const text = container.textContent ?? '';

    // The two that were live: a rate lookup that does not exist, and a pricing
    // data source that does not exist.
    expect(text).not.toMatch(/checking regional labor rates/i);
    expect(text).not.toMatch(/regional pricing data/i);

    // Anti-vacuous: the panel does render prose, so an empty component would
    // pass the two assertions above for the wrong reason.
    expect(text.length).toBeGreaterThan(80);
  });
});

describe('what it does say is what it was handed', () => {
  it('names every item being priced', () => {
    render(<QuoteGenerationProgress items={ITEMS} zipCode="80202" />);

    // The narration, and the whole of it: these are facts in props.
    expect(screen.getByText('Front brake pads and rotors')).toBeInTheDocument();
    expect(screen.getByText('Transmission fluid service')).toBeInTheDocument();
  });

  it('counts them in the singular when there is one', () => {
    render(<QuoteGenerationProgress items={[ITEMS[0]]} zipCode="80202" />);

    expect(screen.getByText(/Pricing 1 service item\./)).toBeInTheDocument();
  });

  it('states the ZIP as something sent, not something consulted', () => {
    const { container } = render(<QuoteGenerationProgress items={ITEMS} zipCode="80202" />);
    const text = (container.textContent ?? '').replace(/\s+/g, ' ');

    expect(text).toContain('Your ZIP code 80202 goes with the request');
  });

  it('omits the category line rather than rendering an empty one', () => {
    const { container } = render(
      <QuoteGenerationProgress
        items={[{ id: '1', description: 'Oil change', category: '' }]}
        zipCode="80202"
      />
    );

    // `null` is never `0`, and an empty string is never a category. A blank row
    // under a line item reads as a category nobody could name.
    expect(container.textContent).toContain('Oil change');
    expect(container.querySelectorAll('p').length).toBeLessThan(6);
  });
});

describe('a screen reader is told the same thing', () => {
  it('announces itself as a status', () => {
    /*
      ⚠ The old panel's stages were divs that changed colour, so for a blind
      user the indicator was purely decorative *and* purely fictional. Both
      halves are worth stating: the fix is not only that the text is true now,
      it is that there is text at all.
    */
    render(<QuoteGenerationProgress items={ITEMS} zipCode="80202" />);

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status.textContent).toContain('Front brake pads and rotors');
  });
});
