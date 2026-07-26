/**
 * Demo availability — release blocker, not a nice-to-have.
 *
 * @jest-environment node
 *
 * The public demo is linked from David's portfolio and shown to recruiters
 * during an active job search. It has to keep working while an authenticated
 * product is built around it.
 *
 * These assert the code-level half of `lib/demo-contract.ts`: that the auth
 * machinery still lets an anonymous visitor through. The other half — that a
 * deployed build actually renders — is `scripts/verify-demo.mjs`, which has
 * to run against a real URL and so cannot live here.
 *
 * This exists because the guarantee previously depended on remembering. The
 * middleware in task 0.9 protected /dashboard wholesale and bounced anonymous
 * visitors from the demo to /login; nothing failed, and it was only caught by
 * loading the page by hand.
 */

import {
  DEMO_VEHICLE_IDS,
  PUBLIC_DEMO_ROUTES,
  ANON_READ_TABLES,
  isDemoVehicleId as contractIsDemoVehicleId,
} from '@/lib/demo-contract';
import { DEMO_VEHICLE_IDS as APP_DEMO_IDS, isDemoVehicleId } from '@/lib/demo';
import { isProtectedRoute, resolveRoute, PROTECTED_ROUTES } from '@/middleware';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');

describe('demo contract stays in sync with the app', () => {
  it('declares the same demo vehicle ids as lib/demo.ts', () => {
    // Two sources of truth would drift, and the drift would be invisible
    // until the demo silently stopped exempting the right vehicles.
    expect([...DEMO_VEHICLE_IDS]).toEqual([...APP_DEMO_IDS]);
  });

  it('agrees with the app on what counts as a demo vehicle', () => {
    for (const id of DEMO_VEHICLE_IDS) {
      expect(isDemoVehicleId(id)).toBe(true);
      expect(contractIsDemoVehicleId(id)).toBe(true);
    }
    expect(isDemoVehicleId('d4e8b2a1-0000-4000-8000-000000000abc')).toBe(false);
  });
});

describe('anonymous visitors can reach every demo route', () => {
  it.each([...PUBLIC_DEMO_ROUTES])('%s is not gated behind auth', (route) => {
    expect(isProtectedRoute(route)).toBe(false);
    expect(
      resolveRoute({
        pathname: route,
        isAuthenticated: false,
        requestUrl: `http://localhost:3000${route}`,
      }).type
    ).toBe('next');
  });

  it('still protects the same sections for a non-demo vehicle', () => {
    // The carve-out must be keyed to the demo ids, not to the URL section —
    // otherwise "make the demo work" quietly unprotects every user's data.
    const real = '/dashboard/d4e8b2a1-0000-4000-8000-000000000abc';
    expect(isProtectedRoute(real)).toBe(true);
  });

  it('keeps every demo section out of a bare PROTECTED_ROUTES match', () => {
    // Guards the specific regression: adding a section to PROTECTED_ROUTES
    // without the demo id check bounced anonymous visitors to /login.
    for (const section of PROTECTED_ROUTES) {
      const demoPath = `${section}/${DEMO_VEHICLE_IDS[0]}`;
      // Index routes like /garage have no vehicle id and stay protected.
      if (section === '/garage' || section === '/onboard' || section === '/settings') continue;
      expect(isProtectedRoute(demoPath)).toBe(false);
    }
  });
});

describe('demo data is readable but never writable', () => {
  // The three demo vehicles are shared by every anonymous visitor. A write
  // path would let one visitor alter what the next recruiter sees — which is
  // why a reseed migration already exists in this repo.
  const authAuthSource = readFileSync(join(ROOT, 'lib', 'api-auth.ts'), 'utf8');

  it('rejects writes to demo vehicles in the authorization gate', () => {
    expect(authAuthSource).toMatch(/intent === 'write'/);
    expect(authAuthSource).toMatch(/Demo vehicles are read-only/);
  });

  it('hands demo reads the anon client, never the service-role client', () => {
    // Order matters: the demo branch must return before the service-role
    // client is reachable.
    const demoBranch = authAuthSource.indexOf('isDemoVehicleId(vehicleId)');
    const serviceRole = authAuthSource.indexOf('client: getServiceRoleClient()');
    expect(demoBranch).toBeGreaterThanOrEqual(0);
    expect(serviceRole).toBeGreaterThan(demoBranch);
  });
});

describe('anon-readable table list is explicit', () => {
  it('records the tables the demo depends on', () => {
    expect(ANON_READ_TABLES.required).toContain('vehicles');
    expect(ANON_READ_TABLES.required).toContain('vehicle_health_summary');
  });

  it('keeps the known gaps visible rather than silently broken', () => {
    // These are queried by the demo dashboard but 401 for anon today. Listed
    // so the degradation is documented rather than discovered by a recruiter.
    // Remove an entry only when the grant is actually restored.
    expect(ANON_READ_TABLES.knownGaps).toEqual([
      'vehicle_knowledge_base',
      'recall_actions',
    ]);
  });

  it('never lists a table as both required and a known gap', () => {
    const overlap = ANON_READ_TABLES.required.filter((t) =>
      (ANON_READ_TABLES.knownGaps as readonly string[]).includes(t)
    );
    expect(overlap).toEqual([]);
  });
});
