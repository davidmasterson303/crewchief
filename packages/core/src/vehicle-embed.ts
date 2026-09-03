/**
 * One embedded row from PostgREST, whichever shape it arrived in.
 *
 * ── ⚠ The bug this exists for ───────────────────────────────────────────────
 *
 * PostgREST embeds a **to-one** relation as an object and a **to-many** as an
 * array. `nhtsa_data` and `vehicle_health_summary` are one row per vehicle, so
 * they come back as objects — while `hooks/useVehicles.ts` types them as arrays
 * and both garage pages read `vehicle.vehicle_health_summary?.[0]`.
 *
 * Indexing an object with `[0]` is `undefined`. It does not throw, it does not
 * warn, and the card falls back to its no-data state — so **every health score
 * this product has ever computed was discarded on the way to the garage**, and
 * `activeRecalls` was always `0`.
 *
 * The second half is the one that matters: an open safety recall on a car in
 * the garage did not raise its alert ribbon, because the count it is derived
 * from was `undefined?.length || 0`. Found 3 Sep by querying PostgREST as the
 * anonymous browser does and comparing the shape to the code that reads it —
 * the page renders perfectly either way, which is why nothing caught it.
 *
 * ⚠ Takes both shapes rather than "fixing" the type to an object. The
 * relations' cardinality is a database fact that a migration can change, the
 * two clients read the same rows through different paths, and a reader that
 * only understands today's shape is the same bug pointed the other way.
 */
export function firstEmbed<T>(value: T | T[] | null | undefined): T | undefined {
  if (value === null || value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : value;
}
