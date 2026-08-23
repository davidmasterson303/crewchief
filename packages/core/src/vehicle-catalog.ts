/**
 * What a car can be called, and how to check that somebody typed one.
 *
 * ── The screen this exists for ──────────────────────────────────────────────
 *
 * `AddVehicleScreen` asked for a model year, a make and a model through three
 * bare text fields. Four ways that is worse than it looks, and none of them
 * show up in a test:
 *
 *   - **"bmw", "BMW", "Bmw" and "B.M.W." are four different cars** as far as
 *     every downstream join is concerned. Recalls match on year/make/model
 *     strings; so does the dossier prompt. A typo does not fail, it produces a
 *     car nothing can find anything about.
 *   - **A model year is not free text.** "205", "20155" and "2O15" all pass a
 *     four-character check, and the last one is an letter O.
 *   - **Nobody can spell their own trim reliably**, and until now nothing
 *     offered them the spelling.
 *   - It asked a phone owner to type on a phone when the answer was already
 *     printed on the car's own VIN plate.
 *
 * ── Where the data comes from, and what is deliberately not fetched ─────────
 *
 * **Models come from NHTSA vPIC**, live, keyed on make and model year. There is
 * no way to curate that — it is thousands of rows that change every autumn, and
 * a stale copy is worse than none because it looks authoritative.
 *
 * **Makes are the list below, and are *not* fetched.** vPIC will answer
 * `GetMakesForVehicleType/car` with 195 of them and the union with trucks and
 * MPVs is larger still, most of it bodybuilders and trailer manufacturers that
 * no owner will ever pick. A typeahead's job is to make the common case
 * instant, and a list that ships with the app is instant, works on a plane, and
 * is ordered by something better than an API's row order.
 *
 * ⚠ **Neither list is a gate.** Every field this feeds accepts a value that is
 * not in it. A curated list that refused an unlisted make would be this
 * codebase's own rule 10 broken — inventing precision — and would lock out the
 * grey imports, the kit cars and the two-year-old marque the list has not
 * heard of yet.
 *
 * ── No network in here ──────────────────────────────────────────────────────
 *
 * This module builds URLs and reads responses. It never calls `fetch`, so it
 * runs identically in a Jest process and on a phone, and every case below can
 * be asserted against a fixture rather than against NHTSA's uptime.
 */

/**
 * The first model year with a standardised 17-character VIN.
 *
 * ⚠ Not an arbitrary floor. Before MY1981 a VIN could be 11 to 17 characters
 * with no agreed layout, so `decodeVin` cannot answer for those cars and the
 * year list should not imply that it can. Somebody restoring a 1968 car types
 * the year rather than picking it — which is the same escape hatch every field
 * here has.
 */
export const MODEL_YEAR_FLOOR = 1981;

/**
 * Model years, newest first.
 *
 * Runs one year **ahead** of the calendar, because it always does: a 2027 car
 * is on a forecourt in the back half of 2026, and a list that stops at today's
 * year tells its owner their new car does not exist.
 *
 * `today` is injected for the reason everything in this codebase injects a
 * clock — a function that reads `Date.now()` cannot be tested at the boundary
 * that matters, and this one has a boundary on 1 January.
 */
export function modelYears(today: Date): number[] {
  const newest = today.getFullYear() + 1;
  const years: number[] = [];
  for (let year = newest; year >= MODEL_YEAR_FLOOR; year -= 1) years.push(year);
  return years;
}

/** Whether a year is one this product will accept at all. */
export function isPlausibleModelYear(year: number, today: Date): boolean {
  return Number.isInteger(year) && year >= MODEL_YEAR_FLOOR && year <= today.getFullYear() + 1;
}

/**
 * The makes an owner in this market is likely to pick, in one alphabetical run.
 *
 * ⚠ **Spelled as vPIC spells them**, because these strings are sent straight
 * back to it as a path segment when the model list is fetched. Every entry was
 * checked against `GetModelsForMakeYear` rather than typed from memory —
 * "Mercedes-Benz", "Land Rover", "Rolls-Royce" and "Alfa Romeo" all answer, and
 * a plausible-looking "Mercedes" does not.
 *
 * Dead marques are in it on purpose. Pontiac, Saturn, Scion, Mercury and
 * Oldsmobile stopped being sold and did not stop being owned, and a
 * fifteen-year-old car is exactly the one whose owner needs a maintenance
 * product.
 */
export const COMMON_MAKES: readonly string[] = [
  'Acura',
  'Alfa Romeo',
  'Aston Martin',
  'Audi',
  'Bentley',
  'BMW',
  'Buick',
  'Cadillac',
  'Chevrolet',
  'Chrysler',
  'Dodge',
  'Ferrari',
  'FIAT',
  'Ford',
  'Genesis',
  'GMC',
  'Honda',
  'HUMMER',
  'Hyundai',
  'INFINITI',
  'Isuzu',
  'Jaguar',
  'Jeep',
  'Kia',
  'Lamborghini',
  'Land Rover',
  'Lexus',
  'Lincoln',
  'Lotus',
  'Lucid',
  'Maserati',
  'Mazda',
  'McLaren',
  'Mercedes-Benz',
  'Mercury',
  'MINI',
  'Mitsubishi',
  'Nissan',
  'Oldsmobile',
  'Plymouth',
  'Polestar',
  'Pontiac',
  'Porsche',
  'RAM',
  'Rivian',
  'Rolls-Royce',
  'Saab',
  'Saturn',
  'Scion',
  'smart',
  'Subaru',
  'Suzuki',
  'Tesla',
  'Toyota',
  'Volkswagen',
  'Volvo',
] as const;

