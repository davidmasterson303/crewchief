/**
 * The hero falls back to its empty state when a photo fails to load.
 *
 * @jest-environment jsdom
 *
 * This is a regression test for a bug that shipped and stayed shipped for two
 * days. `vehicle-documents` went private, three upload sites kept persisting
 * `.getPublicUrl()` results, and every owner photo written after that held a
 * URL returning 400 "Bucket not found". The hero received a perfectly truthy
 * string, so it took the has-a-photo branch: two broken `<img>` elements, the
 * scan-line animation, and a label reading "Diagnostics Complete" over an image
 * that was never going to arrive.
 *
 * The stored-path convention fixes that cause. It does not fix the *class* —
 * an object can still be deleted out from under its row, and a signed URL is
 * minted without checking that the object behind it exists. A URL is not a
 * photograph, so the load failure is the only reliable signal, and this file
 * asserts the whole empty state comes back when it fires rather than only the
 * `<img>` disappearing.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import DiagnosticHero from '@/components/DiagnosticHero';

const VEHICLE_NAME = '2015 BMW M235i';

/** The `<img>` carrying the visible photo, as opposed to the mobile fill. */
function visibleImage(container: HTMLElement): HTMLImageElement {
  const img = container.querySelector('img.ph-img');
  if (!img) throw new Error('expected a rendered photo');
  return img as HTMLImageElement;
}

describe('DiagnosticHero, when a photo fails to load', () => {
  it('renders the photo while it is loading fine', () => {
    const { container } = render(
      <DiagnosticHero imageUrl="https://example.test/car.jpg" vehicleName={VEHICLE_NAME} />
    );

    expect(container.querySelectorAll('img').length).toBe(2);
    expect(container.querySelector('.photo-hero')).not.toHaveClass('ph-empty');
    expect(screen.queryByText('Add a photo')).not.toBeInTheDocument();
  });

  it('drops every trace of the photo when the image errors', () => {
    const { container } = render(
      <DiagnosticHero imageUrl="https://example.test/gone.jpg" vehicleName={VEHICLE_NAME} />
    );

    fireEvent.error(visibleImage(container));

    // No broken image survives — this is the part CC-142 §1 forbids outright.
    expect(container.querySelectorAll('img').length).toBe(0);

    // And the container actually takes the empty treatment, rather than
    // rendering a photo-shaped hole with no class to style it.
    expect(container.querySelector('.photo-hero')).toHaveClass('ph-empty');

    // The label has to follow too. "Diagnostics Complete" over an empty frame
    // is the same lie as a broken <img>, just quieter.
    expect(screen.getByText('Add a photo')).toBeInTheDocument();
  });

  it('gives a fresh URL for the same vehicle another chance', () => {
    const { container, rerender } = render(
      <DiagnosticHero imageUrl="https://example.test/signed?token=first" vehicleName={VEHICLE_NAME} />
    );

    fireEvent.error(visibleImage(container));
    expect(container.querySelectorAll('img').length).toBe(0);

    /*
      Signed URLs are re-minted roughly every 30 minutes. If the failure were
      remembered as a boolean, a transient error would blank the hero until the
      component unmounted — so what is remembered is the URL that failed, and a
      new one clears it without an effect or a key.
    */
    rerender(
      <DiagnosticHero imageUrl="https://example.test/signed?token=second" vehicleName={VEHICLE_NAME} />
    );

    expect(container.querySelectorAll('img').length).toBe(2);
    expect(screen.queryByText('Add a photo')).not.toBeInTheDocument();
  });

  it('shows the empty state when there is no photo at all', () => {
    const { container } = render(<DiagnosticHero vehicleName={VEHICLE_NAME} />);

    expect(container.querySelectorAll('img').length).toBe(0);
    expect(container.querySelector('.photo-hero')).toHaveClass('ph-empty');
    expect(screen.getByText('Add a photo')).toBeInTheDocument();
  });
});
