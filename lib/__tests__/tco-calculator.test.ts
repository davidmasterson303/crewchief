/**
 * TCO math — against the shipped implementation.
 *
 * @jest-environment node
 *
 * This suite had **no imports**. It defined its own `estimateResaleValue` and
 * `calculateTCO` at the top of the file and tested those, while the real math
 * shipped from inside `components/TCOCard.tsx`. Its own header said it covered
 * "the core math extracted from TCOCard" — extracted meaning copied.
 *
 * The copies diverged. The aggregation stayed identical line for line, but the
 * depreciation model became a different model entirely: a lookup table here
 * (0.80 at one year, 0.20 floor) against exponential decay there (0.85^age,
 * 0.08 floor). So every green assertion below was computed on a resale curve
 * the product never used.
 *
 * Third instance of the pattern in this repo, after `security.test.ts` testing
 * a private `runMiddlewareLogic()` against a no-op middleware, and
 * `rls-ownership.test.ts` testing a `mockVehicleDb` simulation. The fix is the
 * same each time: one implementation, imported.
 *
 * Most of the assertions here were also self-referential — `expect(depreciation)
 * .toBe(40000 - result.resaleValue)` restates the implementation and passes
 * against any curve at all. That is why the divergence was survivable for so
 * long. The `the shipped depreciation curve` block at the end exists to fix
 * that: it pins actual numbers, so a change to the model has to be deliberate.
 */

import { calculateTCO, estimateResaleValue, type TCOVehicle } from '@crewchief/core/tco-calculator';

