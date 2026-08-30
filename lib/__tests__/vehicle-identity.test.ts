/**
 * The identity field is deterministic, and it stays inside its band.
 *
 * Two things make this worth testing rather than eyeballing.
 *
 * First, the design publishes three anchor values — BMW 297°, Subaru 259°,
 * Honda 233°. They pin the mapping completely: hash choice, case sensitivity
 * and span are all determined by them. A refactor that lowercases the make or
 * rounds the span to 145 still "works" and still produces pretty colours,
 * while silently changing the colour of every vehicle in the app. These
 * assertions are what makes that a red build.
 *
 * Second, the hue band exists by exclusion. Red, amber and green mean
 * something in this product — they are health bands. A decorative field that
 * wandered into one would make a car look unwell because of how its make is
 * spelled. That property has to hold for *arbitrary* makes, not the three we
 * thought of, so it is checked by sweep rather than by example.
 */

import {
  fnv1a,
  makeHue,
  vehicleField,
  isSemanticHue,
  HUE_MIN,
  HUE_MAX,
} from '@wellkept/core/vehicle-identity';

describe('the published anchors', () => {
  it.each([
    ['BMW', 297],
    ['Subaru', 259],
    ['Honda', 233],
  ])('%s maps to %i degrees', (make, hue) => {
    expect(makeHue(make)).toBe(hue);
  });

  it('is case sensitive, because the anchors were computed on the raw string', () => {
    // Not a nicety — lowercasing moves BMW off 297. If a caller normalises the
    // make upstream, the anchors have to be recomputed, deliberately.
    expect(makeHue('bmw')).not.toBe(makeHue('BMW'));
  });
});

describe('the band', () => {
  const MAKES = [
    'BMW', 'Subaru', 'Honda', 'Toyota', 'Ford', 'Chevrolet', 'Nissan', 'Mazda',
    'Volkswagen', 'Audi', 'Mercedes-Benz', 'Porsche', 'Lexus', 'Acura', 'Kia',
    'Hyundai', 'Volvo', 'Jaguar', 'Land Rover', 'Tesla', 'Rivian', 'Dodge',
    'Jeep', 'Ram', 'GMC', 'Cadillac', 'Buick', 'Lincoln', 'Mitsubishi', 'Genesis',
  ];

  it.each(MAKES)('%s lands inside 180-325', (make) => {
    const hue = makeHue(make);
    expect(hue).toBeGreaterThanOrEqual(HUE_MIN);
    expect(hue).toBeLessThanOrEqual(HUE_MAX);
  });

  it('never produces a semantic hue, across a wide sweep', () => {
    // 5,000 synthetic makes, not just the 30 real ones above. The band is a
    // closed interval that excludes red/amber/green by construction, so this
    // should be impossible — which is exactly the kind of claim worth pinning,
    // since widening the band later would break it silently.
    for (let i = 0; i < 5000; i++) {
      expect(isSemanticHue(makeHue(`make-${i}`))).toBe(false);
    }
  });

  it('recognises the semantic ranges it is avoiding', () => {
    // Guards the guard: if isSemanticHue were vacuously false, the sweep above
    // would pass no matter what makeHue returned.
    expect(isSemanticHue(20)).toBe(true); // critical red
    expect(isSemanticHue(80)).toBe(true); // attention amber
    expect(isSemanticHue(140)).toBe(true); // confirm green
    expect(isSemanticHue(297)).toBe(false); // BMW
  });
});

describe('the field as rendered', () => {
  it('is stable for the same make', () => {
    expect(vehicleField('BMW')).toEqual(vehicleField('BMW'));
  });

  it('keeps chroma inside the specified 0.9-1.26', () => {
    for (let i = 0; i < 2000; i++) {
      const { chromaFactor } = vehicleField(`make-${i}`);
      expect(chromaFactor).toBeGreaterThanOrEqual(0.9);
      expect(chromaFactor).toBeLessThanOrEqual(1.26);
    }
  });

  it('stays diagonal, so the field never reads as a bordered UI surface', () => {
    for (let i = 0; i < 2000; i++) {
      const { angle } = vehicleField(`make-${i}`);
      expect(angle).toBeGreaterThanOrEqual(115);
      expect(angle).toBeLessThanOrEqual(215);
    }
  });

  it('emits a usable linear-gradient with both stops', () => {
    const field = vehicleField('BMW');
    expect(field.gradient).toBe(
      `linear-gradient(${field.angle}deg, ${field.from} 0%, ${field.to} 100%)`
    );
    expect(field.from).toContain('oklch(');
    expect(field.to).toContain('oklch(');
  });

  it('gives an unknown make the midpoint, not the low end of the band', () => {
    // Otherwise every vehicle with no decoded make looks identical to whichever
    // real make happens to hash to 180.
    for (const empty of [null, undefined, '']) {
      expect(makeHue(empty)).toBe(253);
    }
  });

  it('separates makes that collide in hue by chroma or angle', () => {
    // The point of drawing chroma and angle from higher bits: a hue collision
    // should not be a visual collision.
    const byHue = new Map<number, string[]>();
    for (let i = 0; i < 3000; i++) {
      const make = `make-${i}`;
      const h = makeHue(make);
      byHue.set(h, [...(byHue.get(h) ?? []), make]);
    }

    const collisions = Array.from(byHue.values()).filter((g) => g.length > 1);
    expect(collisions.length).toBeGreaterThan(0); // 3000 makes into 146 hues

    for (const group of collisions) {
      const signatures = new Set(
        group.map((m: string) => {
          const f = vehicleField(m);
          return `${f.chromaFactor}:${f.angle}`;
        })
      );
      // Not all-distinct — that would be a stronger claim than the design makes.
      // But a hue bucket must not collapse to a single rendered appearance.
      expect(signatures.size).toBeGreaterThan(1);
    }
  });
});

describe('fnv1a itself', () => {
  it('matches the reference vectors', () => {
    // From the FNV spec. If Math.imul were replaced with `*`, long inputs drift
    // and these fail while short ones still pass.
    expect(fnv1a('')).toBe(2166136261);
    expect(fnv1a('a')).toBe(3826002220);
    expect(fnv1a('foobar')).toBe(3214735720);
  });
});
