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
      ⚠ Nothing here names the car in visible type, and that is the third
      revision of this assertion — worth stating plainly so it is not undone a
      fourth time.

      It first asserted a serif "2015 BMW M235i" caption beneath the band. That
      became a duplicate of the plate's own name, so it moved to asserting the
      plate's text. The plate's name was itself a duplicate of the page heading
      that sits directly above this hero on the only screen that renders it —
      adjacent on a desktop viewport, ~1100px apart on a phone.

      What must stay true is that the hero *identifies* its vehicle, and it
      does: through the section's accessible name, asserted in the next case.
      What it says in ink is the thing the heading above cannot — that there is
      no photograph, once.
    */
    expect(screen.getByText('No photograph yet')).toBeInTheDocument();
    expect(plate(container).textContent).not.toContain('M235i');

    // And the older wording is gone with the duplicate: two sentences about
    // one missing photograph, 60px apart, in different words.
    expect(container.textContent).not.toMatch(/no photo yet/i);
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
    // And the hero is still a hero — the plate stands where the broken
    // photograph was, saying what is missing, rather than leaving a hole.
    expect(screen.getByText('No photograph yet')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '2015 BMW M235i' })).toBeInTheDocument();
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

  /*
    ── ⚠ Handoff §1.4 · the beat stays, and counts something true ────────────

    An earlier pass deleted the count-up outright. David's call is the opposite:
    keep the moment of assembly, change what it counts. So this asserts the
    settled sentence *and* that the sweep never renders a phrasing the settled
    state would not use — the failure mode of re-deriving the caption from the
    animated value each frame would be "No service records on file" flashing
    under a car with twelve.
  */
  it('names the records it actually read', () => {
    render(<DiagnosticHero {...M235i} healthScore={74} work={{ serviceRecords: 12, recalls: 3 }} />);

    settle();

    expect(screen.getByText('Read 12 service records and 3 recall campaigns.')).toBeInTheDocument();
  });

  it('never shows an absence phrasing while counting up to a real figure', () => {
    render(<DiagnosticHero {...M235i} healthScore={74} work={{ serviceRecords: 12, recalls: 3 }} />);

    // Before the sweep settles: still the "Read …" shape, whatever the numeral.
    expect(screen.queryByText(/no service records/i)).not.toBeInTheDocument();
    expect(screen.getByText(/^Read \d+ service record/)).toBeInTheDocument();

    settle();
    expect(screen.queryByText(/no service records/i)).not.toBeInTheDocument();
  });

  it('says so plainly when a check ran and found nothing', () => {
    render(<DiagnosticHero {...M235i} work={{ serviceRecords: 0, recalls: 0 }} />);
    settle();

    expect(
      screen.getByText(
        'No service records on file, and no recalls found for this year, make and model.'
      )
    ).toBeInTheDocument();
  });

  /*
    ── ⚠ Handoff §1.4 · "show nothing rather than a timer" ───────────────────

    Neither read resolved, so there is nothing true to say and no caption is
    rendered. The earlier pass printed "Nothing read for this car yet." — a slot
    filled to avoid looking unfinished, which is the reflex that produced the
    timer in the first place.
  */
  it('renders no caption at all when nothing resolved', () => {
    const { container } = render(
      <DiagnosticHero {...M235i} photo="https://example.test/car.jpg" work={{ serviceRecords: null, recalls: null }} />
    );
    settle();

    expect(container.textContent).not.toMatch(/read \d/i);

    /*
      Anti-vacuous: the same match finds a caption when there is one to find.

      ⚠ Matched on the sentence rather than on `.label-uppercase`, which is
      what this asserted before. The caption was set in that class — 12px mono
      small caps, "READ 11 SERVICE RECORDS." — and a design critique of the
      rendered page read it as a debug string. It is a sentence, punctuated as
      one at source, and it is set as one now. A test pinned to the old class
      would have failed for the wording being *fixed*.
    */
    const withWork = render(<DiagnosticHero {...M235i} work={{ serviceRecords: 4, recalls: null }} />);
    settle();
    expect(withWork.container.textContent).toMatch(/Read 4 service records\./);
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
    ── ⚠ The hero prints no generated prose at all, at any score ─────────────

    It used to take the model's summary as `reason` and render it beside the
    dial — the same string `HealthSummary` prints in "What's driving the score"
    a few hundred pixels below, verbatim, in one screen.

    The replaced test asserted a narrower rule: that the summary must not
    appear beside an *unknown* score, because there was no assessment to
    summarise. That rule is still true and is now true by construction, so
    what is worth guarding is the wider one — the paragraph belongs where its
    "generated by AI" disclosure is, and the hero links to it instead. This is
    the assertion that fails if somebody threads the prose back up here.
  */
  it('does not render the model summary, and offers the report instead', () => {
    const { container } = render(
      <DiagnosticHero {...M235i} healthScore={74} driversHref="#health-report" />
    );
    settle();

    expect(container.textContent).not.toMatch(/good condition/i);

    const link = screen.getByRole('link', { name: /what.s driving this score/i });
    expect(link).toHaveAttribute('href', '#health-report');
  });

  it('offers no route when the caller gives it nowhere to send anyone', () => {
    // Anti-vacuous for the case above: the link is the caller's to supply, and
    // an empty slot is not held open for it.
    render(<DiagnosticHero {...M235i} healthScore={74} />);
    settle();

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('sends an unknown score to the action, not to the report', () => {
    /*
      D10's state. There is nothing to explain, so a link to an explanation
      would be the same overclaim as printing prose here — what is missing is
      records, and the button is what closes that.
    */
    render(<DiagnosticHero {...M235i} healthScore={null} driversHref="#health-report" onAddRecord={() => {}} />);
    settle();

    expect(screen.queryByRole('link', { name: /driving this score/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add a service record' })).toBeInTheDocument();
  });
});
