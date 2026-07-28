/**
 * Demo identity — portable.
 *
 * The cookie *name* lives here because it is just a string; the functions that
 * read and write it are in `lib/demo-mode.ts` (which stays in the app), and is browser-only. Keeping
 * them apart is what lets this module, `routes.ts` and
 * `auth-session.ts` into the shared package.
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
 * Keep these pointing at the same *photograph* as the migration's. If they
 * drift, the card and the hero show different cars.
 *
 * ── They now point at a card-sized derivative, and that is not drift ────────
 *
 * `card-800.jpg` is `hero-3x2.jpg` resized to 800px and re-encoded — the same
 * frame, the same crop, a different file size. The rule above is about which
 * car is shown, and it still holds.
 *
 * The reason is CC-142's payload criterion. A garage grid of three cards was
 * fetching three page-width heroes: 2,252 KB to fill three ~400px boxes. The
 * derivatives bring that to 225 KB. The dashboard keeps `hero-3x2.jpg`, which
 * is the right source for a 400px full-width band.
 *
 * `lib/__tests__/demo-image-budget.test.ts` holds the line at 250 KB.
 *
 * **Whoever deletes this map must not simply fall back to `image_url`** — the
 * database column holds the hero, so doing that silently restores the 2.2 MB
 * grid. Deleting it properly means the card asking for a card-sized source,
 * whether through a second column, a naming convention or `srcset`.
 */
export const DEMO_IMAGES: Record<string, string> = {
  'a1000000-0000-0000-0000-000000000001': '/vehicles/accord/card-800.jpg',
  'a2000000-0000-0000-0000-000000000002': '/vehicles/wrx/card-800.jpg',
  'a3000000-0000-0000-0000-000000000003': '/vehicles/m3/card-800.jpg',
};
