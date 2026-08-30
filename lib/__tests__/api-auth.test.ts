/**
 * Authorization gate for vehicle-scoped API routes.
 *
 * @jest-environment node
 *
 * These tests are the regression net for the Phase 0 route fixes (tasks
 * 0.4, 0.5, 0.7). They assert the *decisions* `authorizeVehicleAccess` makes —
 * which client it hands back, and which callers it turns away — because that
 * decision is the only thing standing between a service-role client and an
 * unauthenticated caller.
 *
 * The Supabase layer is mocked: this is a unit test of the policy, not of
 * Postgres. RLS itself is verified separately against the live database.
 */

import { DEMO_VEHICLE_IDS } from '@wellkept/core/demo';

const REAL_VEHICLE_ID = 'd4e8b2a1-0000-4000-8000-000000000abc';
const OTHER_VEHICLE_ID = 'f1c3a5e7-0000-4000-8000-000000000def';
const USER_ID = 'aaaaaaaa-0000-4000-8000-000000000001';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetUser = jest.fn();
const mockOwnershipResult = jest.fn();

const serviceRoleClient = { __kind: 'service-role' };
const anonClient = { __kind: 'anon' };

jest.mock('@/lib/supabase', () => ({
  createServerActionClient: () => ({
    auth: { getUser: mockGetUser },
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: mockOwnershipResult }),
        }),
      }),
    }),
  }),
  getServerClient: () => anonClient,
  getServiceRoleClient: () => serviceRoleClient,
}));

jest.mock('@wellkept/core/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// Imported after the mocks are registered.
const { authorizeVehicleAccess } = require('@/lib/api-auth');

function signedInAs(userId: string) {
  mockGetUser.mockResolvedValue({ data: { user: { id: userId } }, error: null });
}

function signedOut() {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
}

function ownsVehicle(owns: boolean) {
  mockOwnershipResult.mockResolvedValue({
    data: owns ? { id: REAL_VEHICLE_ID } : null,
    error: null,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------

describe('authorizeVehicleAccess — input validation', () => {
  it('rejects a missing vehicleId with 400', async () => {
    const result = await authorizeVehicleAccess(undefined, { intent: 'read' });
    expect(result.ok).toBe(false);
    expect(result.response.status).toBe(400);
  });

  it('rejects a non-uuid vehicleId with 400', async () => {
    const result = await authorizeVehicleAccess('not-a-uuid', { intent: 'read' });
    expect(result.ok).toBe(false);
    expect(result.response.status).toBe(400);
  });

  it('does not consult the session for a malformed id', async () => {
    await authorizeVehicleAccess('nope', { intent: 'read' });
    expect(mockGetUser).not.toHaveBeenCalled();
  });
});

describe('authorizeVehicleAccess — demo vehicles', () => {
  it('allows anonymous reads and hands back the anon client, never service role', async () => {
    signedOut();
    const result = await authorizeVehicleAccess(DEMO_VEHICLE_IDS[0], { intent: 'read' });

    expect(result.ok).toBe(true);
    expect(result.isDemo).toBe(true);
    expect(result.userId).toBeNull();
    // The important half: a demo read must never receive an RLS-bypassing client.
    expect(result.client).toBe(anonClient);
    expect(result.client).not.toBe(serviceRoleClient);
  });

  it('rejects writes to demo vehicles with 403, even when signed in', async () => {
    signedInAs(USER_ID);
    const result = await authorizeVehicleAccess(DEMO_VEHICLE_IDS[0], { intent: 'write' });

    expect(result.ok).toBe(false);
    expect(result.response.status).toBe(403);
  });

  it('rejects writes to every seeded demo vehicle', async () => {
    signedInAs(USER_ID);
    for (const id of DEMO_VEHICLE_IDS) {
      const result = await authorizeVehicleAccess(id, { intent: 'write' });
      expect(result.ok).toBe(false);
      expect(result.response.status).toBe(403);
    }
  });

  it('does not require a session for a demo read', async () => {
    signedOut();
    await authorizeVehicleAccess(DEMO_VEHICLE_IDS[1], { intent: 'read' });
    expect(mockGetUser).not.toHaveBeenCalled();
  });
});

describe('authorizeVehicleAccess — real vehicles', () => {
  it('rejects an unauthenticated caller with 401', async () => {
    signedOut();
    const result = await authorizeVehicleAccess(REAL_VEHICLE_ID, { intent: 'read' });

    expect(result.ok).toBe(false);
    expect(result.response.status).toBe(401);
  });

  it('rejects an unauthenticated write with 401', async () => {
    signedOut();
    const result = await authorizeVehicleAccess(REAL_VEHICLE_ID, { intent: 'write' });

    expect(result.ok).toBe(false);
    expect(result.response.status).toBe(401);
  });

  it('rejects a signed-in caller who does not own the vehicle with 404', async () => {
    signedInAs(USER_ID);
    ownsVehicle(false);

    const result = await authorizeVehicleAccess(OTHER_VEHICLE_ID, { intent: 'read' });

    expect(result.ok).toBe(false);
    expect(result.response.status).toBe(404);
  });

  it('uses 404 rather than 403 for a non-owned vehicle, so existence cannot be probed', async () => {
    signedInAs(USER_ID);
    ownsVehicle(false);

    const notOwned = await authorizeVehicleAccess(OTHER_VEHICLE_ID, { intent: 'read' });
    const body = await notOwned.response.json();

    expect(notOwned.response.status).toBe(404);
    expect(body.error).toBe('Vehicle not found');
  });

  it('grants the owner access and hands back the service-role client', async () => {
    signedInAs(USER_ID);
    ownsVehicle(true);

    const result = await authorizeVehicleAccess(REAL_VEHICLE_ID, { intent: 'write' });

    expect(result.ok).toBe(true);
    expect(result.isDemo).toBe(false);
    expect(result.userId).toBe(USER_ID);
    expect(result.client).toBe(serviceRoleClient);
  });

  it('checks ownership before returning a privileged client', async () => {
    signedInAs(USER_ID);
    ownsVehicle(false);

    const result = await authorizeVehicleAccess(REAL_VEHICLE_ID, { intent: 'write' });

    expect(result.ok).toBe(false);
    expect(mockOwnershipResult).toHaveBeenCalled();
    expect((result as any).client).toBeUndefined();
  });

  it('fails closed when the ownership lookup errors', async () => {
    signedInAs(USER_ID);
    mockOwnershipResult.mockResolvedValue({
      data: null,
      error: { message: 'connection reset' },
    });

    const result = await authorizeVehicleAccess(REAL_VEHICLE_ID, { intent: 'read' });

    expect(result.ok).toBe(false);
    expect(result.response.status).toBe(500);
  });

  it('treats an auth error as unauthenticated', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'jwt expired' },
    });

    const result = await authorizeVehicleAccess(REAL_VEHICLE_ID, { intent: 'read' });

    expect(result.ok).toBe(false);
    expect(result.response.status).toBe(401);
  });
});
