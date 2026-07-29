/**
 * Proportion-grid conformance for the vehicle illustration set.
 *
 * @jest-environment jsdom
 *
 * Pass 1 failed its own acceptance test — at 48px, sedan / coupe / sports /
 * small SUV / wagon / generic were interchangeable — because every shape shared
 * a stance while the differences lived in detail that vanishes at that size.
 * Rev 1's answer is a shared grid of three roof heights and two clearances.
 *
 * **This file is what makes the grid load-bearing rather than documentation.**
 * It renders the real components and measures the real paths, so a future edit
 * that nudges a roofline back toward the pack fails here instead of silently
 * un-fixing the review.
 */

import { render } from '@testing-library/react';
import {
  ILLUSTRATION_BY_STYLE,
  VEHICLE_BODY_STYLES,
} from '@/components/vehicle-illustrations';
import { GRID } from '@/components/vehicle-illustrations/shapes';
import { ROOF, SILL, WHEEL_R, GROUND_Y } from '@/components/vehicle-illustrations/VehicleIllustration';
import type { VehicleBodyStyle } from '@crewchief/core/vehicle-body-style';

interface Point {
  x: number;
  y: number;
}

/**
 * Every coordinate in a body path.
 *
 * Safe only because the set is restricted to absolute `M`/`L`/`C`/`Z`, all of
 * which take x,y pairs — which the first test below enforces. A relative
 * command or an `H`/`V`/`A` would silently mis-pair every number after it and
 * turn this whole file into a false pass.
 */
function points(d: string): Point[] {
  // An exec loop rather than matchAll: the package tsconfig targets a version
  // where spreading an iterator needs downlevelIteration.
  const re = /-?\d+(?:\.\d+)?/g;
  const nums: number[] = [];
  for (let m = re.exec(d); m; m = re.exec(d)) nums.push(Number(m[0]));

  const out: Point[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) out.push({ x: nums[i], y: nums[i + 1] });
  return out;
}

/** Render a style and read back its body path and wheel radii. */
function measure(style: VehicleBodyStyle) {
  const Illustration = ILLUSTRATION_BY_STYLE[style];
  const { container, unmount } = render(<Illustration size={200} />);
  const svg = container.querySelector('svg')!;
  const d = svg.querySelector('path')!.getAttribute('d')!;
  const radii = Array.from(svg.querySelectorAll('circle')).map((c) =>
    Number(c.getAttribute('r'))
  );
  unmount();

  const pts = points(d);
  const ys = pts.map((p) => p.y);
  const xs = pts.map((p) => p.x);
  const roofY = Math.min(...ys);

  return {
    d,
    pts,
    roofY,
    sillY: Math.max(...ys),
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    /** Flat run at full height — a long plateau reads as a box, a short one as a cab. */
    plateau: (() => {
      const at = pts.filter((p) => p.y === roofY).map((p) => p.x);
      return Math.max(...at) - Math.min(...at);
    })(),
    /** Outer wheel radius. The inner hub circle is always the smaller of the pair. */
    wheelR: Math.max(...radii),
  };
}

describe('paths stay parseable', () => {
  it.each(VEHICLE_BODY_STYLES)('%s uses only absolute M/L/C/Z', (style) => {
    const { d, pts } = measure(style);
    // Anything else either mis-pairs the coordinate stream or bypasses the grid.
    expect(d).not.toMatch(/[HhVvAaSsQqTtmlcz]/);
    expect(d.trim().startsWith('M')).toBe(true);
    expect(d.trim().endsWith('Z')).toBe(true);
    expect(pts.length).toBeGreaterThan(4);
  });
});

