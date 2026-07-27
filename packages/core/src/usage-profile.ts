/**
 * How the owner uses a vehicle — daily driver, weekend car, stored, for sale.
 *
 * These are **not states**, and that distinction is the whole reason this file
 * exists. They previously borrowed the semantic palette: daily driver was
 * confirm-green, stored was attention-amber, for sale was critical-red. So a
 * car you had deliberately parked for the winter wore the same amber as a
 * vehicle needing attention, and one you were selling wore the red reserved
 * for recalls. The colour asserted something about the car's condition that
 * the label never claimed.
 *
 * All four are neutral chips now. Severity stays with the things that are
 * actually severe.
 *
 * Lived in two components before this, with the alphas already drifted apart
 * (bg-white/15 in one, /12 in the other) — which is how a shared lookup tells
 * you it wants to be shared.
 */

export type UsageProfile = 'daily_driver' | 'weekend' | 'stored' | 'for_sale';

export interface UsageProfileChip {
  label: string;
  /** Tailwind classes for the chip. Neutral by design — see above. */
  className: string;
}

/** The house neutral chip: quiet enough that real severity still reads. */
const NEUTRAL = 'text-white/70 bg-white/5 border-white/12';

export const USAGE_PROFILES: Record<UsageProfile, UsageProfileChip> = {
  daily_driver: { label: 'Daily Driver', className: NEUTRAL },
  weekend: { label: 'Weekend', className: NEUTRAL },
  stored: { label: 'Stored', className: NEUTRAL },
  for_sale: { label: 'For Sale', className: NEUTRAL },
};

/** Falls back to a readable chip rather than rendering an unstyled label. */
export function usageProfileChip(status: string | null | undefined): UsageProfileChip {
  if (status && status in USAGE_PROFILES) {
    return USAGE_PROFILES[status as UsageProfile];
  }
  return { label: 'Daily Driver', className: NEUTRAL };
}
