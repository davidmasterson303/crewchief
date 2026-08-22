/**
 * A VIN that is already registered belongs to somebody, and it matters who.
 *
 * @jest-environment node
 *
 * ── The dead end this is written against ────────────────────────────────────
 *
 * Found 22 Aug by entering a VIN another account already held. The screen said
 * **"This vehicle is already in your garage"**, waited two seconds, and then
 * **bounced to the garage with no message at all**.
 *
 * The lookup ran on the service-role client with no `user_id` filter, so it
 * searched every account — and `vehicles.vin` is `UNIQUE` across the table, so
 * the row it found was as likely to be a stranger's as the caller's. It then
 * returned that stranger's `vehicleId`, which the form navigates to.
 *
 * ⚠ **Authorization held.** `authorizeVehicleAccess` refused the dashboard,
 * which is why the user landed back at the garage and why nothing leaked. The
 * bounce was the last line of defence doing its job about a journey that
 * should never have started. Nothing here weakens that check; the fix is two
 * layers earlier, where the wrong vehicle was chosen.
 */

jest.mock('@/lib/supabase', () => ({
  getServiceRoleClient: jest.fn(),
  createServerActionClient: jest.fn(),
}));
jest.mock('@/lib/api-auth', () => ({
  requireSession: jest.fn(),
  requireCaller: jest.fn(),
  authorizeVehicleAccess: jest.fn(),
}));

import { getServiceRoleClient } from '@/lib/supabase';
import { requireSession } from '@/lib/api-auth';
import { decodeVIN } from '@/app/actions';

const serviceRole = getServiceRoleClient as jest.Mock;
const session = requireSession as jest.Mock;

const CALLER = 'user-caller';
const VIN = '1HGCM56633A000000';

/** Every `.eq()` pair seen, in order, across all queries of this client. */
type Filters = Array<[string, string]>;

/**
 * A client whose `vehicles` lookups answer from `rows`, matching on whatever
 * filters the query actually applied.
 *
 * That is the point: the assertion is about the **filter the code chose**, so
 * the stub must honour filters rather than return a fixed row.
 */
function clientWithVehicles(rows: Array<{ id: string; vin: string; user_id: string }>) {
  const seen: Filters[] = [];

  const from = jest.fn(() => {
    const filters: Filters = [];
    seen.push(filters);

    const chain: Record<string, unknown> = {
      select: jest.fn(() => chain),
      eq: jest.fn((column: string, value: string) => {
        filters.push([column, value]);
        return chain;
      }),
      maybeSingle: jest.fn(async () => {
        const match = rows.find((row) =>
          filters.every(([column, value]) => (row as Record<string, string>)[column] === value)
        );
        return { data: match ?? null, error: null };
      }),
    };

    return chain;
  });

  return { client: { from }, seen };
}

beforeEach(() => {
  jest.clearAllMocks();
  session.mockResolvedValue({ ok: true, userId: CALLER });
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({
      Results: [{ ErrorCode: '0', ModelYear: '2003', Make: 'HONDA', Model: 'Accord', Trim: 'EX' }],
    }),
  })) as unknown as typeof fetch;
});

describe('a VIN held by another account', () => {
  const strangersCar = { id: 'their-vehicle', vin: VIN, user_id: 'somebody-else' };

  it('does not claim it is in the caller’s garage', async () => {
    // The sentence asserted ownership the query had never established.
    serviceRole.mockReturnValue(clientWithVehicles([strangersCar]).client);

    const result = await decodeVIN(VIN);

    expect(result.success).toBe(false);
    expect(result.error).not.toMatch(/in your garage/i);
    /*
      ⚠ Pinned against the refusal this test would otherwise accept. Without a
      client stub the action throws, the catch returns "check your internet
      connection", and every assertion above passes while the branch under test
      never runs. Found by writing it that way first.
    */
    expect(result.error).not.toMatch(/internet connection/i);
  });

  it('never hands back the other account’s vehicle id', async () => {
    /*
      ⚠ The assertion that removes the dead end. `vehicleId` is what the form
      redirects on, and there is nowhere to send this person — the vehicle is
      not theirs to open. Returning it produced a two-second wait followed by
      an unexplained bounce.
    */
    serviceRole.mockReturnValue(clientWithVehicles([strangersCar]).client);

    const result = await decodeVIN(VIN);

    expect(result).not.toHaveProperty('vehicleId');
  });

  it('says what happened and what to do about it', async () => {
    serviceRole.mockReturnValue(clientWithVehicles([strangersCar]).client);

    const result = await decodeVIN(VIN);

    expect(result.error).toMatch(/another CrewChief account/i);
    // Somebody who has just bought the car needs a path, not a closed door.
    expect(result.error).toMatch(/@/);
  });

  it('discloses no identifier for the other account or its vehicle', async () => {
    /*
      The message admits a VIN is registered, which is the minimum needed to
      explain the refusal. It must not name the owner or the row.
    */
    serviceRole.mockReturnValue(clientWithVehicles([strangersCar]).client);

    const result = await decodeVIN(VIN);

    expect(result.error).not.toContain('their-vehicle');
    expect(result.error).not.toContain('somebody-else');
  });

  it('scopes the ownership question to the caller', async () => {
    /*
      The root cause, asserted directly: the first lookup must filter on
      `user_id`. Without it the query answers "does anyone have this VIN",
      which is a different question from the one the copy answers.
    */
    const { client, seen } = clientWithVehicles([strangersCar]);
    serviceRole.mockReturnValue(client);

    await decodeVIN(VIN);

    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]).toContainEqual(['user_id', CALLER]);
  });
});

describe('a VIN the caller already owns', () => {
  it('still offers the vehicle to redirect to', async () => {
    /*
      ⚠ Anti-vacuous, and the behaviour worth keeping. "You already have this
      car, here it is" is a good outcome — the fix must not turn the caller's
      own vehicle into a refusal with nowhere to go.
    */
    serviceRole.mockReturnValue(
      clientWithVehicles([{ id: 'my-vehicle', vin: VIN, user_id: CALLER }]).client
    );

    const result = await decodeVIN(VIN);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/in your garage/i);
    expect(result.vehicleId).toBe('my-vehicle');
  });
});

describe('a VIN nobody has', () => {
  it('decodes it', async () => {
    // The ordinary path, and the check that neither branch above swallows it.
    serviceRole.mockReturnValue(clientWithVehicles([]).client);

    const result = await decodeVIN(VIN);

    expect(result.success).toBe(true);
    expect(result.vehicle).toMatchObject({ make: 'HONDA', model: 'Accord', year: 2003 });
    expect(global.fetch).toHaveBeenCalled();
  });
});
