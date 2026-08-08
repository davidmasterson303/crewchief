/**
 * The shape a backfilled schedule entry has to have, in a form a script can use.
 *
 * `VehicleDataSchema.maintenance_schedule` in `packages/core/src/vehicle-utils.ts`
 * is the source of truth and this is a mirror of it. A mirror, because the repo
 * has no TypeScript transpiler for `scripts/` and the real schema is TypeScript;
 * a *checked* mirror, because `scripts/__tests__/schedule-entry-shape.test.ts`
 * runs the real schema and this one against the same table of cases and fails if
 * they ever answer differently.
 *
 * That test is the whole justification for the duplication. This codebase has
 * already been bitten twice by a contract declared in two places — `VehicleDataSchema`
 * itself was defined twice, and `MaintenanceScheduleItem` described a structured
 * shape nothing produced. A second declaration is only defensible when something
 * breaks the moment the two disagree.
 *
 * ── One schema again, as of `c2c5af8` ───────────────────────────────────────
 *
 * This file used to carry two: `MileageEntrySchema` for what the real schema
 * accepted, and `TimeOnlyEntrySchema` for what it dropped. The split existed
 * because `isUsableScheduleEntry` required `interval_miles > 0`, so a brake-fluid
 * entry — time interval, no mileage — was filtered out before validation ever
 * ran, silently, with an empty array as the only symptom. `evaluateSchedule` had
 * already learned to read months; the write side had not, and the backfill routed
 * around it.
 *
 * `c2c5af8` fixed the write side: `isUsableScheduleEntry` now accepts *either*
 * interval and applies `Number.isFinite` to both. The route-around is obsolete,
 * so the two schemas collapse back into the one they were mirroring. A time-only
 * entry now goes through the same door as everything else.
 */

import { z } from 'zod';

/**
 * A service name, held to the rule `isUsableScheduleEntry` actually applies.
 *
 * `.min(1)` is not that rule and the equivalence test caught it: a service of
 * `"   "` passes a length check and fails `service.trim().length > 0`, so the
 * mirror would have written an entry the real schema drops. Three spaces on a
 * milestone screen is not a service anyone can act on.
 */
const ServiceName = z.string().refine((s) => s.trim().length > 0, {
  message: 'service must not be blank',
});

/**
 * An interval, held to the rule `isPositiveInterval` actually applies.
 *
 * `positive()` rather than `nonnegative()` for the reason the real schema gives:
 * a 0-mile interval is a service due at zero miles, overdue on every car
 * forever. 0 months is the same trap said in the other unit.
 *
 * `finite()` because `positive()` alone accepts `Infinity` — which is a number,
 * passes every check this file carried before, and describes a service that is
 * never due. That reads as "handled" on a screen whose whole job is to say when
 * things are due. The real schema applies `.finite()` to both fields as of
 * `c2c5af8`; this is no longer the one place the two deliberately differ.
 */
const Interval = z.number().positive().finite();

/** Present, absent, or explicitly absent — `null` is how the backfill writes "no mileage". */
const OptionalInterval = Interval.nullable().optional();

/**
 * One schedule entry, mirroring `VehicleDataSchema.maintenance_schedule` and the
 * `isUsableScheduleEntry` filter that runs in front of it.
 *
 * The `refine` is that filter's surviving half: an entry needs at least one real
 * interval. Note what is deliberately *not* here — no coercion. An entry whose
 * `interval_miles` is the string `"7500"` is rejected rather than quietly read
 * as a time-only entry, which is what the two-schema version did to it.
 */
export const ScheduleEntrySchema = z
  .object({
    service: ServiceName,
    interval_miles: OptionalInterval,
    interval_months: OptionalInterval,
    description: z.string().optional().default(''),
    priority: z.enum(['Critical', 'Recommended', 'Optional']),
  })
  .refine(
    (entry) =>
      typeof entry.interval_miles === 'number' || typeof entry.interval_months === 'number',
    { message: 'neither a mileage nor a time interval could be read' }
  );

/**
 * Validate one composed entry.
 *
 * Returns the value to write, or the reason it cannot be written. An entry that
 * carries neither interval is a failure rather than a silent drop: the service
 * exists on the row today and losing it to a backfill would be a regression,
 * so the caller keeps the original legacy object instead.
 *
 * `path` is for the dry run's benefit — it says which kind of entry this turned
 * out to be, so a report can group time-only services separately from mileage
 * ones without re-deriving it.
 */
export function validateEntry(entry) {
  /*
    `?? null` normalises a missing field to the explicit `null` the column
    stores. It deliberately does not touch a value of the wrong *type*: turning
    `"7500"` into `null` would convert a malformed mileage entry into a
    well-formed time-only one, which is a silent corruption rather than a fix.
  */
  const candidate = {
    service: entry.service,
    interval_miles: entry.interval_miles ?? null,
    interval_months: entry.interval_months ?? null,
    description: entry.description,
    priority: entry.priority,
  };

  const explain = (error) =>
    error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');

  const result = ScheduleEntrySchema.safeParse(candidate);
  if (!result.success) return { ok: false, why: explain(result.error) };

  return {
    ok: true,
    value: result.data,
    path: typeof result.data.interval_miles === 'number' ? 'mileage' : 'time-only',
  };
}
