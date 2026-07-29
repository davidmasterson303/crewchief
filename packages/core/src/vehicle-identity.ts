/**
 * The deterministic gradient field behind a vehicle with no photograph.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * The no-photo state is CC-142's *primary* design, not its fallback. Every
 * vehicle gets a field derived from its make, so a car without a photograph
 * looks deliberate rather than empty, and the photo variant is the same box
 * with a photograph swapped in behind it. A photo can therefore never break
 * the layout, because the layout already worked without one.
 *
 * ── Why the hue band is 180–325° and not the whole wheel ────────────────────
 *
 * The band is chosen **by exclusion**, and this is the part to not "improve":
 *
 *   0–40    critical red      excluded
 *   60–100  attention amber   excluded
 *   120–160 confirm green     excluded
 *
 * Those are semantic in this product — they mean a health band. A decorative
 * field that borrowed one would say something about the car's condition purely
 * because of how its make is spelled. 180–325 (steel-blue → indigo → violet)
 * is what is left, and it is left on purpose.
 *
 * ── The mapping is fixed by three published anchors ─────────────────────────
 *
 * The design specifies BMW 297°, Subaru 259°, Honda 233°. Those three values
 * pin the mapping exactly — FNV-1a over the raw (case-sensitive) make, then
 * `180 + (hash % 146)`. 146 rather than 145 because the band is inclusive of
 * both ends. `vehicle-identity.test.ts` asserts all three.
 *
 * **Do not "clean this up"** by lowercasing the make, switching hash, or
 * rounding the span to 145. Any of those changes every vehicle's colour in the
 * app at once and breaks the three published values.
 */

/** The curated band, inclusive at both ends. Steel-blue → indigo → violet. */
export const HUE_MIN = 180;
export const HUE_MAX = 325;

/** Hue ranges that carry meaning elsewhere in the product and must be avoided. */
export const SEMANTIC_HUE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0, 40], // critical red
  [60, 100], // attention amber
  [120, 160], // confirm green
];

export interface VehicleField {
  /** Degrees, within [HUE_MIN, HUE_MAX]. */
  hue: number;
  /** Multiplier on both chroma values, 0.9–1.26. A secondary axis. */
  chromaFactor: number;
  /** CSS gradient angle in degrees. The third axis. */
  angle: number;
  /** The two stops, ready for `linear-gradient`. */
  from: string;
  to: string;
  /** A complete `linear-gradient(...)` value. */
  gradient: string;
}

/**
 * FNV-1a, 32-bit.
 *
 * `Math.imul` is load-bearing: the 32-bit multiply overflows the double
 * mantissa, and plain `*` silently loses the low bits, which produces a
 * different hash on long strings. `>>> 0` after each step keeps it unsigned.
 */
export function fnv1a(input: string): number {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

/**
 * The hue for a make. Empty or missing makes get the band's midpoint rather
 * than 180, so an unknown vehicle is not visually identical to whichever real
 * make happens to hash to the low end.
 */
export function makeHue(make: string | null | undefined): number {
  if (!make) return Math.round((HUE_MIN + HUE_MAX) / 2);
  return HUE_MIN + (fnv1a(make) % (HUE_MAX - HUE_MIN + 1));
}

/**
 * The full field for a make.
 *
 * Chroma and angle are drawn from **higher bits** of the same hash than the
 * hue is. Two makes that happen to land near each other in hue will almost
 * always differ in saturation and direction, which is what keeps them apart at
 * card size where a few degrees of hue is invisible.
 */
export function vehicleField(make: string | null | undefined): VehicleField {
  const hash = make ? fnv1a(make) : 0;
  const hue = makeHue(make);

  // 0.90 – 1.26 in 0.01 steps. Applied to both stops so the pair stays a ramp
  // rather than one stop drifting saturated and the other flat.
  const chromaFactor = 0.9 + ((hash >>> 8) % 37) / 100;

  // Kept diagonal on purpose: a 90° or 180° field reads as a UI surface with a
  // border, not as a lit backdrop behind a car.
  const angle = 115 + ((hash >>> 16) % 101);

  const from = `oklch(0.278 ${(0.048 * chromaFactor).toFixed(4)} ${hue})`;
  const to = `oklch(0.138 ${(0.024 * chromaFactor).toFixed(4)} ${(hue + 22) % 360})`;

  return {
    hue,
    chromaFactor: Number(chromaFactor.toFixed(2)),
    angle,
    from,
    to,
    gradient: `linear-gradient(${angle}deg, ${from} 0%, ${to} 100%)`,
  };
}

/** Whether a hue falls in a range this product uses to mean something. */
export function isSemanticHue(hue: number): boolean {
  const h = ((hue % 360) + 360) % 360;
  return SEMANTIC_HUE_RANGES.some(([lo, hi]) => h >= lo && h <= hi);
}
