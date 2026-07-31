/**
 * The mobile contract's photo guarantee.
 *
 * @jest-environment node
 *
 * `/api/v1/load-vehicle` used to `select('*')`, which handed a caller the raw
 * `custom_image_url` column — a `placeholder://` storage path that no client
 * outside this repo can resolve. Phase 2.9 item 4.
 *
 * The guarantee is narrow and worth stating exactly: whatever happens, the
 * resolved value is a URL something can render, or null. Never the stored
 * scheme. These tests exist because that is a promise to a client that does
 * not exist yet and therefore cannot complain.
 */

import { resolveVehiclePhoto, resolveVehiclePhotos } from '../vehicle-photo';
import { STORED_URL_SCHEME, storedUrl } from '@crewchief/core/storage-paths';
import { DEMO_UNPHOTOGRAPHED_VEHICLE_IDS } from '@crewchief/core/demo';

const VEHICLE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_VEHICLE_ID = '22222222-2222-4222-8222-222222222222';

/** A Supabase stand-in whose signing outcome each test chooses. */
function clientThatSigns(outcome: { url?: string; error?: unknown; throws?: boolean }) {
  return {
    storage: {
      from: () => ({
        createSignedUrl: async () => {
          if (outcome.throws) throw new Error('network');
          if (outcome.error) return { data: null, error: outcome.error };
          return { data: { signedUrl: outcome.url }, error: null };
        },
      }),
    },
  } as never;
}

describe('resolveVehiclePhoto', () => {
  it('signs an owner photo stored as a path', async () => {
    const result = await resolveVehiclePhoto(
      VEHICLE_ID,
      { custom_image_url: storedUrl(`${VEHICLE_ID}/photos/car.jpg`), image_url: '/vehicles/stock.jpg' },
      clientThatSigns({ url: 'https://signed.example/car.jpg?token=abc' })
    );

    expect(result).toBe('https://signed.example/car.jpg?token=abc');
  });

  it('prefers the owner photo over the stock image, matching useVehicleImage', async () => {
    const result = await resolveVehiclePhoto(
      VEHICLE_ID,
      { custom_image_url: storedUrl(`${VEHICLE_ID}/photos/mine.jpg`), image_url: '/vehicles/stock.jpg' },
      clientThatSigns({ url: 'https://signed.example/mine.jpg' })
    );

    expect(result).not.toBe('/vehicles/stock.jpg');
  });

  it('passes through a value that is already renderable', async () => {
    const result = await resolveVehiclePhoto(
      VEHICLE_ID,
      { custom_image_url: null, image_url: '/vehicles/accord.jpg' },
      clientThatSigns({ url: 'unused' })
    );

    expect(result).toBe('/vehicles/accord.jpg');
  });

  it('returns null when there is no photo at all', async () => {
    const result = await resolveVehiclePhoto(
      VEHICLE_ID,
      { custom_image_url: null, image_url: null },
      clientThatSigns({ url: 'unused' })
    );

    expect(result).toBeNull();
  });

  it('honours the deliberately unphotographed demo car', async () => {
    // That car still carries a seeded image_url; the carve-out has to win.
    const result = await resolveVehiclePhoto(
      DEMO_UNPHOTOGRAPHED_VEHICLE_IDS[0],
      { custom_image_url: null, image_url: '/vehicles/m3.jpg' },
      clientThatSigns({ url: 'unused' })
    );

    expect(result).toBeNull();
  });

  /*
    The security half. A signed URL bypasses RLS for its lifetime, so a row
    whose custom_image_url points at another vehicle's object must not get that
    object signed under this vehicle's proven ownership.
  */
  it('refuses to sign a path scoped to a different vehicle', async () => {
    const result = await resolveVehiclePhoto(
      VEHICLE_ID,
      {
        custom_image_url: storedUrl(`${OTHER_VEHICLE_ID}/photos/not-mine.jpg`),
        image_url: '/vehicles/stock.jpg',
      },
      clientThatSigns({ url: 'https://signed.example/LEAKED.jpg' })
    );

    expect(result).toBe('/vehicles/stock.jpg');
    expect(result).not.toContain('LEAKED');
  });

  describe('never emits the stored scheme', () => {
    const cases: Array<[string, Parameters<typeof resolveVehiclePhoto>[1], ReturnType<typeof clientThatSigns>]> = [
      [
        'when signing fails',
        { custom_image_url: storedUrl(`${VEHICLE_ID}/photos/a.jpg`), image_url: null },
        clientThatSigns({ error: { message: 'nope' } }),
      ],
      [
        'when signing throws',
        { custom_image_url: storedUrl(`${VEHICLE_ID}/photos/a.jpg`), image_url: null },
        clientThatSigns({ throws: true }),
      ],
      [
        'when the path is scoped to another vehicle',
        { custom_image_url: storedUrl(`${OTHER_VEHICLE_ID}/photos/a.jpg`), image_url: null },
        clientThatSigns({ url: 'https://signed.example/x.jpg' }),
      ],
      [
        'when the stored value is a bare scheme with no path',
        { custom_image_url: STORED_URL_SCHEME, image_url: null },
        clientThatSigns({ url: 'https://signed.example/x.jpg' }),
      ],
    ];

    it.each(cases)('%s', async (_label, columns, client) => {
      const result = await resolveVehiclePhoto(VEHICLE_ID, columns, client);

      expect(result ?? '').not.toContain(STORED_URL_SCHEME);
    });
  });
});