describe('TCO Calculator', () => {
  const mockVehicle: TCOVehicle = {
    purchase_price: 40000,
    avg_mpg: 25,
    fuel_price_per_gallon: 4.0,
    insurance_monthly: 150,
    current_mileage: 30000,
    avg_miles_per_month: 1000,
    year: 2022,
    created_at: new Date(Date.now() - 12 * 30 * 24 * 60 * 60 * 1000).toISOString(),
  };

  describe('fuel cost calculation', () => {
    it('calculates total fuel cost correctly: mileage / mpg * price_per_gallon', () => {
      const result = calculateTCO(mockVehicle, 0);
      const expected = (30000 / 25) * 4.0;
      expect(result.totalFuelCost).toBeCloseTo(expected, 0);
    });

    it('returns 0 fuel cost when mpg is 0', () => {
      const vehicle = { ...mockVehicle, avg_mpg: 0 };
      const result = calculateTCO(vehicle, 0);
      expect(result.totalFuelCost).toBe(0);
    });

    it('returns 0 fuel cost when fuel price is 0', () => {
      const vehicle = { ...mockVehicle, fuel_price_per_gallon: 0 };
      const result = calculateTCO(vehicle, 0);
      expect(result.totalFuelCost).toBe(0);
    });
  });

  describe('insurance calculation', () => {
    it('calculates insurance as monthly rate times months owned', () => {
      const result = calculateTCO(mockVehicle, 0);
      expect(result.totalInsurance).toBeCloseTo(150 * result.monthsOwned, 0);
    });
  });

  describe('depreciation', () => {
    it('calculates depreciation as purchase price minus resale value', () => {
      const result = calculateTCO(mockVehicle, 0);
      expect(result.depreciation).toBe(result.resaleValue > 0
        ? 40000 - result.resaleValue
        : 0);
    });

    it('returns 0 depreciation when purchase price is 0', () => {
      const vehicle = { ...mockVehicle, purchase_price: 0 };
      const result = calculateTCO(vehicle, 1500);
      expect(result.depreciation).toBe(0);
    });
  });

  describe('total cost of ownership', () => {
    it('sums depreciation + service + fuel + insurance correctly', () => {
      const serviceSpend = 2500;
      const result = calculateTCO(mockVehicle, serviceSpend);
      const expected = result.depreciation + serviceSpend + result.totalFuelCost + result.totalInsurance;
      expect(result.netTCO).toBeCloseTo(expected, 0);
    });

    it('netTCO is never negative', () => {
      const vehicle = { ...mockVehicle, purchase_price: 0, avg_mpg: 0, insurance_monthly: 0 };
      const result = calculateTCO(vehicle, 0);
      expect(result.netTCO).toBeGreaterThanOrEqual(0);
    });
  });

  describe('cost per mile and cost per month', () => {
    it('costPerMile equals netTCO / total mileage', () => {
      const result = calculateTCO(mockVehicle, 1000);
      if (result.activeMileage > 0 && result.netTCO > 0) {
        expect(result.costPerMile).toBeCloseTo(result.netTCO / result.activeMileage, 5);
      }
    });

    it('costPerMile is 0 when mileage is 0', () => {
      const vehicle = { ...mockVehicle, current_mileage: 0 };
      const result = calculateTCO(vehicle, 0);
      expect(result.costPerMile).toBe(0);
    });

    it('costPerMonth equals netTCO / months owned', () => {
      const result = calculateTCO(mockVehicle, 1000);
      expect(result.costPerMonth).toBeCloseTo(result.netTCO / result.monthsOwned, 5);
    });

    it('costPerMonth is never NaN or Infinity', () => {
      const result = calculateTCO(mockVehicle, 0);
      expect(isNaN(result.costPerMonth)).toBe(false);
      expect(isFinite(result.costPerMonth)).toBe(true);
    });
  });

  describe('null/undefined safety', () => {
    it('handles completely empty vehicle input without throwing', () => {
      expect(() => calculateTCO({}, 0)).not.toThrow();
    });

    it('returns 0 netTCO when all inputs are missing', () => {
      const result = calculateTCO({}, 0);
      expect(result.netTCO).toBe(0);
    });
  });

  describe('what-if mode (keep 2 more years)', () => {
    it('future mileage increases by monthly_miles * 24', () => {
      const result = calculateTCO(mockVehicle, 1000, 2);
      const expectedFutureMileage = 30000 + 2 * 12 * 1000;
      expect(result.activeMileage).toBe(expectedFutureMileage);
    });

    it('future insurance is higher than current insurance', () => {
      const current = calculateTCO(mockVehicle, 1000, 0);
      const future = calculateTCO(mockVehicle, 1000, 2);
      expect(future.totalInsurance).toBeGreaterThan(current.totalInsurance);
    });
  });

  /*
    The assertions above are self-referential — they restate the implementation
    and pass against any depreciation model, which is exactly why a wrong one
    survived here for months. These pin real numbers.

    Ages are built relative to the current year rather than hardcoding a model
    year, so this does not quietly start testing a different age every January.
  */
  describe('the shipped depreciation curve', () => {
    const currentYear = new Date().getFullYear();
    const atAge = (age: number): TCOVehicle => ({
      purchase_price: 40000,
      year: currentYear - age,
    });

    it.each([
      [0, 40000],
      [1, 34000],
      [3, 24565],
      [8, 10899.62],
    ])('at %i years old, resale is %d — 0.85^age', (age, expected) => {
      expect(estimateResaleValue(atAge(age))).toBeCloseTo(expected, 1);
    });

    it('floors at 8% of purchase price, not 20%', () => {
      // 0.85^20 is about 3.9%, so the floor is doing the work here.
      expect(estimateResaleValue(atAge(20))).toBeCloseTo(40000 * 0.08, 5);
    });

    it('is NOT the lookup-table model this suite used to assert', () => {
      // The old private copy returned 0.80 at one year and floored at 0.20.
      // If someone reinstates that model, it is a product decision that
      // changes every TCO figure in the app — it must not arrive as a
      // silent refactor. See @crewchief/core/tco-calculator.
      expect(estimateResaleValue(atAge(1))).not.toBeCloseTo(40000 * 0.8, 1);
      expect(estimateResaleValue(atAge(20))).not.toBeCloseTo(40000 * 0.2, 1);
    });

    it('projects forward with extraYears', () => {
      // A 3-year-old car kept 2 more years is priced as a 5-year-old car.
      expect(estimateResaleValue(atAge(3), 2)).toBeCloseTo(
        estimateResaleValue(atAge(5)),
        5
      );
    });

    it('treats a missing year as brand new rather than returning NaN', () => {
      /*
        The one behaviour the extraction deliberately changed.

        TCOCard computed `currentYear - vehicle.year` with no fallback, so a
        vehicle carrying a purchase price and no year produced NaN — and
        propagated it through depreciation, netTCO, costPerMile and
        costPerMonth, which would have rendered as "NaN" on the card.

        Unreachable for a persisted row (`vehicles.year` is `int NOT NULL`),
        which is why it was never seen. Fixed rather than faithfully copied,
        because a NaN reaching the UI is not behaviour worth preserving.
        Everything else was verified identical to the original across 2,166
        input combinations at the time of the extraction.
      */
      const result = calculateTCO({ purchase_price: 40000 }, 0);

      expect(result.resaleValue).toBe(40000);
      expect(result.depreciation).toBe(0);
      expect(Number.isNaN(result.netTCO)).toBe(false);
      expect(Number.isNaN(result.costPerMonth)).toBe(false);
    });

    it('is 0 when the purchase price is unknown', () => {
      expect(estimateResaleValue({ year: currentYear - 3 })).toBe(0);
    });
  });
});