/**
 * The form of a name two spellings of it can be compared in.
 *
 * Case, punctuation and spacing all go: `Mercedes-Benz`, `mercedes benz` and
 * `MERCEDESBENZ` collapse to one key. That is what lets somebody type
 * "mercedes-benz" and be offered the entry that will actually resolve at vPIC.
 */
export function catalogKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Suggestions for a partly-typed name, best first.
 *
 * **Prefix matches before contained matches**, and alphabetical within each —
 * typing "m" should offer Maserati before Aston Martin, and a single relevance
 * sort cannot express that without a score nobody can explain. Two passes can.
 *
 * An empty query returns the whole list rather than nothing: the field opens
 * its suggestions on focus, and an owner who does not know how their make is
 * spelled is precisely the one who has not typed anything yet.
 */
export function suggestNames(query: string, names: readonly string[], limit = 8): string[] {
  const key = catalogKey(query);
  if (!key) return names.slice(0, limit);

  const starts: string[] = [];
  const contains: string[] = [];

  for (const name of names) {
    const candidate = catalogKey(name);
    if (candidate.startsWith(key)) starts.push(name);
    else if (candidate.includes(key)) contains.push(name);
  }

  return [...starts, ...contains].slice(0, limit);
}

/**
 * The catalogue's own spelling of a name somebody typed, if it has one.
 *
 * ⚠ This is the fix for the four-different-cars problem at the top of the file,
 * and it is applied on **submit** rather than on every keystroke. Rewriting the
 * field under the finger — "bmw" becoming "BMW" as the W lands — is the
 * behaviour that makes an autocorrecting form feel like it is arguing.
 *
 * Returns the input unchanged when nothing matches, because an unlisted make is
 * a legitimate answer. See the ⚠ at the top: this list is not a gate.
 */
export function canonicalName(value: string, names: readonly string[]): string {
  const trimmed = value.trim();
  const key = catalogKey(trimmed);
  if (!key) return trimmed;

  return names.find((name) => catalogKey(name) === key) ?? trimmed;
}

/* ── VIN ──────────────────────────────────────────────────────────────────── */

export const VIN_LENGTH = 17;

/**
 * ⚠ **I, O and Q are not VIN characters.** They were left out of the standard
 * precisely because they are indistinguishable from 1, 0 and 0 in the stamped
 * and printed forms an owner is reading off — which is to say, the character an
 * owner is most likely to type is the one that cannot be right.
 *
 * So a VIN containing one is not "possibly wrong", it is certainly a
 * misreading, and saying so is more useful than a decode that fails at NHTSA
 * with "invalid VIN".
 */
const VIN_FORBIDDEN = /[IOQ]/;
const VIN_ALLOWED = /^[A-HJ-NPR-Z0-9]*$/;

/** Upper-cased and stripped of the spaces and dashes people type into it. */
export function normaliseVin(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * What is wrong with a VIN, in words, or `null` when nothing is.
 *
 * ⚠ **The check digit is deliberately not in here.** It is a real check and it
 * is checked — see `vinCheckDigitMatches` — but it is a *warning*, because
 * position 9 is only mandatory for vehicles built for North America and a
 * European or Japanese-market import can carry a perfectly genuine VIN that
 * fails it. Refusing those would be inventing precision, and it would refuse
 * them in the most confusing way available: by telling an owner holding the
 * car that the number printed on it is not a number.
 *
 * NHTSA agrees, which is the deciding evidence rather than an opinion. Handed a
 * VIN with a bad check digit it still decodes it, and returns `ErrorCode: '1'`
 * alongside a usable make and model. A client stricter than the authority it is
 * about to ask is a client that answers questions it was not asked.
 */
export function vinProblem(vin: string): string | null {
  if (vin.length === 0) return null;

  if (VIN_FORBIDDEN.test(vin)) {
    return 'A VIN never contains I, O or Q — check those against 1 and 0.';
  }

  if (!VIN_ALLOWED.test(vin)) return 'A VIN is letters and numbers only.';

  if (vin.length < VIN_LENGTH) {
    return `${VIN_LENGTH - vin.length} to go — a VIN is ${VIN_LENGTH} characters.`;
  }

  if (vin.length > VIN_LENGTH) return `That is ${vin.length} characters; a VIN is ${VIN_LENGTH}.`;

  return null;
}

/** Transliteration table from ISO 3779 / 49 CFR 565. */
const VIN_VALUES: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};

/** Positional weights, position 9 (the check digit itself) carrying zero. */
const VIN_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

