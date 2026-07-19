/**
 * Test Suite 3: RLS Ownership Verification
 *
 * Verifies that the application-layer ownership check logic (mirroring the
 * RLS user_owns_vehicle() function) correctly prevents cross-user data access.
 *
 * These tests simulate the ownership enforcement added to API routes such as
 * /api/load-vehicle and /api/load-maintenance-data.
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

describe('RLS Ownership: Cross-User Isolation', () => {
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
