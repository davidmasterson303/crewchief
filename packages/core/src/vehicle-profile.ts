import { USAGE_PROFILES, type UsageProfile } from './usage-profile';

/**
 * The four answers an owner gave about their car, and the rules for changing them.
 *
 * ── Why these were read-only for so long, and why that stopped being fine ───
 *
 * They are collected once, during add-a-car, and then rendered on the vehicle
 * screen under "What you told us". David, 23 Aug: *"why are we showing these
 * details with no option to update? all should be editable."*
 *
 * The reason they were not is narrower than it looks and worth stating: nothing
 * in the app could write them. `PATCH /api/v1/vehicles` accepted
 * `currentMileage` and nothing else, so the screen was displaying four values
 * with no write path at any layer. Showing a fact you refuse to let someone
 * correct is worse than not showing it — it reads as the product knowing better.
 *
 * ── ⚠ Three of these change what the product *does* ─────────────────────────
 *
 * This is not a settings page of cosmetic preferences:
 *
 *   - `performanceMindedness` gates the entire modifications surface.
 *     `showsModifications` returns false for `stock`, which hides the Build
 *     route. It is the "way back" `mod-progression.ts` says that answer owes
 *     the owner — *"`stock` is the one genuine off switch, and it is 'not now'
 *     rather than 'never', which is exactly why it owes the owner a way to turn
 *     it back on."* Until now there was no way.
 *   - `avgMilesPerMonth` feeds every mileage-based service projection.
 *   - `vehicleStatus` is the usage profile the dossier is written against.
 *
 * So a bad value here is not a cosmetic defect, and every one is checked.
 */

/** What `performance_mindedness` may hold. `stock` is the off switch. */
export const MINDEDNESS = ['stock', 'mild', 'moderate', 'aggressive'] as const;
export type Mindedness = (typeof MINDEDNESS)[number];

export const MINDEDNESS_LABELS: Record<Mindedness, string> = {
  stock: 'Keep it stock',
  mild: 'Mild',
  moderate: 'Moderate',
  aggressive: 'Aggressive',
};

/**
 * ⚠ An objective is prose and stays prose.
 *
 * It is the sentence the dossier and the advisor are written against — "keep it
 * reliable past 200,000 miles without over-spending" is a real answer that no
 * enum could hold. The only rule is a length, and it exists because this string
 * reaches a model prompt: unbounded text from a client into a prompt is the
 * shape `consultant-context.ts` already carries a warning about.
 */
export const OBJECTIVE_MAX = 280;

/**
 * A plausible monthly mileage.
 *
 * 0 is legitimate — a stored car — so the floor is not 1. The ceiling is a
 * sanity check rather than a judgement: 20,000 a month is 240,000 a year, which
 * is beyond any private vehicle and is what a mistyped odometer reading looks
 * like when it lands in this field.
 */
export const AVG_MILES_MAX = 20_000;

export interface VehicleProfile {
  avgMilesPerMonth: number | null;
  vehicleStatus: UsageProfile | null;
  performanceMindedness: Mindedness | null;
  ownershipObjective: string | null;
}

export interface ProfileDecision {
  ok: boolean;
  /** Written for the person who typed it, not for a log. */
  message?: string;
  /** Only the fields that were actually supplied, normalised. */
  changes?: Partial<{
    avg_miles_per_month: number;
    vehicle_status: string;
    performance_mindedness: string;
    ownership_objective: string;
  }>;
}

function isUsageProfile(value: unknown): value is UsageProfile {
  return typeof value === 'string' && value in USAGE_PROFILES;
}

function isMindedness(value: unknown): value is Mindedness {
  return typeof value === 'string' && (MINDEDNESS as readonly string[]).includes(value);
}

/**
 * Validate a partial profile update, returning the columns to write.
 *
 * ── ⚠ Partial by design, and `undefined` is not `null` ──────────────────────
 *
 * A caller sends only what changed. `undefined` means "leave it alone"; an
 * explicit `null` is not accepted for any of these, because none of them has a
 * meaningful empty state — a car has a usage, a goal and an objective, and
 * "unset" is a state only the add-a-car flow can produce. Clearing one would
 * put a vehicle into a shape no screen is written for.
 *
 * Shared by both clients and by the route, so the phone can refuse a bad value
 * without spending a round trip and the server can refuse it regardless —
 * exactly the split `mileage-tracking.ts` already uses.
 */
export function validateProfileUpdate(input: Record<string, unknown>): ProfileDecision {
  const changes: NonNullable<ProfileDecision['changes']> = {};

  if (input.avgMilesPerMonth !== undefined) {
    const miles = Number(input.avgMilesPerMonth);
    if (!Number.isFinite(miles) || !Number.isInteger(miles) || miles < 0) {
      return { ok: false, message: 'Enter your average monthly mileage as a whole number.' };
    }
    if (miles > AVG_MILES_MAX) {
      return {
        ok: false,
        message: `${miles.toLocaleString('en-US')} miles a month is more than any car covers — check that figure.`,
      };
    }
    changes.avg_miles_per_month = miles;
  }

  if (input.vehicleStatus !== undefined) {
    if (!isUsageProfile(input.vehicleStatus)) {
      return { ok: false, message: 'Pick how you use this car.' };
    }
    changes.vehicle_status = input.vehicleStatus;
  }

  if (input.performanceMindedness !== undefined) {
    if (!isMindedness(input.performanceMindedness)) {
      return { ok: false, message: 'Pick what you want from this car.' };
    }
    changes.performance_mindedness = input.performanceMindedness;
  }

  if (input.ownershipObjective !== undefined) {
    const objective = typeof input.ownershipObjective === 'string' ? input.ownershipObjective.trim() : '';
    if (!objective) {
      return { ok: false, message: 'Say what you want out of this car, in a sentence.' };
    }
    if (objective.length > OBJECTIVE_MAX) {
      return {
        ok: false,
        message: `Keep that to ${OBJECTIVE_MAX} characters — it is ${objective.length}.`,
      };
    }
    changes.ownership_objective = objective;
  }

  /*
    ⚠ An empty update is refused rather than treated as a no-op success. A PATCH
    that writes nothing and returns 200 is indistinguishable from one that
    worked, which is how a screen ends up reporting "saved" for a body the
    server did not understand — a field renamed on one side and silently
    dropped on the other.
  */
  if (Object.keys(changes).length === 0) {
    return { ok: false, message: 'Nothing to change.' };
  }

  return { ok: true, changes };
}
