/**
 * Marking a recall repaired.
 *
 * @jest-environment node
 *
 * ── What is worth asserting about this route ────────────────────────────────
 *
 * Not that an upsert calls `upsert`. Three things, and each of them is a
 * decision somebody could reasonably reverse without noticing what it cost:
 *
 *   - **Authorization runs before anything is read from the body**, and a demo
 *     vehicle cannot be written to. This is the one route in the product where
 *     a write is a claim about a safety defect.
 *   - **The date is the server's.** A body-supplied `addressedAt` would let a
 *     phone with a wrong clock stamp "repaired in 2019" onto a 2024 campaign.
 *   - **`DELETE` exists and works.** A claim an owner can make and cannot
 *     unmake is a trap, and this is the tap most worth being able to undo.
 *
 * The campaign-number check gets its own block because it is the one string a
 * client controls that reaches a `TEXT` column with a `UNIQUE` constraint.
 */

jest.mock('@/lib/supabase', () => ({
  getServiceRoleClient: jest.fn(),
  getServerClient: jest.fn(),
}));
jest.mock('@/lib/api-auth', () => ({ authorizeVehicleAccess: jest.fn() }));
jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn().mockResolvedValue({ allowed: true }),
  getClientIdentifier: jest.fn().mockReturnValue('test'),
  rateLimitResponse: jest.fn(),
}));

import { NextRequest } from 'next/server';

import { getServiceRoleClient } from '@/lib/supabase';
import { authorizeVehicleAccess } from '@/lib/api-auth';
import { DELETE, GET, POST } from '@/app/api/v1/recalls/route';

const serviceRole = getServiceRoleClient as jest.Mock;
const authorize = authorizeVehicleAccess as jest.Mock;

const VEHICLE = '11111111-2222-3333-4444-555555555555';

/** The last upsert/delete this client was handed, so a test can read it. */
interface Seen {
  upserts: unknown[];
  deleteFilters: Array<[string, unknown]>;
}

function client(rows: unknown[] = []): Seen {
  const seen: Seen = { upserts: [], deleteFilters: [] };

  serviceRole.mockReturnValue({
    from: () => ({
      select: () => ({
        eq: () => ({ order: () => Promise.resolve({ data: rows, error: null }) }),
      }),
      upsert: (values: unknown) => {
        seen.upserts.push(values);
        return Promise.resolve({ error: null });
      },
      delete: () => {
        const chain = {
          eq: (column: string, value: unknown) => {
            seen.deleteFilters.push([column, value]);
            return chain;
          },
          then: (resolve: (r: { error: null }) => void) => resolve({ error: null }),
        };
        return chain;
      },
    }),
  });

  return seen;
}

function post(body: unknown): NextRequest {
  return new NextRequest('https://crewchief.test/api/v1/recalls', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  authorize.mockResolvedValue({ ok: true, isDemo: false, userId: 'u1', client: {} });
});

describe('authorization comes first', () => {
  it('refuses before it reads the body', async () => {
    // The shape every other v1 route uses. A route that parsed first would be
    // one edit away from acting on an unauthorized body.
    authorize.mockResolvedValue({
      ok: false,
      response: Response.json({ error: 'Unauthorized' }, { status: 401 }),
    });
    client();

    const response = await POST(post({ vehicleId: VEHICLE, campaignNumber: '23V-441' }));

    expect(response.status).toBe(401);
    expect(serviceRole).not.toHaveBeenCalled();
  });

  it('asks for write access, not read, on both mutations', async () => {
    client();

    await POST(post({ vehicleId: VEHICLE, campaignNumber: '23V-441' }));
    expect(authorize).toHaveBeenLastCalledWith(VEHICLE, { intent: 'write' });

    await DELETE(
      new NextRequest(
        `https://crewchief.test/api/v1/recalls?vehicleId=${VEHICLE}&campaignNumber=23V-441`,
        { method: 'DELETE' }
      )
    );
    expect(authorize).toHaveBeenLastCalledWith(VEHICLE, { intent: 'write' });
  });

  it('reads with read intent, so a demo car can be looked at', async () => {
    /*
      `authorizeVehicleAccess` refuses a demo id outright for `write` and hands
      back the anon client for `read`. A demo vehicle therefore has no marks and
      can gain none, which reads as an empty list — the truth, rather than a
      special case in here.
    */
    client();
    await GET(new NextRequest(`https://crewchief.test/api/v1/recalls?vehicleId=${VEHICLE}`));

    expect(authorize).toHaveBeenCalledWith(VEHICLE, { intent: 'read' });
  });
});

