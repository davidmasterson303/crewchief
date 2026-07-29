/**
 * vPIC `BodyClass` + `Doors` → illustration style.
 *
 * @jest-environment node
 *
 * The mapping tests the illustration ticket asks for. What makes them worth
 * writing rather than eyeballing is that `BodyClass` is free-ish text which
 * varies by manufacturer submission — the ordering of the substring tests is
 * load-bearing, and every case below is one a later reorder would break
 * silently.
 */

import {
  resolveBodyStyle,
  VEHICLE_BODY_STYLES,
  BODY_STYLE_LABEL,
} from '@crewchief/core/vehicle-body-style';

describe('the values vPIC actually returns', () => {
  it.each([
    ['Sedan/Saloon', 4, 'sedan'],
    ['Coupe', 2, 'coupe'],
    ['Convertible/Cabriolet', 2, 'sports'],
    ['Roadster', 2, 'sports'],
    ['Station Wagon', 4, 'wagon'],
    ['Pickup', 2, 'pickup-2door'],
    ['Pickup', 4, 'pickup-4door'],
    ['Minivan', 4, 'minivan'],
    ['Van', 3, 'van'],
    ['Motorcycle', null, 'motorcycle'],
  ])('%s with %s doors -> %s', (bodyClass, doors, expected) => {
    expect(resolveBodyStyle(bodyClass, doors)).toBe(expected);
  });

  it('handles the real decode this feature was built against', () => {
    // WBA1J9C5XFVX99145 — 2015 BMW M235i, vPIC says Coupe.
    expect(resolveBodyStyle('Coupe', '2')).toBe('coupe');
  });
});

describe('ordering that a later edit would break', () => {
  it('reads "Minivan" as a minivan, not a van', () => {
    // "Minivan" contains "van"; the general test would swallow it.
    expect(resolveBodyStyle('Minivan', 4)).toBe('minivan');
  });

  it('reads vPIC\'s combined SUV/MPV label as an SUV', () => {
    /*
      vPIC folds these into one string. It contains "MPV", which would
      otherwise route to minivan — and almost every vehicle carrying this
      label is an SUV.
    */
    expect(
      resolveBodyStyle('Sport Utility Vehicle (SUV)/Multi-Purpose Vehicle (MPV)', 4)
    ).toBe('suv-small');
  });

  it('reads "Station Wagon" as a wagon, not a sedan', () => {
    expect(resolveBodyStyle('Station Wagon', 4)).toBe('wagon');
  });

  it('reads a pickup as a pickup even when the label also says truck', () => {
    expect(resolveBodyStyle('Truck-Pickup', 4)).toBe('pickup-4door');
  });
});

describe('doors override the marketing name', () => {
  it('treats a four-door coupe as a sedan', () => {
    // A "4-door coupe" is a marketing shape, not a body style.
    expect(resolveBodyStyle('Coupe', 4)).toBe('sedan');
  });

  it('treats a two-door sedan as a coupe', () => {
    expect(resolveBodyStyle('Sedan/Saloon', 2)).toBe('coupe');
  });

  it('assumes a crew cab when the door count is missing', () => {
    // The common modern shape, and a better guess than the generic fallback.
    expect(resolveBodyStyle('Pickup')).toBe('pickup-4door');
    expect(resolveBodyStyle('Pickup', null)).toBe('pickup-4door');
  });
});

describe('SUV size, which vPIC does not give us', () => {
  it('defaults to small', () => {
    /*
      There is no size field on the standard decode. Small is the safer
      default: a compact drawn for a large SUV is a modest mistake, the
      reverse looks like the app does not know what you own.
    */
    expect(resolveBodyStyle('Sport Utility Vehicle (SUV)', 4)).toBe('suv-small');
  });

  it.each(['Full-Size SUV', 'Large Sport Utility Vehicle', 'SUV, 3-Row'])(
    'reads size words when a manufacturer submits them: %s',
    (bodyClass) => {
      expect(resolveBodyStyle(bodyClass, 4)).toBe('suv-large');
    }
  );
});

describe('anything unrecognised falls back rather than guessing', () => {
  it.each([null, undefined, '', 'Incomplete Chassis Cab', 'Trailer', '???'])(
    '%s -> generic',
    (bodyClass) => {
      expect(resolveBodyStyle(bodyClass as string | null | undefined)).toBe('generic');
    }
  );

  it('ignores a door count it cannot parse', () => {
    expect(resolveBodyStyle('Sedan/Saloon', 'not a number')).toBe('sedan');
  });

  it('is case-insensitive, because submissions are inconsistent', () => {
    expect(resolveBodyStyle('SEDAN/SALOON', 4)).toBe('sedan');
    expect(resolveBodyStyle('pickup', 2)).toBe('pickup-2door');
  });
});

describe('the set is complete and self-describing', () => {
  it('has twelve styles', () => {
    expect(VEHICLE_BODY_STYLES).toHaveLength(12);
  });

  it('labels every one, for the accessible title', () => {
    for (const style of VEHICLE_BODY_STYLES) {
      expect(BODY_STYLE_LABEL[style]).toBeTruthy();
    }
  });

  it('can produce every style from some real input', () => {
    /*
      Guards against drawing a shape nothing can ever route to. Each entry is
      an input the mapping should genuinely resolve to that style.
    */
    const reachable: Array<[string, number | null, string]> = [
      ['Sedan/Saloon', 4, 'sedan'],
      ['Coupe', 2, 'coupe'],
      ['Convertible/Cabriolet', 2, 'sports'],
      ['Pickup', 2, 'pickup-2door'],
      ['Pickup', 4, 'pickup-4door'],
      ['Minivan', 4, 'minivan'],
      ['Van', 3, 'van'],
      ['Sport Utility Vehicle (SUV)', 4, 'suv-small'],
      ['Full-Size SUV', 4, 'suv-large'],
      ['Motorcycle', null, 'motorcycle'],
      ['Station Wagon', 4, 'wagon'],
      ['Trailer', null, 'generic'],
    ];

    for (const [bodyClass, doors, expected] of reachable) {
      expect(resolveBodyStyle(bodyClass, doors)).toBe(expected);
    }
    expect(new Set(reachable.map((r) => r[2])).size).toBe(VEHICLE_BODY_STYLES.length);
  });
});
