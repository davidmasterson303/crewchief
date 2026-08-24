/**
 * The dashboard hero never renders a broken photograph, and never renders
 * nothing.
 *
 * @jest-environment jsdom
 *
 * This started as a regression test for a bug that shipped and stayed shipped:
 * `vehicle-documents` went private, three upload sites kept persisting
 * `.getPublicUrl()` results, and the hero took a truthy string as proof a
 * photograph would appear — rendering broken `<img>` elements under the label
 * "Diagnostics Complete".
 *
 * CC-142 moved the mechanism into `VehicleIdentity`, which has its own tests
 * for the exchange itself. What stays here is the guarantee that belongs at
 * *this* level, because it is a property of the screen rather than of the
 * component: the dashboard hero is always present, and it degrades to the
 * identity plate rather than to an absence or a broken image.
 *
 * The "always present" half is new and is worth stating plainly. The hero used
 * to be rendered behind `{vehicleImage && ...}`, so a vehicle with no photo
 * had no hero at all and its dashboard opened on a recall banner.
 */

import { render, screen, fireEvent, act } from '@testing-library/react';
import DiagnosticHero from '@/components/DiagnosticHero';

/**
 * Runs any pending timers out.
 *
 * ⚠ This used to be `completeScan`, and it was load-bearing: the hero held its
 * score behind a 900ms `setTimeout` that stood in for a diagnostic. D13 removed
 * the timer, so the dial is live on mount and there is no reveal to complete.
 *
 * It is kept, and still called, precisely so this suite would notice a *new*
 * timer appearing in front of the reading. If someone reintroduces a staged
 * reveal, the assertions before this call are what fail.
 */
function settle() {
  act(() => {
    jest.advanceTimersByTime(1000);
  });
}

const M235i = {
  vehicleName: '2015 BMW M235i',
  year: 2015,
  make: 'BMW',
  model: 'M235i',
  trim: 'Base',
};

function plate(container: HTMLElement): HTMLElement {
  const el = container.querySelector('[data-variant="band"]');
  if (!el) throw new Error('expected the hero band');
  return el as HTMLElement;
}

describe('the hero always renders', () => {
  it('shows the identity plate when there is no photo', () => {
    const { container } = render(<DiagnosticHero {...M235i} />);

    expect(plate(container).dataset.hasPhoto).toBe('false');
    expect(container.querySelectorAll('img').length).toBe(0);

    /*
      The plate itself names the car, and the hero no longer repeats it.

      This used to assert the caption's serif "2015 BMW M235i" under a comment
      saying "the vehicle is named beneath the band, not on it" — which was true
      with a photograph and false without one. In the no-photo state the plate
      *is* the naming, so the caption was a second copy about 150px away, and the
      page heading a third a little higher up.

      What must stay true is that the hero identifies its vehicle. Asserted here
      on the plate's own text and, below, on the section's accessible name.
    */
    expect(screen.getByText('M235i')).toBeInTheDocument();
    expect(screen.getByText(/2015 BMW/)).toBeInTheDocument();
    expect(screen.getByText('No photo yet')).toBeInTheDocument();
  });

  it('is identifiable to a screen reader whether or not it has a photo', () => {
    // The accessible name is what survives dropping the visible duplicate — the
    // information was never the problem, the third rendering of it was.
    const { unmount } = render(<DiagnosticHero {...M235i} />);
    expect(screen.getByRole('region', { name: '2015 BMW M235i' })).toBeInTheDocument();
    unmount();

    render(<DiagnosticHero {...M235i} photo="https://example.test/car.jpg" />);
    expect(screen.getByRole('region', { name: '2015 BMW M235i' })).toBeInTheDocument();
  });

  it('shows the photo when there is one', () => {
    const { container } = render(
      <DiagnosticHero {...M235i} photo="https://example.test/car.jpg" />
    );
    expect(plate(container).dataset.hasPhoto).toBe('true');
  });
});

describe('when the photo fails to load', () => {
  it('falls back to the plate rather than a broken image', () => {
    const { container } = render(
      <DiagnosticHero {...M235i} photo="https://example.test/gone.jpg" />
    );

    const probe = container.querySelector('img');
    expect(probe).toBeTruthy();
    fireEvent.error(probe!);

    expect(plate(container).dataset.hasPhoto).toBe('false');
    expect(container.querySelectorAll('img').length).toBe(0);
    // And the hero is still a hero — the plate names the vehicle where the
    // broken photograph was, rather than leaving a hole.
    expect(screen.getByText('M235i')).toBeInTheDocument();
  });
});