/**
 * Whether position 9 agrees with the other sixteen characters.
 *
 * `false` is a **hint that something was mistyped**, never a refusal — see
 * `vinProblem` for why, and note that a VIN this returns `false` for is still
 * worth sending to NHTSA, which will usually decode it anyway.
 */
export function vinCheckDigitMatches(vin: string): boolean {
  if (vin.length !== VIN_LENGTH || !VIN_ALLOWED.test(vin) || VIN_FORBIDDEN.test(vin)) return false;

  let total = 0;
  for (let i = 0; i < VIN_LENGTH; i += 1) {
    const character = vin[i];
    const value = /[0-9]/.test(character) ? Number(character) : VIN_VALUES[character];
    if (value === undefined) return false;
    total += value * VIN_WEIGHTS[i];
  }

  const remainder = total % 11;
  const expected = remainder === 10 ? 'X' : String(remainder);
  return vin[8] === expected;
}

/* ── vPIC ─────────────────────────────────────────────────────────────────── */

const VPIC = 'https://vpic.nhtsa.dot.gov/api/vehicles';

/**
 * The three vehicle types a consumer car can be filed under.
 *
 * ⚠ **All three are needed and one request cannot replace them.** Asked for BMW
 * in 2015 with no type, vPIC answers 56 models — and 19 of them are
 * motorcycles, because `GetModelsForMakeYear` covers everything the make
 * builds. Asked for `car` it answers 37 with the bikes gone; asked for `mpv` it
 * answers X3, X4, X5 and X6, which appear under **no other type**. Filtering to
 * `car` alone would silently hide every SUV, which for this product's owners is
 * most of them.
 */
export const VPIC_VEHICLE_TYPES = ['car', 'truck', 'mpv'] as const;

export type VpicVehicleType = (typeof VPIC_VEHICLE_TYPES)[number];

/** The models endpoint for one make, year and vehicle type. */
export function vpicModelsUrl(make: string, year: number, type: VpicVehicleType): string {
  return (
    `${VPIC}/GetModelsForMakeYear/make/${encodeURIComponent(make.trim())}` +
    `/modelyear/${year}/vehicletype/${type}?format=json`
  );
}

/** The flat decode endpoint — one row, already unnested. */
export function vpicDecodeUrl(vin: string): string {
  return `${VPIC}/DecodeVinValues/${encodeURIComponent(normaliseVin(vin))}?format=json`;
}

/**
 * Model names out of a vPIC response, de-duplicated and sorted.
 *
 * Takes `unknown` and trusts none of it. This is a third-party JSON body over
 * the network, `Results` is `null` rather than `[]` when a make has nothing for
 * a year, and a shape assumption here is a crash on the add-a-car screen.
 */
export function parseVpicModels(body: unknown): string[] {
  const results = (body as { Results?: unknown } | null)?.Results;
  if (!Array.isArray(results)) return [];

  const names = new Set<string>();
  for (const row of results) {
    const name = (row as { Model_Name?: unknown } | null)?.Model_Name;
    if (typeof name === 'string' && name.trim()) names.add(name.trim());
  }

  return Array.from(names).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}

/** What a decode can tell us about a car. Every field is optional on purpose. */
export interface DecodedVin {
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  /**
   * NHTSA's own verdict on the number.
   *
   * `'clean'` is `ErrorCode` 0. `'suspect'` is a decode that returned usable
   * fields alongside a complaint — overwhelmingly a check-digit mismatch, which
   * is worth repeating to the owner and not worth refusing over.
   */
  confidence: 'clean' | 'suspect';
}

/**
 * A decode response, or `null` when it identified nothing.
 *
 * ⚠ **Null when there is no make *and* no model**, rather than when
 * `ErrorCode` is non-zero. Those are different questions and the second one is
 * the wrong one: a VIN with a mistyped check digit comes back as code 1 with
 * "HONDA / Accord / LX" attached, and discarding that would throw away the
 * whole answer over the one character the owner can fix by looking again.
 *
 * ⚠ `Trim` is frequently empty even for a car that plainly has one — a real
 * 2015 M235i decodes with `Trim: ''` and its `Series` in a different field. So
 * an absent trim is normal, and the screen must not present it as a failure or
 * blank a value the owner already typed.
 */
export function parseVpicDecode(body: unknown): DecodedVin | null {
  const row = (body as { Results?: unknown } | null)?.Results;
  const first = Array.isArray(row) ? (row[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) return null;

  const clean = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  };

  const make = clean(first.Make);
  const model = clean(first.Model);
  if (!make && !model) return null;

  const year = Number(first.ModelYear);

  return {
    year: Number.isInteger(year) && year > 0 ? year : null,
    /*
      Title-cased through the catalogue where it can be. vPIC answers "HONDA"
      and "BMW" in caps, and a garage listing "2015 HONDA Accord" next to a
      hand-typed "2018 Subaru WRX" looks like two different products.
    */
    make: make ? canonicalName(make, COMMON_MAKES) : null,
    model,
    trim: clean(first.Trim),
    confidence: clean(first.ErrorCode) === '0' ? 'clean' : 'suspect',
  };
}
