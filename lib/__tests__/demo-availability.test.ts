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
} from '@wellkept/core/demo-contract';
import {
  DEMO_VEHICLE_IDS as APP_DEMO_IDS,
  DEMO_UNPHOTOGRAPHED_VEHICLE_IDS,
  isDemoVehicleId,
} from '@wellkept/core/demo';
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

  it('has no outstanding gaps — every table the demo queries is readable', () => {
    // Was ['vehicle_knowledge_base', 'recall_actions'], closed 26 Jul.
    // A table appearing here means part of the demo renders empty without
    // erroring, which is how the last pair went unnoticed for eight weeks.
    expect(ANON_READ_TABLES.knownGaps).toEqual([]);
  });

  it('guards all five tables the demo dashboard queries client-side', () => {
    // The dashboard queries these directly with the anon key. Losing the
    // grant on any of them empties part of the page silently, because the
    // queries use maybeSingle() and a 401 resolves to null.
    for (const table of [
      'vehicles',
      'vehicle_knowledge_base',
      'nhtsa_data',
      'vehicle_health_summary',
      'recall_actions',
    ]) {
      expect(ANON_READ_TABLES.required).toContain(table);
    }
  });

  it('never lists a table as both required and a known gap', () => {
    const overlap = ANON_READ_TABLES.required.filter((t) =>
      (ANON_READ_TABLES.knownGaps as readonly string[]).includes(t)
    );
    expect(overlap).toEqual([]);
  });
});

/**
 * The live verifier is a .mjs script and cannot import this .ts contract, so
 * it re-declares the table list. That duplication already drifted once: both
 * gaps were closed in the contract while the script still announced them as
 * open, so a passing run printed two misleading warnings.
 *
 * Comparing the source text is unglamorous but it is the only thing that
 * actually binds the two together without a build step.
 */
describe('verify-demo.mjs stays in step with the contract', () => {
  const script = readFileSync(
    join(__dirname, '..', '..', 'scripts', 'verify-demo.mjs'),
    'utf8'
  );

  it('checks exactly the tables the contract marks required', () => {
    const block = script.match(/const REQUIRED_ANON_TABLES = \[([\s\S]*?)\];/);
    expect(block).not.toBeNull();

    const listed = (block![1].match(/'[a-z_]+'/g) ?? []).map((s) => s.slice(1, -1));
    expect(listed.sort()).toEqual([...ANON_READ_TABLES.required].sort());
  });

  it('agrees on which demo car is deliberately unphotographed', () => {
    /*
      The script reports that car as "deliberately unphotographed" instead of
      asserting its image_url resolves. If the two lists drift, it either claims
      a photograph the app does not render, or checks a file for a car that has
      none — both of which are the script lying about the demo, which is the one
      thing it exists not to do.
    */
    const block = script.match(/const DEMO_UNPHOTOGRAPHED_VEHICLE_IDS = \[([\s\S]*?)\];/);
    expect(block).not.toBeNull();

    const listed = (block![1].match(/'[0-9a-f-]+'/g) ?? []).map((s) => s.slice(1, -1));
    expect(listed.sort()).toEqual([...DEMO_UNPHOTOGRAPHED_VEHICLE_IDS].sort());
  });

  it('drops the known-gap branch once the contract records no gaps', () => {
    // A gap list in the script with nothing in the contract to justify it
    // means the script is reporting a state that no longer exists.
    if (ANON_READ_TABLES.knownGaps.length === 0) {
      expect(script).not.toContain('KNOWN_GAP_TABLES');
    }
  });
});
