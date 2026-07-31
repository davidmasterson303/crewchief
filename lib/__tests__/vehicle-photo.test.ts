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

import { resolveVehiclePhoto } from '../vehicle-photo';
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
