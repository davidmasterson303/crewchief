/**
 * NHTSA vPIC `BodyClass` + `Doors` → one of twelve illustration styles.
 *
 * Pure and portable: the same mapping has to run in the Expo garage view, so
 * it lives here rather than beside the React components that consume it.
 *
 * ── Why illustrations at all ────────────────────────────────────────────────
 *
 * Every vehicle card needs a default before the user uploads a photo, and
 * onboarding cannot rely on uploads. Stock photos, VIN-matched image APIs and
 * raw AI generation were all rejected on licensing grounds — the app is
 * intended for sale, so every asset needs a clean chain of title. Manufacturers
 * also protect vehicle *shape* as trade dress, not just badges. Hence a set of
 * deliberately generic silhouettes, authored as code: owned outright, on-brand,
 * and legally boring.
 *
 * ── Deriving, not storing ───────────────────────────────────────────────────
 *
 * Nothing is persisted per vehicle until a real photo exists. This function is
 * deterministic, so the illustration is a pure function of data the decode
 * already gave us. That keeps it correct when a vehicle's decode is corrected,
 * and means no migration when the set changes.
 */

export type VehicleBodyStyle =
  | 'sedan'
  | 'coupe'
  | 'sports'
  | 'pickup-2door'
  | 'pickup-4door'
  | 'minivan'
  | 'van'
  | 'suv-small'
  | 'suv-large'
  | 'motorcycle'
  | 'wagon'
  | 'generic';

/** Every style, in the order the gallery should present them. */
export const VEHICLE_BODY_STYLES: readonly VehicleBodyStyle[] = [
  'sedan',
  'coupe',
  'sports',
  'pickup-2door',
  'pickup-4door',
  'minivan',
  'van',
  'suv-small',
  'suv-large',
  'motorcycle',
  'wagon',
  'generic',
] as const;

/**
 * Doors, as vPIC reports it — a string, sometimes absent, occasionally junk.
 * Anything unparseable is treated as unknown rather than guessed at.
 */
function doorCount(doors: string | number | null | undefined): number | null {
  if (doors === null || doors === undefined || doors === '') return null;
  const n = typeof doors === 'number' ? doors : Number.parseInt(String(doors), 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Which illustration to draw.
 *
 * vPIC's `BodyClass` is free-ish text and varies by manufacturer submission,
 * so this matches on substrings rather than an exact enum. Order matters
 * throughout — the more specific test has to run first, and each place that
 * happens is commented, because it is the kind of thing a later edit reorders
 * without noticing.
 *
 * @param bodyClass vPIC `BodyClass`, e.g. "Sedan/Saloon", "Pickup".
 * @param doors     vPIC `Doors`. Distinguishes sedan from coupe and crew cab
 *                  from regular cab; absent for most motorcycles.
 */
export function resolveBodyStyle(
  bodyClass: string | null | undefined,
  doors?: string | number | null
): VehicleBodyStyle {
  if (!bodyClass) return 'generic';

  const b = bodyClass.toLowerCase();
  const d = doorCount(doors);

  // Before anything else: vPIC labels these plainly and they share no geometry
  // with the four-wheeled set.
  if (b.includes('motorcycle') || b.includes('moped') || b.includes('scooter')) {
    return 'motorcycle';
  }

  /*
    Pickups before trucks and before SUVs. Several manufacturers submit
    "Pickup" inside a longer string, and "Truck" alone is ambiguous enough
    that it falls through to the van/SUV tests below.
  */
  if (b.includes('pickup')) {
    // 4 doors means a crew or extended cab. Unknown door count is the more
    // common modern shape, so it takes the crew cab rather than the fallback.
    return d !== null && d <= 2 ? 'pickup-2door' : 'pickup-4door';
  }

  // Minivan before van: "Minivan" contains "van", so the general test would
  // swallow it.
  if (b.includes('minivan') || b.includes('mpv') || b.includes('multi-purpose')) {
    /*
      vPIC folds SUVs and MPVs into one label —
      "Sport Utility Vehicle (SUV)/Multi-Purpose Vehicle (MPV)" — so a string
      containing both is far more likely an SUV than an actual minivan.
    */
    if (b.includes('sport utility') || b.includes('suv')) {
      return suvSize(b);
    }
    return 'minivan';
  }

  if (b.includes('van')) return 'van';

  if (b.includes('sport utility') || b.includes('suv') || b.includes('crossover') || b.includes('cuv')) {
    return suvSize(b);
  }

  // Wagon before sedan: "Station Wagon" would otherwise miss, and a wagon's
  // whole point is that its tail is not a sedan's.
  if (b.includes('wagon') || b.includes('estate')) return 'wagon';

  /*
    Convertibles and roadsters read as sports cars — low, cab-rearward — which
    is closer than a coupe and much closer than a sedan.
  */
  if (b.includes('convertible') || b.includes('cabriolet') || b.includes('roadster')) {
    return 'sports';
  }

  if (b.includes('coupe')) {
    // A "4-door coupe" is a marketing shape, not a body style. Doors win.
    return d !== null && d >= 4 ? 'sedan' : 'coupe';
  }

  if (b.includes('sedan') || b.includes('saloon')) {
    // Symmetrically: a 2-door sedan is a coupe by geometry.
    return d !== null && d <= 2 ? 'coupe' : 'sedan';
  }

  /*
    Hatchbacks have no dedicated silhouette. Two doors reads as a coupe, more
    reads as a wagon — a hatch's tail is nearer a wagon's than a sedan's, and
    the point of these shapes is that they are recognisable at 48px, not that
    they are exhaustive.
  */
  if (b.includes('hatchback') || b.includes('liftback') || b.includes('notchback')) {
    return d !== null && d <= 2 ? 'coupe' : 'wagon';
  }

  // Bare "Truck" with no "pickup": most likely a work truck, and the full-size
  // van slab-side shape is the closest thing in the set.
  if (b.includes('truck')) return 'van';

  return 'generic';
}

/**
 * Small or large SUV.
 *
 * vPIC does not reliably distinguish them — there is no size field on the
 * standard decode — so this reads the size words manufacturers do submit and
 * otherwise picks small. Small is the safer default: a compact drawn for a
 * large SUV looks like a modest mistake, where the reverse looks like the app
 * does not know what car you own.
 */
function suvSize(bodyClass: string): VehicleBodyStyle {
  if (/\b(full[- ]?size|large|extended|suburban|3[- ]row)\b/.test(bodyClass)) {
    return 'suv-large';
  }
  return 'suv-small';
}

/** Human label for the illustration's accessible title. */
export const BODY_STYLE_LABEL: Record<VehicleBodyStyle, string> = {
  sedan: 'four-door sedan',
  coupe: 'two-door coupe',
  sports: 'sports car',
  'pickup-2door': 'two-door pickup truck',
  'pickup-4door': 'four-door pickup truck',
  minivan: 'mini-van',
  van: 'full-size van',
  'suv-small': 'small SUV',
  'suv-large': 'large SUV',
  motorcycle: 'motorcycle',
  wagon: 'station wagon',
  generic: 'vehicle',
};
