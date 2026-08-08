/**
 * The cluster dial's geometry, in one place.
 *
 * `ClusterGauge` established it for the health score in roadmap item 7 — a 270°
 * tachometer open at the bottom, chosen over a closed conic donut because the
 * donut "read SaaS progress ring" and carried severity by colour alone.
 *
 * ── Why this is extracted rather than copied ────────────────────────────────
 *
 * The build dial is the **same instrument reading a different quantity**, which
 * is the whole argument for it: two gauges in one cluster, so the product looks
 * like a car rather than like a dashboard product. But a second copy of
 * `M 50.5 149.5 A 70 70 0 1 1 149.5 149.5` is a second copy — and this codebase
 * has paid for that shape repeatedly, most recently with `VehicleDataSchema`
 * defined twice and drifting the moment one was edited.
 *
 * So the numbers live here and `cluster-geometry.test.ts` pins `ClusterGauge`'s
 * own literals to them. The shipped health dial is deliberately **not**
 * refactored to import these: it works, it is covered, and rewriting a live
 * component to prove a point about duplication is how a working thing breaks.
 * The test catches drift without touching it.
 */

export const VIEW_W = 200;
export const VIEW_H = 178;
export const CX = 100;
export const CY = 100;
export const R = 70;

/**
 * The 270° arc, open at the bottom.
 *
 * The endpoints are the 225° and 315° positions; the sweep flag is 1 and the
 * large-arc flag is 1 because the arc is the long way round.
 */
export const TRACK = `M 50.5 149.5 A ${R} ${R} 0 1 1 149.5 149.5`;

/**
 * Degrees from twelve o'clock for a 0–100 reading.
 *
 * 0 sits at −135° (lower left), 100 at +135° (lower right), so the full sweep
 * is 270°.
 */
export function angleFor(reading: number): number {
  return 2.7 * reading - 135;
}

/** A point at `radius` along the dial, for a 0–100 reading. */
export function pointAt(reading: number, radius: number): { x: number; y: number } {
  const radians = ((angleFor(reading) - 90) * Math.PI) / 180;
  return {
    x: CX + radius * Math.cos(radians),
    y: CY + radius * Math.sin(radians),
  };
}
