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
 * A mileage interval, held to the rule `isUsableScheduleEntry` actually applies.
 *
 * `positive()` rather than `nonnegative()` for the reason the real schema gives:
 * a 0-mile interval is a service due at zero miles, overdue on every car
 * forever.
 *
 * `finite()` because `positive()` alone accepts `Infinity` — also caught by the
 * equivalence test, and the real filter's `Number.isFinite` rejects it. An
 * infinite interval is a service that comes due never, which reads as "handled"
 * on a screen whose whole job is to say when things are due.
 */
const IntervalNumber = z.number().positive().finite();

/** A service with a mileage interval — what `VehicleDataSchema` accepts today. */
export const MileageEntrySchema = z.object({
  service: ServiceName,
  interval_miles: IntervalNumber,
  interval_months: IntervalNumber.nullable().optional(),
  description: z.string().optional().default(''),
  priority: z.enum(['Critical', 'Recommended', 'Optional']),
});

/**
 * A service with only a time interval — what `VehicleDataSchema` does **not**
 * accept, and the reason this file has two schemas instead of one.
 *
 * `c09ccf8` taught the read side about `interval_months`: `evaluateSchedule`
 * treats a time-only service as first-class and returns `unknown` rather than
 * dropping it. The write side did not move with it. `VehicleDataSchema`
 * preprocesses the array through `isUsableScheduleEntry`, which requires
 * `interval_miles > 0`, so a brake-fluid entry validated through it is filtered
 * out before validation ever runs — silently, and with an empty array as the
 * only symptom.
 *
 * All four cars in the product have a time-only brake-fluid entry. Sending them
 * through the real schema on the way in would delete the exact rows c09ccf8 was
 * written to save.
 *
 * The rules are otherwise identical: a positive number of months, never 0,
 * because 0 months means due immediately — the same trap as `interval_miles: 0`.
 */
export const TimeOnlyEntrySchema = z.object({
  service: ServiceName,
  interval_miles: z.null(),
  interval_months: IntervalNumber,
  description: z.string().optional().default(''),
  priority: z.enum(['Critical', 'Recommended', 'Optional']),
});

/**
 * Validate one composed entry down whichever branch it belongs to.
 *
 * Returns the value to write, or the reason it cannot be written. An entry that
 * carries neither interval is a failure rather than a silent drop: the service
 * exists on the row today and losing it to a backfill would be a regression,
 * so the caller keeps the original legacy object instead.
 */
export function validateEntry(entry) {
  const candidate = {
    service: entry.service,
    interval_miles: entry.interval_miles,
    interval_months: entry.interval_months,
    description: entry.description,
    priority: entry.priority,
  };

  const explain = (error) =>
    error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');

  if (typeof candidate.interval_miles === 'number') {
    const result = MileageEntrySchema.safeParse(candidate);
    return result.success
      ? { ok: true, value: result.data, path: 'mileage' }
      : { ok: false, why: explain(result.error) };
  }

  if (typeof candidate.interval_months === 'number') {
    const result = TimeOnlyEntrySchema.safeParse({ ...candidate, interval_miles: null });
    return result.success
      ? { ok: true, value: result.data, path: 'time-only' }
      : { ok: false, why: explain(result.error) };
  }

  return { ok: false, why: 'neither a mileage nor a time interval could be read' };
}
