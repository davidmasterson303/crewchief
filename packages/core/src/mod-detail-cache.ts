/**
 * The identity of a modification analysis, so two owners of the same car pay
 * for it once.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * `modification_details` was **89% of all AI spend** in the first three weeks
 * of metering — 232 of 292 calls — and it had no cache at any level. Every
 * time anyone opened a mod, the same analysis was generated from scratch.
 *
 * It is the most cacheable call in the product and was the only uncached one.
 * Its prompt reads exactly six values, and **not one of them identifies a
 * person or a specific car**: year, make, model, the modification's name, the
 * owner's performance goal, and their ownership objective. No VIN, no mileage,
 * no service history, no user id. "Cold air intake on a 2018 Accord, moderate
 * goal, keep forever" has one answer, and it is the same answer for everybody.
 *
 * ⚠ **The existing `performance_mod_cache` does not solve this.** It caches the
 * mod *list*, and it is keyed on `vehicle_id` — so two people with identical
 * cars share nothing, and the details are not cached at all.
 *
 * ── ⚠ The failure mode this key has to avoid ────────────────────────────────
 *
 * A cache key narrower than the prompt serves one car's answer for another's.
 * That failure is **silent and confident**: the reader gets a fluent, specific
 * analysis of the wrong vehicle, and nothing anywhere reports an error.
 *
 * So the rule is mechanical: **every value interpolated into the prompt is in
 * the key, and the key contains nothing else.** `mod-detail-cache.test.ts`
 * pins the field list against the prompt, so adding an input without adding it
 * here fails the build rather than poisoning the cache.
 *
 * If a future prompt reads mileage, or the car's known issues, those become
 * part of the identity — or the cache has to go. There is no third option
 * where the prompt is personalised and the answer is shared.
 */

/** Exactly the values `generateModificationDetails` interpolates. */
export interface ModDetailFacts {
  year: number | string;
  make: string;
  model: string;
  modName: string;
  /** 'mild' | 'moderate' | 'aggressive' — changes the whole framing. */
  performanceGoal: string;
  /** Free text, and quoted verbatim into the prompt. */
  ownershipObjective?: string | null;
}

/**
 * The field list, exported so a test can assert it matches the prompt rather
 * than trusting this file's docblock.
 */
export const MOD_DETAIL_KEY_FIELDS = [
  'year',
  'make',
  'model',
  'modName',
  'performanceGoal',
  'ownershipObjective',
] as const;

/**
 * The separator between fields.
 *
 * A unit separator rather than a pipe or a colon, because every one of these
 * fields is free text a user or a data source can contain. `modName` is the
 * likeliest to hold punctuation, and a separator that can appear inside a value
 * is how `make = "a|b"` collides with a two-field key.
 */
const SEP = '\u001f';

/**
 * Normalise a value for the key.
 *
 * Case and surrounding whitespace are noise — `HONDA` and `Honda` are the same
 * make, and the database holds both. Interior whitespace is collapsed because
 * `"cold  air intake"` and `"cold air intake"` produce the same prompt once the
 * model reads it.
 *
 * Everything else is left alone. Aggressive normalisation is how a key starts
 * merging things that are not the same.
 */
function norm(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * A stable, human-readable identity for one modification analysis.
 *
 * Not hashed, deliberately. The key goes in a database column that somebody
 * will one day read while working out why a cached answer looks wrong, and a
 * hash turns that into a dead end.
 */
export function modDetailCacheKey(facts: ModDetailFacts): string {
  return [
    norm(facts.year),
    norm(facts.make),
    norm(facts.model),
    norm(facts.modName),
    norm(facts.performanceGoal),
    norm(facts.ownershipObjective),
  ].join(SEP);
}

/**
 * How long a cached analysis stays usable.
 *
 * Thirty days. Parts prices drift and new products appear, but the substance —
 * what the mod does to a 2018 Accord, and what it costs to fit — does not
 * change week to week. The seven-day window `performance_mod_cache` uses would
 * be cautious to the point of throwing away most of the saving, and the thing
 * being cached is not a quote.
 */
export const MOD_DETAIL_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Whether a cached row is still within its window. */
export function isModDetailCacheFresh(
  cachedAt: string | null | undefined,
  now: Date = new Date()
): boolean {
  if (!cachedAt) return false;
  const at = Date.parse(cachedAt);
  if (Number.isNaN(at)) return false;
  /*
    A future timestamp is treated as stale rather than fresh. Clock skew that
    writes tomorrow's date would otherwise pin an entry as valid indefinitely,
    and regenerating once is cheaper than serving a frozen answer forever.
  */
  const age = now.getTime() - at;
  return age >= 0 && age < MOD_DETAIL_CACHE_TTL_MS;
}