/**
 * The batch resolver, for `/api/v1/vehicles`.
 *
 * A garage is many vehicles, and signing one photo per round trip is the N+1
 * that makes a phone's garage screen feel broken. The interesting property is
 * not that it is faster — it is that it must reach *the same verdict* as the
 * single resolver on every input, since the two now serve the same screen on
 * two clients.
 */
describe('resolveVehiclePhotos', () => {
  /** Records what it was asked to sign, so the N+1 claim is testable. */
  function batchClient(outcome: {
    urls?: (string | null)[];
    error?: unknown;
    throws?: boolean;
    calls?: { paths: string[][] };
  }) {
    return {
      storage: {
        from: () => ({
          createSignedUrls: async (paths: string[]) => {
            outcome.calls?.paths.push(paths);
            if (outcome.throws) throw new Error('network');
            if (outcome.error) return { data: null, error: outcome.error };
            return {
              data: paths.map((path, i) => ({
                path,
                signedUrl: outcome.urls?.[i] ?? `https://signed.example/${path}`,
                error: null,
              })),
              error: null,
            };
          },
        }),
      },
    } as never;
  }

  it('signs every stored photo in one round trip', async () => {
    const calls = { paths: [] as string[][] };
    const result = await resolveVehiclePhotos(
      [
        { id: VEHICLE_ID, custom_image_url: storedUrl(`${VEHICLE_ID}/photos/a.jpg`), image_url: null },
        {
          id: OTHER_VEHICLE_ID,
          custom_image_url: storedUrl(`${OTHER_VEHICLE_ID}/photos/b.jpg`),
          image_url: null,
        },
      ],
      batchClient({ calls })
    );

    expect(calls.paths).toHaveLength(1);
    expect(calls.paths[0]).toEqual([
      `${VEHICLE_ID}/photos/a.jpg`,
      `${OTHER_VEHICLE_ID}/photos/b.jpg`,
    ]);
    expect(result.get(VEHICLE_ID)).toContain('signed.example');
    expect(result.get(OTHER_VEHICLE_ID)).toContain('signed.example');
  });

  it('makes no storage call when nothing needs signing', async () => {
    const calls = { paths: [] as string[][] };
    const result = await resolveVehiclePhotos(
      [{ id: VEHICLE_ID, custom_image_url: null, image_url: '/vehicles/stock.jpg' }],
      batchClient({ calls })
    );

    expect(calls.paths).toHaveLength(0);
    expect(result.get(VEHICLE_ID)).toBe('/vehicles/stock.jpg');
  });

  it('keeps results with their own vehicle when only some need signing', async () => {
    // The ordering bug this shape exists to catch: unsigned entries are not in
    // the request array, so a naive index-into-the-input mapping shifts every
    // signed URL onto the wrong car.
    const third = '33333333-3333-4333-8333-333333333333';
    const result = await resolveVehiclePhotos(
      [
        { id: VEHICLE_ID, custom_image_url: null, image_url: '/vehicles/stock.jpg' },
        {
          id: OTHER_VEHICLE_ID,
          custom_image_url: storedUrl(`${OTHER_VEHICLE_ID}/photos/b.jpg`),
          image_url: null,
        },
        { id: third, custom_image_url: storedUrl(`${third}/photos/c.jpg`), image_url: null },
      ],
      batchClient({})
    );

    expect(result.get(VEHICLE_ID)).toBe('/vehicles/stock.jpg');
    expect(result.get(OTHER_VEHICLE_ID)).toContain(`${OTHER_VEHICLE_ID}/photos/b.jpg`);
    expect(result.get(third)).toContain(`${third}/photos/c.jpg`);
  });

  it('refuses to sign a path scoped to a different vehicle', async () => {
    const result = await resolveVehiclePhotos(
      [
        {
          id: VEHICLE_ID,
          custom_image_url: storedUrl(`${OTHER_VEHICLE_ID}/photos/not-mine.jpg`),
          image_url: '/vehicles/stock.jpg',
        },
      ],
      batchClient({ urls: ['https://signed.example/LEAKED.jpg'] })
    );

    expect(result.get(VEHICLE_ID)).toBe('/vehicles/stock.jpg');
  });

  describe('never emits the stored scheme', () => {
    const stored = { id: VEHICLE_ID, custom_image_url: storedUrl(`${VEHICLE_ID}/photos/a.jpg`), image_url: null };

    it('when the batch call fails', async () => {
      const result = await resolveVehiclePhotos([stored], batchClient({ error: { message: 'nope' } }));

      expect(result.get(VEHICLE_ID) ?? '').not.toContain(STORED_URL_SCHEME);
      expect(result.has(VEHICLE_ID)).toBe(true);
    });

    it('when the batch call throws', async () => {
      const result = await resolveVehiclePhotos([stored], batchClient({ throws: true }));

      expect(result.get(VEHICLE_ID) ?? '').not.toContain(STORED_URL_SCHEME);
    });

    it('when one entry in the batch fails while others succeed', async () => {
      const failing = {
        storage: {
          from: () => ({
            createSignedUrls: async (paths: string[]) => ({
              data: paths.map((path, i) =>
                i === 0
                  ? { path, signedUrl: null, error: 'not found' }
                  : { path, signedUrl: `https://signed.example/${path}`, error: null }
              ),
              error: null,
            }),
          }),
        },
      } as never;

      const result = await resolveVehiclePhotos(
        [
          stored,
          {
            id: OTHER_VEHICLE_ID,
            custom_image_url: storedUrl(`${OTHER_VEHICLE_ID}/photos/b.jpg`),
            image_url: '/vehicles/stock.jpg',
          },
        ],
        failing
      );

      expect(result.get(VEHICLE_ID)).toBeNull();
      expect(result.get(OTHER_VEHICLE_ID)).toContain('signed.example');
    });
  });

  it('agrees with the single resolver on the same input', async () => {
    /*
      The property that matters. Two functions deciding which photo a car has
      is the recurring bug in this codebase; they share `planVehiclePhoto`
      precisely so they cannot diverge, and this asserts that rather than
      trusting it.
    */
    const inputs = [
      { custom_image_url: null, image_url: '/vehicles/stock.jpg' },
      { custom_image_url: null, image_url: null },
      { custom_image_url: STORED_URL_SCHEME, image_url: '/vehicles/stock.jpg' },
      { custom_image_url: storedUrl(`${OTHER_VEHICLE_ID}/photos/x.jpg`), image_url: '/vehicles/stock.jpg' },
      { custom_image_url: 'https://external.example/car.jpg', image_url: null },
    ];

    for (const columns of inputs) {
      const single = await resolveVehiclePhoto(VEHICLE_ID, columns, clientThatSigns({ url: 'https://signed.example/s.jpg' }));
      const batch = await resolveVehiclePhotos([{ id: VEHICLE_ID, ...columns }], batchClient({}));

      expect(batch.get(VEHICLE_ID)).toBe(single);
    }
  });
});
