/**
 * The mobile contract's body assertions, probed with real violations.
 *
 * @jest-environment node
 *
 * `verify-mobile-contract.mjs` asserts things about live responses, so its own
 * correctness cannot be established by running it — a green run against a
 * healthy deployment proves nothing about whether it would catch a sick one.
 * The detectors are therefore pure, live in `scripts/lib/response-contract.mjs`,
 * and are checked here against the exact response shapes that shipped broken.
 *
 * Phase 3.0 task 3.0.3.
 */

import {
  findUnresolvableUrls,
  findMissingFields,
  findLeakedFields,
  STORED_URL_SCHEME as SCRIPT_SCHEME,
} from '../../scripts/lib/response-contract.mjs';
import { STORED_URL_SCHEME } from '@crewchief/core/storage-paths';

describe('the copied scheme constant', () => {
  it('still matches the one the app uses', () => {
    // The script cannot import the TypeScript package, so the constant is
    // duplicated. This is the thing that makes that safe.
    expect(SCRIPT_SCHEME).toBe(STORED_URL_SCHEME);
  });
});

describe('findUnresolvableUrls', () => {
  /*
    The real body: /api/v1/load-vehicle before 2eb172a, and /api/v1/vehicles
    before 572ad18. Both select('*'), both shipping a private-bucket path the
    caller has no way to resolve and no way to diagnose.
  */
  it('catches the select(*) response that shipped for weeks', () => {
    const body = {
      success: true,
      vehicle: {
        id: 'v1',
        make: 'BMW',
        custom_image_url: 'placeholder://v1/photos/m235i.jpg',
      },
    };

    expect(findUnresolvableUrls(body)).toEqual([
      'vehicle.custom_image_url = placeholder://v1/photos/m235i.jpg',
    ]);
  });

  it('finds one inside a list, and says which element', () => {
    const body = {
      vehicles: [
        { id: 'a', photo_url: 'https://signed.example/a.jpg' },
        { id: 'b', photo_url: 'placeholder://b/photos/b.jpg' },
      ],
    };

    expect(findUnresolvableUrls(body)).toEqual([
      'vehicles[1].photo_url = placeholder://b/photos/b.jpg',
    ]);
  });

  it('finds one nested under a joined table, where nobody is looking', () => {
    // The reason this is recursive: the next instance will not be on the
    // column anyone remembers to check.
    const body = { vehicles: [{ documents: [{ file_url: 'placeholder://x/docs/inv.pdf' }] }] };

    expect(findUnresolvableUrls(body)).toEqual([
      'vehicles[0].documents[0].file_url = placeholder://x/docs/inv.pdf',
    ]);
  });

  it('passes a response whose photos are signed or absent', () => {
    const body = {
      success: true,
      vehicles: [
        { id: 'a', photo_url: 'https://signed.example/a.jpg?token=x' },
        { id: 'b', photo_url: null },
        { id: 'c', photo_url: '/vehicles/stock.jpg' },
      ],
    };

    expect(findUnresolvableUrls(body)).toEqual([]);
  });

  it('is not fooled by a string that merely mentions the scheme', () => {
    // An error message quoting a bad value is not itself a leak, and flagging
    // it would train someone to ignore this check.
    const body = { error: 'could not resolve placeholder:// path' };

    expect(findUnresolvableUrls(body)).toEqual([]);
  });

  it('handles null and primitives without throwing', () => {
    expect(findUnresolvableUrls(null)).toEqual([]);
    expect(findUnresolvableUrls({ a: null, b: 3, c: true })).toEqual([]);
  });
});

describe('findMissingFields', () => {
  it('reports what a client would have read and did not get', () => {
    expect(findMissingFields({ id: 'a', make: 'BMW' }, ['id', 'make', 'model'])).toEqual(['model']);
  });

  it('counts an explicit null as present', () => {
    // `photo_url: null` is "this car has no photo" — a real answer. Treating
    // it as missing would make the check fire on healthy responses.
    expect(findMissingFields({ photo_url: null }, ['photo_url'])).toEqual([]);
  });

  it('reports everything when the object is missing entirely', () => {
    expect(findMissingFields(undefined, ['id', 'make'])).toEqual(['id', 'make']);
  });
});

describe('findLeakedFields', () => {
  it('catches a stripped column that came back', () => {
    expect(findLeakedFields({ id: 'a', custom_image_url: null }, ['custom_image_url'])).toEqual([
      'custom_image_url',
    ]);
  });

  it('fires even when the leaked column is null', () => {
    // The point: a null custom_image_url today is a placeholder:// tomorrow,
    // and by then the value check is the only thing standing in the way.
    expect(findLeakedFields({ custom_image_url: null }, ['custom_image_url'])).toHaveLength(1);
  });

  it('passes a response that stripped it', () => {
    expect(findLeakedFields({ id: 'a', photo_url: null }, ['custom_image_url'])).toEqual([]);
  });
});
