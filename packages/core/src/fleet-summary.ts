import { firstEmbed } from './vehicle-embed';
import type { OrderableVehicle } from './garage-order';

/**
 * What is true of the whole garage, in the three facts a header can carry.
 *
 * ── Why a page called "A Live Garage" needs one ─────────────────────────────
 *
 * The headline zone occupied the left third of a 1440 viewport and the rest was
 * empty — and a design critique put the two together: a page claiming to be
 * live, with the live part missing, next to the space it would have gone in.
 *
 * ── ⚠ What it refuses to say ────────────────────────────────────────────────
 *
 * `scored` is counted separately from `count`, and the average is over the
 * scored cars alone. A garage of three where one has never been assessed has an
 * average of two cars, and the caller has the number it needs to say so rather
 * than quietly presenting it as an average of three.
 *
 * `averageScore` is `null` when nothing is scored — never 0. This codebase's
 * standing rule: a missing score is "we cannot say", and rendering it as a
 * reading is the failure the whole health system was rebuilt around.
 *
 * ⚠ And there is deliberately **no all-clear**. When `openRecalls` is 0 this
 * returns 0, and a caller must not turn that into "no open recalls" — the
 * lookup that produced it may never have run. §10, and `recallsWereChecked` is
 * where that question is answered.
 */
export interface FleetSummary {
  /** Cars in the garage. */
  count: number;
  /** How many carry a health score, which is not necessarily all of them. */
  scored: number;
  /** Mean of the scored cars, rounded. `null` when none are scored. */
  averageScore: number | null;
  /** Open recall campaigns across the garage. */
  openRecalls: number;
}

export function fleetSummary(vehicles: readonly OrderableVehicle[]): FleetSummary {
  let scored = 0;
  let total = 0;
  let openRecalls = 0;

  for (const vehicle of vehicles) {
    openRecalls += firstEmbed(vehicle.nhtsa_data)?.recalls?.length ?? 0;

    const score = firstEmbed(vehicle.vehicle_health_summary)?.health_score;
    if (typeof score === 'number' && Number.isFinite(score)) {
      scored += 1;
      total += score;
    }
  }

  return {
    count: vehicles.length,
    scored,
    averageScore: scored > 0 ? Math.round(total / scored) : null,
    openRecalls,
  };
}