describe('the mark itself', () => {
  it('stamps the server date and never the client one', async () => {
    /*
      ⚠ This is a safety record. A body-supplied date would let a phone with a
      wrong clock — or anything holding a token — write "repaired in 2019" onto
      a campaign issued in 2024.
    */
    const seen = client();

    await POST(
      post({ vehicleId: VEHICLE, campaignNumber: '23V-441', addressedAt: '2019-01-01' })
    );

    const [written] = seen.upserts as Array<Record<string, unknown>>;
    expect(written.addressed_at).not.toBe('2019-01-01');
    expect(written.addressed_at).toBe(new Date().toISOString().slice(0, 10));
    expect(written).toMatchObject({ vehicle_id: VEHICLE, campaign_number: '23V-441' });
  });

  it('gives the campaign and the date back, so a client need not guess', async () => {
    client();
    const body = await (
      await POST(post({ vehicleId: VEHICLE, campaignNumber: '23V-441' }))
    ).json();

    expect(body.addressed).toMatchObject({ campaignNumber: '23V-441' });
    expect(body.addressed.addressedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('undoes a mark on the vehicle and campaign it was asked about', async () => {
    // Both filters, and this is the assertion that matters: a delete scoped to
    // the campaign alone would clear that campaign on every car in the table.
    const seen = client();

    await DELETE(
      new NextRequest(
        `https://crewchief.test/api/v1/recalls?vehicleId=${VEHICLE}&campaignNumber=23V-441`,
        { method: 'DELETE' }
      )
    );

    expect(seen.deleteFilters).toEqual([
      ['vehicle_id', VEHICLE],
      ['campaign_number', '23V-441'],
    ]);
  });

  it('reads the marks back as the clients expect them', async () => {
    client([{ campaign_number: '23V-441', addressed_at: '2026-08-23' }]);

    const body = await (
      await GET(new NextRequest(`https://crewchief.test/api/v1/recalls?vehicleId=${VEHICLE}`))
    ).json();

    expect(body.addressed).toEqual([
      { campaignNumber: '23V-441', addressedAt: '2026-08-23' },
    ]);
  });
});

describe('the campaign number, which is the one string a client controls', () => {
  it.each([
    ['missing', undefined],
    ['not a string', 42],
    ['empty', '   '],
    ['longer than any campaign', 'A'.repeat(41)],
    ['carrying a quote', "23V-441'; drop"],
    ['carrying a newline', '23V-441\n441'],
  ])('refuses one that is %s', async (_label, value) => {
    const seen = client();

    const response = await POST(post({ vehicleId: VEHICLE, campaignNumber: value }));

    expect(response.status).toBe(400);
    expect(seen.upserts).toHaveLength(0);
  });

  it.each(['23V-441', 'PE24-012', '21V100', 'NHTSA 23V-441'])(
    'accepts %s, because NHTSA has changed its numbering before',
    async (value) => {
      /*
        Anti-vacuous, and it is the half that matters more. A check strict
        enough to refuse a genuine campaign would refuse the safety notice —
        which is why this is bounded and character-checked rather than matched
        against a format.
      */
      const seen = client();
      const response = await POST(post({ vehicleId: VEHICLE, campaignNumber: value }));

      expect(response.status).toBe(200);
      expect(seen.upserts).toHaveLength(1);
    }
  );

  it('refuses a body that is not JSON at all', async () => {
    client();
    const response = await POST(
      new NextRequest('https://crewchief.test/api/v1/recalls', { method: 'POST', body: 'nope' })
    );

    expect(response.status).toBe(400);
  });
});
