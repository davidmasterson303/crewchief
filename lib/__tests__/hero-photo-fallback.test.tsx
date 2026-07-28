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
 * The score and its band label are held back until the 900ms scan reveal
 * finishes, so a test that asserts them on the first frame is asserting the
 * loading state. This runs the reveal out.
 */
function completeScan() {
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
    // The vehicle is named beneath the band, not on it.
    expect(screen.getByText('2015 BMW M235i')).toBeInTheDocument();
    expect(screen.getByText('No photo yet')).toBeInTheDocument();
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
    // And the hero is still a hero — the vehicle is still named.
    expect(screen.getByText('2015 BMW M235i')).toBeInTheDocument();
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

    // Held back during the reveal — asserting here would test the placeholder.
    expect(screen.queryByText('Fair')).not.toBeInTheDocument();

    completeScan();

    // 74 is "Fair" (>= 60). A hand-written label is how 61 came to be "Good".
    expect(screen.getByText('Fair')).toBeInTheDocument();
  });

  it('says "Diagnostics complete" only once the scan is done, and only with a photo', () => {
    render(<DiagnosticHero {...M235i} photo="https://example.test/car.jpg" healthScore={74} />);

    expect(screen.getByText('Scanning…')).toBeInTheDocument();
    completeScan();
    expect(screen.getByText('Diagnostics complete')).toBeInTheDocument();
  });

  it('is absent entirely when there is no score, rather than showing zero', () => {
    render(<DiagnosticHero {...M235i} />);
    expect(screen.queryByText('/100')).not.toBeInTheDocument();
  });
});
