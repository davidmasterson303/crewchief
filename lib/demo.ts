/**
 * Demo identity — portable.
 *
 * The cookie *name* lives here because it is just a string; the functions that
 * read and write it are in `lib/demo-mode.ts`, which is browser-only. Keeping
 * them apart is what lets this module, `lib/routes.ts` and
 * `lib/auth-session.ts` into the shared package.
 */
export const DEMO_COOKIE = 'crewchief_demo';
export const DEMO_VEHICLE_IDS = [
  'a1000000-0000-0000-0000-000000000001',
  'a2000000-0000-0000-0000-000000000002',
  'a3000000-0000-0000-0000-000000000003',
] as const;

export function isDemoVehicleId(vehicleId: string): boolean {
  return DEMO_VEHICLE_IDS.includes(vehicleId as any);
}

/*
 * The three demo cars, as local files.
 *
 * These were live `images.pexels.com` URLs at `w=800` — a third-party runtime
 * dependency on the recruiter-facing demo, and too small for a page-width hero.
 * The licensed masters now ship in `public/vehicles/`, provenance in
 * `public/vehicles/CREDITS.md`.
 *
 * Why this map still exists, and why it is temporary: `VehicleCard` overrides
 * demo vehicles with it, while `DiagnosticHero` reads `vehicles.image_url` from
 * the database. That is two sources of truth for one photograph, and it is why
 * the hero and the card could disagree. Migration
 * `20260726230000_local_demo_photos_and_focal_points.sql` sets the same paths in
 * the database; once it has been applied everywhere, this map and the override
 * in VehicleCard should both be deleted so the database is the only answer.
 *
 * Keep the paths identical to the migration's. If they drift, the card and the
 * hero show different cars.
 */
export const DEMO_IMAGES: Record<string, string> = {
  'a1000000-0000-0000-0000-000000000001': '/vehicles/accord/hero-3x2.jpg',
  'a2000000-0000-0000-0000-000000000002': '/vehicles/wrx/hero-3x2.jpg',
  'a3000000-0000-0000-0000-000000000003': '/vehicles/m3/hero-3x2.jpg',
};
