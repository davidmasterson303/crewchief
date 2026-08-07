/**
 * Whether a proposed odometer reading may be stored.
 *
 * ── Why this is a rule and not an `if` in the route ─────────────────────────
 *
 * Because two clients ask the question. The phone should tell someone their
 * reading looks wrong *before* spending a round trip on it; the route has to
 * refuse it regardless, because a client is not a guarantee. A second copy of
 * the thresholds drifts, and the direction matters: a phone stricter than the
 * server refuses valid readings, and one looser sends requests that always
 * fail. Same argument `push-tokens.ts` makes about the token format.
 *
 * ── The odometer goes up, except when the owner mistyped ────────────────────
 *
 * A pure monotonic rule is the obvious design and it is a trap. Enter 160000
 * for 16000 once and every future reading is below the stored value, so the
 * car is locked at a wrong number **forever** — and the only escape is a
 * support channel this product does not have. The wrong reading then feeds
 * every service-due calculation after it.
 *
 * So a decrease is refused by default and permitted as an explicit
 * `isCorrection`. That is what separates the two journeys: confirming a
 * reading from a notification must never move the number down, and fixing a
 * typo must be possible. The flag makes the caller say which one it is
 * instead of the rule guessing.
 */
export type MileageRejection =
  | 'not-a-number'
  | 'out-of-range'
  | 'went-backwards'
  | 'implausible-jump';

export interface MileageDecision {
  ok: boolean;
  reason?: MileageRejection;
  /** Owner-facing, because every one of these is a thing a person did. */
  message?: string;
}

/**
 * No production vehicle reaches this. It exists to catch a paste or a stray
 * digit, not to have an opinion about high-mileage cars.
 */
const MAX_PLAUSIBLE_MILEAGE = 2_000_000;

/**
 * A single update adding more than this is a typo far more often than it is a
 * year of driving — and unlike the decrease case, it is silently plausible.
 * Also gated behind `isCorrection`, so a genuine one is still possible.
 */
const MAX_SINGLE_JUMP = 100_000;

export function validateMileageUpdate(params: {
  current: number;
  next: unknown;
  isCorrection?: boolean;
}): MileageDecision {
  const { current, next, isCorrection = false } = params;

  if (typeof next !== 'number' || !Number.isFinite(next) || !Number.isInteger(next)) {
    return { ok: false, reason: 'not-a-number', message: 'Enter the reading as a whole number.' };
  }

  if (next < 0 || next > MAX_PLAUSIBLE_MILEAGE) {
    return {
      ok: false,
      reason: 'out-of-range',
      message: 'That reading looks out of range — check the digits.',
    };
  }

  if (next < current && !isCorrection) {
    return {
      ok: false,
      reason: 'went-backwards',
      message: `That is below the ${current.toLocaleString('en-US')} miles already recorded. Correcting an earlier mistake?`,
    };
  }

  if (next - current > MAX_SINGLE_JUMP && !isCorrection) {
    return {
      ok: false,
      reason: 'implausible-jump',
      message: `That adds over ${MAX_SINGLE_JUMP.toLocaleString('en-US')} miles since the last reading — check the digits.`,
    };
  }

  return { ok: true };
}

export interface MileageUpdateStatus {
  isDue: boolean;
  estimatedMilesDriven: number;
  monthsSinceLast: number;
  estimatedMilesForMonth: number;
}

export function calculateMileageUpdateStatus(
  vehicle: {
    current_mileage: number;
    avg_miles_per_month: number | null;
    last_mileage_update_date: string | null;
  }
): MileageUpdateStatus {
  const now = new Date();
  const lastUpdate = vehicle.last_mileage_update_date
    ? new Date(vehicle.last_mileage_update_date)
    : new Date(vehicle.last_mileage_update_date || Date.now());

  const diffMs = now.getTime() - lastUpdate.getTime();
  const diffMonths = diffMs / (1000 * 60 * 60 * 24 * 30.44);

  const avgMilesPerMonth = vehicle.avg_miles_per_month || 0;
  const estimatedMilesDriven = Math.round(diffMonths * avgMilesPerMonth);

  return {
    isDue: estimatedMilesDriven >= avgMilesPerMonth && avgMilesPerMonth > 0,
    estimatedMilesDriven,
    monthsSinceLast: Math.floor(diffMonths),
    estimatedMilesForMonth: avgMilesPerMonth,
  };
}

export function formatMileagePromptMessage(status: MileageUpdateStatus): string {
  if (status.estimatedMilesDriven < 50) {
    return `You've driven an estimated ${status.estimatedMilesDriven} miles since your last update`;
  }

  const months = Math.max(1, status.monthsSinceLast);
  return `Time to update! You've driven an estimated ${status.estimatedMilesDriven} miles in the last ${months} month${months > 1 ? 's' : ''}`;
}
