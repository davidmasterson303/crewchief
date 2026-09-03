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

  /*
    ── ⚠ Chroma cut hard, 3 Sep: 0.048/0.024 → 0.016/0.008 ───────────────────

    The field is a per-make hue so two cars without photographs do not look
    like the same card. At the old chroma it did more than that: BMW hashes
    into the violets, and a card with no photo rendered as a **purple wash** —
    which is the single most recognisably generated look on the web, on the one
    surface of this product that is pure decoration.

    The hue survives, so the identity function still varies by make and every
    property this file's suite asserts still holds. What changes is that the
    variation is now felt as a temperature rather than seen as a colour: at
    0.016 against a 0.278 lightness the field reads as a lit dark room, which
    is the aesthetic the rest of the product is built in.

    ⚠ Not zero. Zero would make every unphotographed card identical, which is
    the thing the hash exists to prevent — and it would also make
    `isSemanticHue` pointless rather than satisfied.
  */
  const from = `oklch(0.278 ${(0.016 * chromaFactor).toFixed(4)} ${hue})`;
  const to = `oklch(0.138 ${(0.008 * chromaFactor).toFixed(4)} ${(hue + 22) % 360})`;

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

/**
 * ── The same field, for a client with no CSS ────────────────────────────────
 *
 * `vehicleField` returns `oklch()` stops inside a `linear-gradient()` string.
 * React Native can parse neither: `oklch` is not in its colour grammar, and
 * there is no gradient in its StyleSheet at all.
 *
 * The split is the one `health-band.ts` argues. **What colour a make gets is a
 * deterministic product decision and lives here**; how it is expressed is
 * presentation and stays with the platform — a CSS gradient on web, two hex
 * stops and an angle fed to `react-native-svg` on the phone.
 *
 * ⚠ The conversion has to be real rather than approximate. A BMW plate that is
 * one blue in a browser and a different blue on a phone is the two-clients bug
 * this codebase keeps paying for, and it would be invisible until someone held
 * the two side by side — which is exactly how the health band's wording drifted.
 */

/** Cube, kept named because it is the OKLab step people delete by accident. */
const cube = (value: number) => value * value * value;

/** Linear-light channel → sRGB, the standard piecewise transfer function. */
function encodeSrgb(channel: number): number {
  const clipped = Math.max(0, Math.min(1, channel));
  const encoded =
    clipped <= 0.0031308 ? 12.92 * clipped : 1.055 * Math.pow(clipped, 1 / 2.4) - 0.055;
  return Math.round(encoded * 255);
}

/**
 * `oklch(L C H)` → `#rrggbb`.
 *
 * OKLCh → OKLab → linear sRGB → sRGB, with the standard matrices. Values
 * outside the sRGB gamut are clipped per channel, which is what a browser does
 * too — the field's stops are dark and low-chroma by construction, so nothing
 * here is near an edge.
 */
export function oklchToHex(lightness: number, chroma: number, hue: number): string {
  const radians = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);

  const l = cube(lightness + 0.3963377774 * a + 0.2158037573 * b);
  const m = cube(lightness - 0.1055613458 * a - 0.0638541728 * b);
  const s = cube(lightness - 0.0894841775 * a - 1.291485548 * b);

  const red = encodeSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  const green = encodeSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  const blue = encodeSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);

  return `#${[red, green, blue].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

export interface VehicleFieldStops {
  /** The lighter stop, at 0%. */
  from: string;
  /** The darker stop, at 100%. */
  to: string;
  /** CSS gradient angle in degrees — 0 points up, 90 points right. */
  angle: number;
}

/**
 * The field as two hex stops, for a renderer that cannot read `oklch()`.
 *
 * The same three axes as `vehicleField` and the same hash, so a make's plate is
 * the same colour on every client. Only the notation changes.
 */
export function vehicleFieldStops(make: string | null | undefined): VehicleFieldStops {
  const field = vehicleField(make);

  return {
    /* Same stops as `vehicleField`'s gradient — see the chroma note there. */
    from: oklchToHex(0.278, 0.016 * field.chromaFactor, field.hue),
    to: oklchToHex(0.138, 0.008 * field.chromaFactor, (field.hue + 22) % 360),
    angle: field.angle,
  };
}