describe('the score', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('is not printed over the photograph', () => {
    const { container } = render(
      <DiagnosticHero {...M235i} photo="https://example.test/car.jpg" healthScore={74} />
    );

    // The band is the photo and nothing else. The score lives in the block
    // beneath it, which is what removed the need for the scrims entirely.
    expect(plate(container).textContent).toBe('');
  });

  it('renders the band label derived from the score, never free text', () => {
    render(<DiagnosticHero {...M235i} healthScore={74} />);

    // 74 is "Fair" (>= 60). A hand-written label is how 61 came to be "Good".
    // Present immediately: there is no reveal to wait out any more.
    expect(screen.getByText('Fair')).toBeInTheDocument();

    settle();
    expect(screen.getByText('Fair')).toBeInTheDocument();
  });

  /*
    ── ⚠ D13 · the caption is a claim, and these are the teeth ────────────────

    The replaced test asserted `'Scanning…'` then `'Diagnostics complete'`, and
    it passed for years while the app told every owner it had examined their
    car. It was a correct test of the wrong behaviour — which is the failure
    mode rule 5 is about, arriving from the other direction: not a guard that
    checks nothing, but a guard that faithfully pins something untrue.
  */
  it('never claims a diagnostic it did not run', () => {
    render(
      <DiagnosticHero
        {...M235i}
        photo="https://example.test/car.jpg"
        healthScore={74}
        work={{ serviceRecords: 0, recalls: 0 }}
      />
    );

    settle();

    expect(screen.queryByText(/diagnostics complete/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/scanning/i)).not.toBeInTheDocument();
  });

  it('names the records it actually read', () => {
    render(<DiagnosticHero {...M235i} healthScore={74} work={{ serviceRecords: 12, recalls: 3 }} />);

    expect(screen.getByText('Read 12 service records and 3 recall campaigns.')).toBeInTheDocument();
  });

  it('says so plainly when it read nothing', () => {
    render(<DiagnosticHero {...M235i} work={{ serviceRecords: 0, recalls: 0 }} />);

    expect(
      screen.getByText(
        'No service records on file, and no recalls found for this year, make and model.'
      )
    ).toBeInTheDocument();
  });

  /*
    ── ⚠ D10 · a null score is not a zero, and this is where it was ──────────

    The replaced assertion was `expect(queryByText('/100')).not.toBeInTheDocument()`
    — vacuous twice over. `ClusterGauge` prints no denominator at all, so the
    string was absent regardless; and it was checked against `healthScore`
    *undefined*, the one case that renders no dial, so it never exercised the
    defect. A car whose score is `null` rendered a full red dial reading 0.

    Both states are asserted here, separately, because they are different
    claims: `undefined` is "this caller shows no score", `null` is "this car has
    no score".
  */
  it('renders no dial at all when the caller passes no score', () => {
    const { container } = render(<DiagnosticHero {...M235i} />);
    settle();

    expect(container.querySelector('[role="img"]')).toBeNull();
  });

  it('renders an unknown dial — not a zero — when the score is null', () => {
    render(<DiagnosticHero {...M235i} healthScore={null} work={{ serviceRecords: 0, recalls: 0 }} />);
    settle();

    const dial = screen.getByRole('img', { name: /health score/i });
    expect(dial).toHaveAttribute(
      'aria-label',
      'Health score not available — not enough history yet'
    );

    // The reading is a dash, and no band judgement is printed beside it.
    expect(dial.textContent).toContain('—');
    expect(dial.textContent).not.toMatch(/\b0\b/);
    for (const band of ['Needs attention', 'Poor', 'Fair', 'Good', 'Excellent']) {
      expect(screen.queryByText(band)).not.toBeInTheDocument();
    }

    // Anti-vacuous: this suite can still detect a real reading on the same path.
    expect(screen.getByText('No score yet')).toBeInTheDocument();
  });

  it('offers the action that closes the gap, when the caller supplies one', () => {
    const onAddRecord = jest.fn();
    render(<DiagnosticHero {...M235i} healthScore={null} onAddRecord={onAddRecord} />);
    settle();

    expect(screen.getByText(/not enough history yet/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add a service record' }));
    expect(onAddRecord).toHaveBeenCalledTimes(1);
  });

  /*
    The model's summary describes an assessment. When there is no score there
    was no assessment, so prose about the car must not appear beside a dial
    whose whole content is that we have nothing to say about it.
  */
  it('does not print the model summary beside an unknown score', () => {
    render(
      <DiagnosticHero {...M235i} healthScore={null} reason="Vehicle is in good condition" />
    );
    settle();

    expect(screen.queryByText('Vehicle is in good condition')).not.toBeInTheDocument();

    // Anti-vacuous: the same prop does render beside a real score.
    render(<DiagnosticHero {...M235i} healthScore={74} reason="Vehicle is in good condition" />);
    expect(screen.getByText('Vehicle is in good condition')).toBeInTheDocument();
  });
});
