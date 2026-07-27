/**
 * Ownership rules, as a model. **This suite does not test RLS.**
 *
 * It was called "RLS Ownership Verification", which it is not and has never
 * been. Everything below runs against `mockVehicleDb` and the
 * `userOwnsVehicle` / `simulate*` helpers defined in this file — a hand-written
 * restatement of the intended rules. No policy, no database, and no route
 * handler is exercised. Renamed because the old title made this the second
 * appearance of the pattern `middleware.ts` warns about in its own header
 * comment: 11 green tests in `security.test.ts` asserting protection the
 * exported middleware did not have.
 *
 * That is not idle: the `vehicles` table's own policies are
 * `USING (true)` for SELECT, INSERT, UPDATE and DELETE as of migration
 * `20260103030740`, and nothing replaces them. The simulation below has been
 * green that entire time. See
 * `supabase/migrations/20260727150000_scope_vehicles_rls_to_owner.sql`.
 *
 * The model is still worth keeping — it is a readable statement of what the
 * rules are supposed to be, and `lib/__tests__/api-auth.test.ts` covers the
 * layer that really enforces them for API routes. What it cannot tell you is
 * whether the database agrees, and the browser client talks to the database
 * directly (`hooks/useVehicles.ts`, `components/VehicleCard.tsx`).
 */

const USER_A_ID = 'user-a-00000000-0000-0000-0000-000000000001';
const USER_B_ID = 'user-b-00000000-0000-0000-0000-000000000002';

const DEMO_VEHICLE_IDS = [
  'a1000000-0000-0000-0000-000000000001',
  'a2000000-0000-0000-0000-000000000002',
];

interface MockVehicle {
  id: string;
  user_id: string;
  year: number;
  make: string;
  model: string;
  is_demo: boolean;
}

const mockVehicleDb: MockVehicle[] = [
  { id: 'vehicle-a1', user_id: USER_A_ID, year: 2020, make: 'BMW', model: 'M235i', is_demo: false },
  { id: 'vehicle-b1', user_id: USER_B_ID, year: 2019, make: 'Jaguar', model: 'F-Type', is_demo: false },
  { id: DEMO_VEHICLE_IDS[0], user_id: '', year: 2021, make: 'Ford', model: 'Mustang', is_demo: true },
];

function userOwnsVehicle(vehicleId: string, userId: string): boolean {
  const vehicle = mockVehicleDb.find(v => v.id === vehicleId);
  if (!vehicle) return false;
  return vehicle.user_id === userId;
}

function simulateLoadVehicle(vehicleId: string, authenticatedUserId: string | null): {
  status: number;
  body: { success?: boolean; error?: string; vehicle?: MockVehicle };
} {
  if (!vehicleId) {
    return { status: 400, body: { success: false, error: 'Missing vehicleId' } };
  }

  const isDemo = DEMO_VEHICLE_IDS.includes(vehicleId);

  if (!isDemo) {
    if (!authenticatedUserId) {
      return { status: 401, body: { success: false, error: 'Unauthorized' } };
    }

    if (!userOwnsVehicle(vehicleId, authenticatedUserId)) {
      return { status: 404, body: { success: false, error: 'Vehicle not found' } };
    }
  }

  const vehicle = mockVehicleDb.find(v => v.id === vehicleId);
  if (!vehicle) {
    return { status: 404, body: { success: false, error: 'Vehicle not found' } };
  }

  return { status: 200, body: { success: true, vehicle } };
}

function simulateGetAllVehicles(authenticatedUserId: string | null): {
  status: number;
  vehicles: MockVehicle[];
} {
  if (!authenticatedUserId) {
    return { status: 401, vehicles: [] };
  }

  const userVehicles = mockVehicleDb.filter(
    v => v.user_id === authenticatedUserId && !v.is_demo
  );

  return { status: 200, vehicles: userVehicles };
}

describe('Ownership model (simulation — not RLS, not the real routes)', () => {
  describe('simulateLoadVehicle: ownership enforcement', () => {
    it('allows User A to load their own vehicle', () => {
      const result = simulateLoadVehicle('vehicle-a1', USER_A_ID);
      expect(result.status).toBe(200);
      expect(result.body.vehicle?.id).toBe('vehicle-a1');
    });

    it('prevents User A from loading User B vehicle (returns 404, not 403, to avoid enumeration)', () => {
      const result = simulateLoadVehicle('vehicle-b1', USER_A_ID);
      expect(result.status).toBe(404);
      expect(result.body.vehicle).toBeUndefined();
    });

    it('prevents User B from loading User A vehicle', () => {
      const result = simulateLoadVehicle('vehicle-a1', USER_B_ID);
      expect(result.status).toBe(404);
    });

    it('returns 401 when user is not authenticated', () => {
      const result = simulateLoadVehicle('vehicle-a1', null);
      expect(result.status).toBe(401);
      expect(result.body.error).toBe('Unauthorized');
    });

    it('allows unauthenticated access to demo vehicles', () => {
      const result = simulateLoadVehicle(DEMO_VEHICLE_IDS[0], null);
      expect(result.status).toBe(200);
      expect(result.body.vehicle?.is_demo).toBe(true);
    });

    it('allows authenticated access to demo vehicles regardless of ownership', () => {
      const result = simulateLoadVehicle(DEMO_VEHICLE_IDS[0], USER_A_ID);
      expect(result.status).toBe(200);
    });

    it('returns 400 when vehicleId is empty string', () => {
      const result = simulateLoadVehicle('', USER_A_ID);
      expect(result.status).toBe(400);
    });
  });

  describe('simulateGetAllVehicles: user-scoped vehicle list', () => {
    it('returns only User A vehicles for User A', () => {
      const result = simulateGetAllVehicles(USER_A_ID);
      expect(result.status).toBe(200);
      expect(result.vehicles.every(v => v.user_id === USER_A_ID)).toBe(true);
    });

    it('returns only User B vehicles for User B', () => {
      const result = simulateGetAllVehicles(USER_B_ID);
      expect(result.status).toBe(200);
      expect(result.vehicles.every(v => v.user_id === USER_B_ID)).toBe(true);
    });

    it('does not return User B vehicles in User A results', () => {
      const result = simulateGetAllVehicles(USER_A_ID);
      const vehicleIds = result.vehicles.map(v => v.id);
      expect(vehicleIds).not.toContain('vehicle-b1');
    });

    it('does not return demo vehicles in user vehicle list', () => {
      const result = simulateGetAllVehicles(USER_A_ID);
      expect(result.vehicles.some(v => v.is_demo)).toBe(false);
    });

    it('returns 401 for unauthenticated request', () => {
      const result = simulateGetAllVehicles(null);
      expect(result.status).toBe(401);
      expect(result.vehicles).toHaveLength(0);
    });

    it('returns empty array for a user with no vehicles', () => {
      const result = simulateGetAllVehicles('user-with-no-vehicles');
      expect(result.status).toBe(200);
      expect(result.vehicles).toHaveLength(0);
    });
  });

  describe('cross-contamination: verify complete isolation', () => {
    it('User A and User B vehicle sets are completely disjoint', () => {
      const userAVehicles = simulateGetAllVehicles(USER_A_ID).vehicles.map(v => v.id);
      const userBVehicles = simulateGetAllVehicles(USER_B_ID).vehicles.map(v => v.id);
      const overlap = userAVehicles.filter(id => userBVehicles.includes(id));
      expect(overlap).toHaveLength(0);
    });
  });
});
