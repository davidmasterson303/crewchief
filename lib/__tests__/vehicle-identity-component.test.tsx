/**
 * VehicleIdentity — the acceptance criteria that can be asserted.
 *
 * @jest-environment jsdom
 *
 * CC-142's criteria are mostly about what must *never* appear: no broken
 * image, no 404, no scrim over a photograph, one answer to "what does a
 * vehicle look like" shared by garage and dashboard. Absence is exactly what
 * eyeballing a screenshot is worst at, and what a test is best at.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { VehicleIdentity } from '@/components/VehicleIdentity';
import { vehicleField } from '@crewchief/core/vehicle-identity';

const M235i = { year: 2015, make: 'BMW', model: 'M235i', trim: 'Base' };

function plate(container: HTMLElement): HTMLElement {
  const el = container.querySelector('[data-variant]');
  if (!el) throw new Error('expected an identity plate');
  return el as HTMLElement;
}

describe('the no-photo state, which is the primary design', () => {
  it('renders the plate with the vehicle named, and no <img> at all', () => {
    const { container } = render(<VehicleIdentity variant="card" {...M235i} />);

    expect(plate(container).dataset.hasPhoto).toBe('false');
    expect(screen.getByText('M235i')).toBeInTheDocument();
    expect(screen.getByText('2015 BMW · Base')).toBeInTheDocument();

    // The bug this whole component replaces: a fallback <img> pointing at a
    // path that 404s. There must be no image element on the no-photo path.
    expect(container.querySelectorAll('img').length).toBe(0);
  });

  it('paints the make-derived field', () => {
    const { container } = render(<VehicleIdentity variant="card" {...M235i} />);
    // BMW's published anchor is 297 degrees; the field must actually be used,
    // not merely computed.
    expect(plate(container).style.background).toContain('linear-gradient');
    expect(plate(container).style.background).toBe(vehicleField('BMW').gradient);
  });

  it('survives a vehicle with almost nothing known about it', () => {
    const { container } = render(<VehicleIdentity variant="card" />);
    expect(container.querySelectorAll('img').length).toBe(0);
    expect(plate(container).style.background).toContain('linear-gradient');
  });

  it('omits the separator when there is nothing on both sides of it', () => {
    render(<VehicleIdentity variant="card" make="Honda" model="Civic" />);
    expect(screen.getByText('Honda')).toBeInTheDocument();
    expect(screen.queryByText(/·/)).not.toBeInTheDocument();
  });
});

describe('the photo state', () => {
  it('contains the photo rather than cropping it', () => {
    const { container } = render(
      <VehicleIdentity variant="band" photo="https://example.test/car.jpg" {...M235i} />
    );

    const sharp = container.querySelector('[role="img"]') as HTMLElement;
    expect(sharp).toBeTruthy();
    // The load-bearing decision: contain, never cover. A vertical phone
    // snapshot and a landscape DSLR frame both land whole.
    expect(sharp.style.backgroundSize).toBe('contain');
    expect(sharp.style.backgroundRepeat).toBe('no-repeat');
  });

  it('prints nothing over the photograph', () => {
    const { container } = render(
      <VehicleIdentity variant="band" photo="https://example.test/car.jpg" {...M235i} />
    );

    // No tint, no scrim, no vignette — and the type belongs to the field, so
    // the vehicle's name must not be sitting on the photo either.
    expect(screen.queryByText('M235i')).not.toBeInTheDocument();
    expect(screen.queryByText('2015 BMW · Base')).not.toBeInTheDocument();

    const filters = Array.from(container.querySelectorAll<HTMLElement>('*'))
      .map((el) => el.style.filter)
      .filter(Boolean);
    // The only filter in the component is the blurred backdrop copy. Anything
    // else is a treatment applied to the sharp photograph.
    expect(filters).toEqual(['blur(34px) saturate(.8) brightness(.52)']);
  });

  it('falls back to the plate when the photo fails to load', () => {
    const { container } = render(
      <VehicleIdentity variant="band" photo="https://example.test/gone.jpg" {...M235i} />
    );

    expect(plate(container).dataset.hasPhoto).toBe('true');

    const probe = container.querySelector('img');
    expect(probe).toBeTruthy();
    fireEvent.error(probe!);

    // Whole no-photo state returns, not merely the image disappearing.
    expect(plate(container).dataset.hasPhoto).toBe('false');
    expect(container.querySelectorAll('img').length).toBe(0);
    expect(screen.getByText('M235i')).toBeInTheDocument();
  });

  it('gives a freshly signed URL another attempt', () => {
    const { container, rerender } = render(
      <VehicleIdentity variant="band" photo="https://example.test/s?token=a" {...M235i} />
    );

    fireEvent.error(container.querySelector('img')!);
    expect(plate(container).dataset.hasPhoto).toBe('false');

    rerender(
      <VehicleIdentity variant="band" photo="https://example.test/s?token=b" {...M235i} />
    );
    expect(plate(container).dataset.hasPhoto).toBe('true');
  });
});

describe('one answer to "what does a vehicle look like"', () => {
  it('gives card and band the same field for the same vehicle', () => {
    // The acceptance criterion is explicit: garage and dashboard render the
    // same vehicle with the same gradient field. One source of truth, not two
    // implementations that drift.
    const { container: card } = render(<VehicleIdentity variant="card" {...M235i} />);
    const { container: band } = render(<VehicleIdentity variant="band" {...M235i} />);

    expect(plate(card).style.background).toBe(plate(band).style.background);
  });

  it('gives different makes different fields', () => {
    const { container: bmw } = render(<VehicleIdentity variant="card" make="BMW" />);
    const { container: honda } = render(<VehicleIdentity variant="card" make="Honda" />);

    expect(plate(bmw).style.background).not.toBe(plate(honda).style.background);
  });

  it('honours the band height prop and the card aspect ratio', () => {
    const { container: band } = render(<VehicleIdentity variant="band" height={320} {...M235i} />);
    expect(plate(band).style.height).toBe('320px');

    const { container: card } = render(<VehicleIdentity variant="card" {...M235i} />);
    // 3:2, so a photo swapped in cannot change the card's height.
    expect(plate(card).style.aspectRatio.replace(/\s/g, '')).toBe('3/2');
  });
});
