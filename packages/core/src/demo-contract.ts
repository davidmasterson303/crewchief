/**
 * What the public demo requires in order to work.
 *
 * The demo at crewchief-demo.davidmasterson.co is linked from David's
 * portfolio and is being shown to recruiters. It must keep working while the
 * authenticated product is built around it. Treat any change that breaks this
 * contract as a release blocker, not a regression to fix later.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 *
 * The demo and the product pull in opposite directions. Everything Phase 0
 * and 1 added — route middleware, session-gated server actions, RLS keyed to
 * ownership — assumes an authenticated user. The demo has none, and survives
 * on explicit carve-outs scattered across the codebase.
 *
 * That already failed once: the middleware added in task 0.9 protected
 * /dashboard wholesale and bounced anonymous visitors from the demo to
 * /login. It was caught by loading the page in a browser, not by any test.
 *
 * So the requirements live here, in one place, and are checked twice:
 *
 *   lib/__tests__/demo-availability.test.ts   static — runs in CI
 *   scripts/verify-demo.mjs                   live  — run before any cutover
 *
 * Both import this file. Adding a requirement in one place tightens both.
 */

/** The three seeded demo vehicles. Mirrors lib/demo.ts. */
export const DEMO_VEHICLE_IDS = [
  'a1000000-0000-0000-0000-000000000001',
  'a2000000-0000-0000-0000-000000000002',
  'a3000000-0000-0000-0000-000000000003',
] as const;

/** Pages an anonymous visitor must be able to reach. */
export const PUBLIC_DEMO_ROUTES = [
  '/',
  '/demo',
  `/dashboard/${DEMO_VEHICLE_IDS[0]}`,
  `/consultant/${DEMO_VEHICLE_IDS[0]}`,
  `/documents/${DEMO_VEHICLE_IDS[0]}`,
  `/vehicle-info/${DEMO_VEHICLE_IDS[0]}`,
] as const;

/**
 * Tables the browser reads directly with the anon key.
 *
 * The dashboard and consultant pages query Supabase client-side rather than
 * through an API route, so these need both a table-level SELECT grant for
 * `anon` AND an RLS policy admitting is_demo rows. Revoking either silently
 * empties part of the page — the queries use maybeSingle(), so a 401 returns
 * null and the UI renders with a hole rather than an error.
 */
export const ANON_READ_TABLES = {
  /** Confirmed reachable by anon. Breaking these visibly breaks the demo. */
  required: [
    'vehicles',
    'vehicle_health_summary',
    'nhtsa_data',
    'wishlist_items',
    // Closed 26 Jul by 20260726140000. vehicle_knowledge_base needed only the
    // SELECT grant — its policy was already demo-scoped. recall_actions had no
    // demo clause at all and needed a policy too. Verified live afterwards.
    'vehicle_knowledge_base',
    'recall_actions',
  ],
  /**
   * Tables the demo queries that anon cannot read.
   *
   * Empty as of 26 July 2026. It previously held vehicle_knowledge_base and
   * recall_actions, which 401'd for eight weeks without anyone noticing: the
   * client queries use maybeSingle(), so a 401 resolves to null and the page
   * renders with a hole rather than an error.
   *
   * Anything landing here again is a silent demo degradation. Prefer fixing
   * it to recording it.
   */
  knownGaps: [] as string[],
} as const;

/**
 * Content that must appear for the demo to count as working.
 * Used by the live verifier — cheap, stable strings, not brittle selectors.
 */
export const DEMO_SMOKE_EXPECTATIONS = {
  demoPage: {
    path: '/demo',
    mustContain: ['Honda', 'Subaru', 'BMW'],
    minLength: 2000,
  },
  dashboard: {
    path: `/dashboard/${DEMO_VEHICLE_IDS[0]}`,
    mustContain: ['Accord'],
    minLength: 2000,
  },
} as const;

/**
 * Facts the consultant must be able to state about a demo vehicle.
 *
 * The round-trip gate asks the live consultant a real question and checks the
 * answer contains at least one of these. They are anchored **here, next to the
 * ids they describe**, rather than hardcoded in the gate — §23 is a worked
 * example of demo seed data being corrected, and a gate that fails because the
 * seed was *fixed* is a gate people learn to distrust.
 *
 * Sourced from `supabase/migrations/20260314142241_seed_demo_vehicles.sql`:
 * the WRX is seeded at 41200 miles with a "Stage 1 tune" ownership objective,
 * and its knowledge base carries the Stage 1 / rod bearing material. Per §22's
 * related finding the demo model receives the knowledge base and recall data,
 * which is exactly where these live — so they are answerable, not hopeful.
 *
 * If the seed changes, change these with it. That is the point of them being
 * adjacent.
 */
export const CONSULTANT_ROUND_TRIP = {
  /** The WRX — chosen because its seed data is the most distinctive. */
  vehicleId: DEMO_VEHICLE_IDS[1],
  question: 'What mileage is this car at, and what engine modifications does it have?',
  /** At least one must appear in the answer for the round trip to count. */
  expectedTokens: ['41,200', '41200', 'Stage 1', 'Stage 1 tune'],
} as const;

export function isDemoVehicleId(id: string): boolean {
  return (DEMO_VEHICLE_IDS as readonly string[]).includes(id);
}
