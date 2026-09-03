import { firstEmbed } from './vehicle-embed';

/**
 * The order a garage should be read in: whatever needs the owner, first.
 *
 * ── Why a garage has an opinion ─────────────────────────────────────────────
 *
 * Ordered by `created_at`, three cars carry identical weight and the page says
 * nothing about which one matters — the grid is a database view rather than a
 * composition. A garage whose whole promise is "we watch this for you" should
 * open on the car that is asking for something.
 *
 * So: open recalls first, because a federal defect notice outranks everything
 * else here; then the lowest health score, because that is the product's own
 * judgement of what needs attention. Ties keep their original order, which
 * keeps the result stable for a garage where nothing is wrong.
 *
 * ⚠ A missing score sorts as **neutral, never as worst**. `null` is "we have
 * not assessed this", and floating an unassessed car to the top would be the
 * same claim-from-absence this codebase removes everywhere else — a car nobody
 * has looked at is not thereby the one in trouble.
 */
export interface OrderableVehicle {
  nhtsa_data?: { recalls?: unknown[] } | { recalls?: unknown[] }[] | null;
  vehicle_health_summary?:
    | { health_score?: number | null }
    | { health_score?: number | null }[]
    | null;
}

/** Recall count, health score — the two facts the order is made of. */
function attention(vehicle: OrderableVehicle): { recalls: number; score: number } {
  const recalls = firstEmbed(vehicle.nhtsa_data)?.recalls?.length ?? 0;
  const score = firstEmbed(vehicle.vehicle_health_summary)?.health_score;

  return {
    recalls,
    /*
      50 is the middle of the scale, so an unscored car sorts among the ordinary
      ones rather than at either end. Not 0 — that would rank it as the worst
      car in the garage on the strength of never having been looked at.
    */
    score: typeof score === 'number' && Number.isFinite(score) ? score : 50,
  };
}

/** A stable copy of `vehicles`, most in need of attention first. */
export function byAttention<T extends OrderableVehicle>(vehicles: readonly T[]): T[] {
  return vehicles
    .map((vehicle, index) => ({ vehicle, index, ...attention(vehicle) }))
    .sort((a, b) => {
      if (a.recalls !== b.recalls) return b.recalls - a.recalls;
      if (a.score !== b.score) return a.score - b.score;
      /* Stable: equal cars keep the order the query returned them in. */
      return a.index - b.index;
    })
    .map((entry) => entry.vehicle);
}
