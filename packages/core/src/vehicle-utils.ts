import { z } from 'zod';

/**
 * Is this schedule entry usable for deciding a service is due?
 *
 * The one question that matters, asked in one place. A "yes" means the entry
 * carries **either** a mileage number that can be compared against an odometer
 * **or** a month interval that can be compared against a date.
 *
 * ── This required miles until 7 Aug 2026, and that was a half-fix ───────────
 *
 * `c09ccf8` taught `service-due.ts` — the *read* side — that a service can be
 * time-based, because all four cars in the product carry a time-only brake
 * fluid entry and every one of them was being dropped. **The write side never
 * moved.** So the read side could evaluate a time-only entry and the schema
 * that guards onboarding would never let one be stored, and because the array
 * is filtered by `preprocess` rather than validated, it failed **silently** —
 * no error, no warning, the entry simply gone.
 *
 * It is the same disappearance `c09ccf8` was written to stop, one layer up, and
 * it survived because the fix was applied where the symptom was seen rather
 * than at both ends of the contract. Found by Cowork on 7 Aug, building the
 * backfill against a handoff of mine that asserted this already worked. It did
 * not; I had not checked.
 *
 * **Legacy prose rows still answer "no", and that is still the point.** Every
 * vehicle onboarded before 7 Aug holds `{item, interval: "every 30,000 miles"}`.
 * Parsing that back into a number is deliberately not done here: the formats are
 * open-ended ("annually", "every 2 years or 24k"), a parser would be right most
 * of the time, and *most of the time* is the wrong standard for a notification
 * that tells someone their car needs work.
 *
 * ── Both intervals are checked for finiteness, and months was not ───────────
 *
 * `Number.isFinite` was applied to miles and nothing at all to months, and
 * zod's `.positive()` accepts `Infinity`. Harmless while nothing read the
 * field; `c09ccf8` made it load-bearing. The read side happens to guard
 * (`service-due.ts`'s own `positive()` checks finiteness), so the effect was
 * not a service reading as "fine forever" — it was the entry vanishing from
 * evaluation entirely, which is the failure this whole function exists to stop.
 */
export function isUsableScheduleEntry(entry: unknown): boolean {
  if (typeof entry !== 'object' || entry === null) return false;

  const record = entry as Record<string, unknown>;
  const { service } = record;

  if (typeof service !== 'string' || service.trim().length === 0) return false;

  /*
    ── "Absent" and "malformed" are different, and conflating them costs ──────

    `0`, `null` and `undefined` all mean *this axis does not apply* — the
    prompt's own instruction is "use 0 for numbers" when there is no data, so a
    time-only service routinely arrives carrying `interval_miles: 0`. Those are
    cleared to `null` by `sanitiseScheduleEntry` and the entry survives on its
    other axis.

    A string, a negative, a `NaN` or an `Infinity` is a *malformed* value, not
    an absent one, and the entry is dropped whole. Cowork's point, and it is
    right: nulling `interval_miles: "7500"` would silently reinterpret a
    7,500-mile service as a purely time-based one, which is a worse outcome than
    losing the entry — the schedule would then quietly tell someone the wrong
    thing rather than tell them nothing.
  */
  if (isMalformedInterval(record.interval_miles)) return false;
  if (isMalformedInterval(record.interval_months)) return false;

  return (
    isPositiveInterval(record.interval_miles) || isPositiveInterval(record.interval_months)
  );
}

/** Present, and not a value this can read. Absent (`0`/`null`/missing) is not malformed. */
function isMalformedInterval(value: unknown): boolean {
  if (value === undefined || value === null || value === 0) return false;
  return !isPositiveInterval(value);
}

