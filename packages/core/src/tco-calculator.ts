/**
 * Total cost of ownership.
 *
 * Extracted verbatim from `components/TCOCard.tsx`, which is where this math
 * lived and shipped from. Nothing here is new; the point of the move is that
 * the numbers the product shows can now be tested, and shared with a mobile
 * client under Phase 2 task 2.4.
 *
 * ── Why this extraction was overdue ─────────────────────────────────────────
 *
 * `lib/__tests__/tco-calculator.test.ts` had **no imports at all**. It defined
 * its own `estimateResaleValue` and `calculateTCO` and tested those, while the
 * shipped implementation sat in a component. Its own header said it tested
 * "the core math extracted from TCOCard" — extracted meaning copied.
 *
 * The two copies then diverged, and not subtly. The aggregation was identical
 * line for line, but the depreciation model was a different model entirely:
 *
 *     age    test's table    shipped (this file)
 *     1      0.80            0.85
 *     3      0.58            0.614
 *     8      0.29            0.272
 *     10+    0.20 floor      decays on to a 0.08 floor
 *
 * So a green TCO suite was asserting a resale curve the product never used.
 * This is the third instance of the pattern in this codebase — `security.test.ts`
 * tested a private `runMiddlewareLogic()` while the real middleware was a
 * no-op, and `rls-ownership.test.ts` tests a `mockVehicleDb` simulation. The
 * fix is the same each time: one implementation, imported by both.
 *
 * **Which curve is correct is a product question and is deliberately not
 * decided here.** This file preserves the shipped behaviour exactly, so the
 * extraction changes no number a user sees. See CREWCHIEF_STATUS.md — the
 * table model is arguably the more realistic one (a 20% first-year drop and a
 * 20% floor are closer to real resale than 15%/8%), but changing it changes
 * every TCO figure in the product and that is David's call, not a side effect
 * of a refactor.
 */

export interface TCOVehicle {
  purchase_price?: number | null;
  avg_mpg?: number | null;
  fuel_price_per_gallon?: number | null;
  insurance_monthly?: number | null;
  current_mileage?: number | null;
  avg_miles_per_month?: number | null;
  year?: number | null;
  created_at?: string | null;
}

export interface TCOBreakdown {
  totalFuelCost: number;
  totalInsurance: number;
  /** Service spend for the active scenario — extrapolated when projecting. */
  totalServiceSpend: number;
  depreciation: number;
  resaleValue: number;
  netTCO: number;
  costPerMile: number;
  costPerMonth: number;
  /** Months of ownership the figures cover, including any `extraYears`. */
  monthsOwned: number;
  /** Mileage the figures cover, including any `extraYears`. */
  activeMileage: number;
}

/** Miles per month assumed when a vehicle has no recorded average. */
const DEFAULT_MILES_PER_MONTH = 500;
/** Months of ownership assumed when `created_at` is missing. */
const DEFAULT_MONTHS_OWNED = 12;

/** Straight-line-in-log depreciation: 15% of remaining value per year. */
const ANNUAL_DEPRECIATION_RATE = 0.15;
/** A car is never worth less than this share of what it cost. */
const MIN_RESALE_RATIO = 0.08;

/**
 * Estimated resale value, `extraYears` into the future.
 *
 * Exponential decay with a floor. Verbatim from TCOCard — see the note above
 * about the competing model that the old test asserted.
 */
export function estimateResaleValue(vehicle: TCOVehicle, extraYears = 0): number {
  const purchasePrice = vehicle.purchase_price || 0;
  if (!purchasePrice) return 0;

  const currentYear = new Date().getFullYear();
  const vehicleAge = currentYear - (vehicle.year || currentYear) + extraYears;

  const ratio = Math.max(
    MIN_RESALE_RATIO,
    Math.pow(1 - ANNUAL_DEPRECIATION_RATE, vehicleAge)
  );

  return purchasePrice * ratio;
}

/** How long the vehicle has been owned, in months, floored at 1. */
export function monthsOwned(vehicle: TCOVehicle): number {
  if (!vehicle.created_at) return DEFAULT_MONTHS_OWNED;

  const elapsed = Date.now() - new Date(vehicle.created_at).getTime();
  return Math.max(1, Math.round(elapsed / (1000 * 60 * 60 * 24 * 30)));
}

/**
 * The full breakdown.
 *
 * @param totalServiceSpend  Sum of `maintenance_line_items.total_cost`. Passed
 *                           in rather than fetched, so this stays pure.
 * @param extraYears         The "what if I keep it" projection. 0 is today.
 */
export function calculateTCO(
  vehicle: TCOVehicle,
  totalServiceSpend: number,
  extraYears = 0
): TCOBreakdown {
  const purchasePrice = vehicle.purchase_price || 0;
  const avgMpg = vehicle.avg_mpg || 0;
  const fuelPrice = vehicle.fuel_price_per_gallon || 0;
  const insuranceMonthly = vehicle.insurance_monthly || 0;
  const currentMileage = vehicle.current_mileage || 0;
  const monthlyMiles = vehicle.avg_miles_per_month || DEFAULT_MILES_PER_MONTH;

  const owned = monthsOwned(vehicle);
  const projecting = extraYears > 0;

  const activeMonths = projecting ? owned + extraYears * 12 : owned;
  const activeMileage = projecting
    ? currentMileage + extraYears * 12 * monthlyMiles
    : currentMileage;

  // Fuel is derived from the mileage of whichever scenario is active. Note it
  // is total fuel burned over the mileage, not fuel since purchase.
  const canPriceFuel = avgMpg > 0 && fuelPrice > 0;
  const activeFuelCost = canPriceFuel ? (activeMileage / avgMpg) * fuelPrice : 0;

  const activeInsurance = insuranceMonthly * activeMonths;

  // Future service spend extrapolates the observed rate forward.
  const activeServiceSpend = projecting
    ? totalServiceSpend + (totalServiceSpend / Math.max(1, owned)) * extraYears * 12
    : totalServiceSpend;

  const resaleValue = estimateResaleValue(vehicle, extraYears);
  const depreciation = purchasePrice > 0 ? purchasePrice - resaleValue : 0;

  const netTCO = Math.max(
    0,
    depreciation + activeServiceSpend + activeFuelCost + activeInsurance
  );

  return {
    totalFuelCost: activeFuelCost,
    totalInsurance: activeInsurance,
    totalServiceSpend: activeServiceSpend,
    depreciation,
    resaleValue,
    netTCO,
    costPerMile: activeMileage > 0 && netTCO > 0 ? netTCO / activeMileage : 0,
    costPerMonth: activeMonths > 0 ? netTCO / activeMonths : 0,
    monthsOwned: activeMonths,
    activeMileage,
  };
}