describe('every shape lands on the grid', () => {
  const graded = VEHICLE_BODY_STYLES.filter((s) => GRID[s].roof !== null);

  it('has a grid entry for all twelve styles', () => {
    expect(Object.keys(GRID).sort()).toEqual([...VEHICLE_BODY_STYLES].sort());
  });

  it.each(graded)('%s roof sits exactly on its declared height', (style) => {
    const { roof } = GRID[style];
    expect(measure(style).roofY).toBe(ROOF[roof!]);
  });

  const stanced = VEHICLE_BODY_STYLES.filter(
    (s) => GRID[s].stance !== null && s !== 'motorcycle'
  );

  it.each(stanced)('%s sill sits exactly on its declared clearance', (style) => {
    const { stance } = GRID[style];
    expect(measure(style).sillY).toBe(SILL[stance!]);
  });

  it.each(stanced)('%s wheel radius matches its stance group', (style) => {
    const { stance } = GRID[style];
    expect(measure(style).wheelR).toBe(WHEEL_R[stance!]);
  });

  it('gives the raised group visible air under the body', () => {
    /*
      The point of the RAISED group. If this gap ever equals the CAR gap the
      SUVs and pickups stop reading as raised, which is precisely how pass 1's
      small SUV came to look like a sedan.
    */
    const carGap = SILL.CAR;
    const raisedGap = SILL.RAISED;
    expect(GROUND_Y - raisedGap).toBeGreaterThan(GROUND_Y - carGap);
    expect(WHEEL_R.RAISED).toBeGreaterThan(WHEEL_R.CAR);
  });

  it('keeps all three roof heights meaningfully apart', () => {
    /*
      Steps, not a continuum — a continuum is how six shapes converged. Stated
      as height above the ground rather than as raw y, because y is inverted
      here and a signed comparison on it is easy to write backwards.
    */
    const height = (roof: number) => GROUND_Y - roof;
    expect(height(ROOF.STANDARD) - height(ROOF.LOW)).toBeGreaterThanOrEqual(8);
    expect(height(ROOF.TALL) - height(ROOF.STANDARD)).toBeGreaterThanOrEqual(8);
  });

  it('never draws below the ground line', () => {
    for (const style of VEHICLE_BODY_STYLES) {
      expect(measure(style).sillY).toBeLessThan(GROUND_Y);
    }
  });
});

describe('no two shapes are interchangeable', () => {
  /**
   * A structural fingerprint: the five measurements that still read at 48px.
   * Detail is deliberately excluded — it is not what distinguishes these.
   */
  function signature(style: VehicleBodyStyle) {
    const m = measure(style);
    return [m.roofY, m.sillY, m.wheelR, m.plateau, m.maxX - m.minX].join('/');
  }

  it('gives all twelve a distinct profile', () => {
    const seen = new Map<string, VehicleBodyStyle>();
    const collisions: string[] = [];
    for (const style of VEHICLE_BODY_STYLES) {
      const sig = signature(style);
      const prior = seen.get(sig);
      if (prior) collisions.push(`${prior} and ${style} share ${sig}`);
      seen.set(sig, style);
    }
    expect(collisions).toEqual([]);
  });

  /*
    The six the review named. These are regression cases, not general ones —
    each pair was called interchangeable at 48px, so each needs a difference
    that survives being 48px wide.
  */
  const NAMED_IN_REVIEW: Array<[VehicleBodyStyle, VehicleBodyStyle]> = [
    ['sedan', 'suv-small'],
    ['sedan', 'wagon'],
    ['sedan', 'generic'],
    ['sedan', 'coupe'],
    ['coupe', 'sports'],
    ['suv-small', 'suv-large'],
    ['pickup-2door', 'pickup-4door'],
    ['minivan', 'van'],
  ];

  it.each(NAMED_IN_REVIEW)('%s and %s differ structurally', (a, b) => {
    const ma = measure(a);
    const mb = measure(b);

    /*
      At least one of stance, roof height or plateau length must differ by a
      margin that is still visible when the art is 48px wide — 200 viewBox units
      map to 48px, so 8 units is about 2 physical pixels. Below that it is not a
      distinction a person can use.
    */
    const diffs = [
      Math.abs(ma.roofY - mb.roofY),
      Math.abs(ma.sillY - mb.sillY),
      Math.abs(ma.plateau - mb.plateau),
      Math.abs(ma.maxX - ma.minX - (mb.maxX - mb.minX)),
    ];
    expect(Math.max(...diffs)).toBeGreaterThanOrEqual(8);
  });
});

describe('accessibility survives the redraw', () => {
  it.each(VEHICLE_BODY_STYLES)('%s exposes a titled img role', (style) => {
    const Illustration = ILLUSTRATION_BY_STYLE[style];
    const { getByRole, unmount } = render(<Illustration size={48} />);
    const svg = getByRole('img');
    const titleId = svg.getAttribute('aria-labelledby');
    expect(titleId).toBeTruthy();
    expect(svg.querySelector(`#${titleId}`)?.textContent).toMatch(/^Illustration of a /);
    unmount();
  });
});