/** A real, comparable interval. `Infinity` is a number and is not one. */
function isPositiveInterval(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Clear the intervals that are not real, on an entry that is being kept.
 *
 * ── The regression this closes ──────────────────────────────────────────────
 *
 * `isUsableScheduleEntry` asks whether an entry has **at least one** usable
 * interval. Once it started accepting either, `{interval_miles: 0,
 * interval_months: 12}` began passing the filter on its months and then
 * **throwing** on its miles, because the field schema is `.positive()`.
 *
 * That created a third outcome where there had only ever been two. The whole
 * design of this preprocess is that a bad entry costs *one entry* — `parse`
 * throws on the entire object, so a schedule with one junk interval took the
 * complete knowledge base with it and left a new user staring at a broken first
 * screen. And `interval_miles: 0` is not exotic: the prompt's own "0 for
 * numbers" fallback produces exactly it.
 *
 * Filtering decides **whether** an entry survives; this decides **what shape**
 * it survives in, so validation only ever sees values it can accept. Anything
 * non-positive or non-finite becomes `null`, which is the honest reading — the
 * entry is time-based, or mileage-based, and the other axis is simply unknown.
 *
 * Found by Cowork on 7 Aug, comparing the backfill's mirror against the real
 * schema. My own tests missed it because they checked `{miles: 0}` alone, which
 * the filter drops, and `{miles: 0, months: 12}` through `isUsableScheduleEntry`
 * but never through `parse`.
 */
function sanitiseScheduleEntry(entry: unknown): unknown {
  const record = entry as Record<string, unknown>;

  return {
    ...record,
    interval_miles: isPositiveInterval(record.interval_miles) ? record.interval_miles : null,
    interval_months: isPositiveInterval(record.interval_months) ? record.interval_months : null,
  };
}

export const VehicleDataSchema = z.object({
  known_issues: z.array(z.object({
    part: z.string(),
    mileage_range: z.string(),
    severity: z.enum(['Low', 'Medium', 'High']),
    description: z.string(),
  })).default([]),
  /*
    Structured, and that is a recent and deliberate change.

    This used to be `{item, interval: string, priority}` — an interval like
    "every 30,000 miles" as prose. `MaintenanceScheduleItem` in `types.ts` has
    declared the structured shape the whole time and **nothing produced it**;
    `app/actions.ts` reconciled the two with `item.item || item.service`. A type
    that describes a contract nothing satisfies is the same failure as
    `build_assets.py` being referenced everywhere and never committed.

    It is structured now because a service-due notification has to compare an
    interval against an odometer reading, and prose cannot be compared to
    anything. `performance_stats` in the same prompt already forces numerics out
    of the model for the same reason — this finishes that pattern rather than
    inventing one.

    `interval_miles` is `positive()` rather than `nonnegative()` on purpose. The
    prompt's own "0 for numbers" fallback would otherwise produce a service due
    at zero miles — that is, overdue on every car, forever. A model that does
    not know an interval must omit the entry, and the schema is what holds it
    to that.

    ── Why the entries are filtered before validation, not validated ──────────

    Because this schema guards **onboarding**, and `parse` throws on the whole
    object. One hallucinated interval in a list of twelve would otherwise fail
    the entire knowledge base and leave a new user staring at a broken first
    screen — the strictness would cost more than the bad row it caught.

    Dropping the entry instead degrades in the right direction: the car gets a
    schedule with eleven services on it, and the twelfth is absent rather than
    wrong. Absent is recoverable and visible; wrong is neither.

    ── Either interval, not both ──────────────────────────────────────────────

    `interval_miles` is nullable because **a brake fluid flush has no mileage
    interval**, on any of the four cars in this product. Requiring one was a
    half-fix: the read side learned about time on 7 Aug and this did not, so a
    time-only entry could be evaluated but never stored. `isUsableScheduleEntry`
    holds the "at least one real interval" rule; these types describe the shape
    of whatever survives it.

    `.finite()` on both, because `.positive()` accepts `Infinity` — which is a
    number, passes every check written here before today, and describes a
    service that is never due.
  */
  maintenance_schedule: z.preprocess(
    (raw) =>
      Array.isArray(raw) ? raw.filter(isUsableScheduleEntry).map(sanitiseScheduleEntry) : [],
    z.array(z.object({
      service: z.string().min(1),
      interval_miles: z.number().positive().finite().nullable().optional(),
      interval_months: z.number().positive().finite().nullable().optional(),
      description: z.string().optional().default(''),
      priority: z.enum(['Critical', 'Recommended', 'Optional']),
    }))
  ).default([]),
  fluid_specs: z.object({
    engine_oil: z.string().optional().default('Unknown'),
    transmission_fluid: z.string().optional().default('Unknown'),
    coolant: z.string().optional().default('Unknown'),
    brake_fluid: z.string().optional().default('Unknown'),
  }).default({}),
  common_mods: z.array(z.object({
    name: z.string(),
    purpose: z.string(),
    difficulty: z.enum(['Easy', 'Moderate', 'Hard']),
  })).default([]),
  powertrain: z.object({
    engine_type: z.string().nullable().optional(),
    transmission_type: z.string().nullable().optional(),
    drivetrain: z.string().nullable().optional(),
  }).optional().default({}),
  performance_stats: z.object({
    horsepower: z.number().nullable().optional(),
    torque: z.number().nullable().optional(),
    zero_to_sixty: z.number().nullable().optional(),
  }).optional().default({}),
  interesting_facts: z.array(z.string()).default([]),
  reliability_score: z.number().min(1).max(10).default(5),
});

export function extractJSON(text: string): any {
  try {
    const trimmed = text.trim();

    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      const jsonMatch = trimmed.match(/^[\s\S]*?(\{[\s\S]*\}|\[[\s\S]*\])[\s\S]*?$/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[1]);
      }
    }

    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      return JSON.parse(codeBlockMatch[1].trim());
    }

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }

    throw new Error('No valid JSON found in response');
  } catch (error) {
    console.error('JSON extraction failed:', error);
    throw error;
  }
}

export function detectUncertainPowertrainFields(
  engine_type: string | null | undefined,
  transmission_type: string | null | undefined,
  drivetrain: string | null | undefined
) {
  const UNCERTAINTY_MARKER = ' or ';

  const parseOptions = (value: string | null | undefined): string[] | undefined => {
    if (!value) return undefined;
    return value.split(UNCERTAINTY_MARKER).map(opt => opt.trim()).filter(opt => opt.length > 0);
  };

  const engineIsUncertain = !!(engine_type?.toLowerCase().includes(UNCERTAINTY_MARKER.toLowerCase()));
  const transmissionIsUncertain = !!(transmission_type?.toLowerCase().includes(UNCERTAINTY_MARKER.toLowerCase()));
  const drivetrainIsUncertain = !!(drivetrain?.toLowerCase().includes(UNCERTAINTY_MARKER.toLowerCase()));

  const hasUncertainty = engineIsUncertain || transmissionIsUncertain || drivetrainIsUncertain;

  return {
    hasUncertainty,
    uncertainFields: {
      ...(engineIsUncertain && {
        engine: {
          isUncertain: true,
          rawValue: engine_type!,
          options: parseOptions(engine_type),
        },
      }),
      ...(transmissionIsUncertain && {
        transmission: {
          isUncertain: true,
          rawValue: transmission_type!,
          options: parseOptions(transmission_type),
        },
      }),
      ...(drivetrainIsUncertain && {
        drivetrain: {
          isUncertain: true,
          rawValue: drivetrain!,
          options: parseOptions(drivetrain),
        },
      }),
    },
    rawValues: {
      engine: engine_type ?? null,
      transmission: transmission_type ?? null,
      drivetrain: drivetrain ?? null,
    },
  };
}
