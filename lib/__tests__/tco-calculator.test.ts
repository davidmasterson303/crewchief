/**
 * Test Suite 2: TCO Calculator Math
 *
 * Verifies that the TCO calculation logic produces correct outputs given
 * a known mock vehicle dataset. Tests the core math extracted from TCOCard.
 */

interface VehicleInput {
  purchase_price?: number;
  avg_mpg?: number;
  fuel_price_per_gallon?: number;
  insurance_monthly?: number;
  current_mileage?: number;
  avg_miles_per_month?: number;
  year?: number;
  created_at?: string;
}

function estimateResaleValue(vehicle: VehicleInput, extraYears = 0): number {
  const purchasePrice = vehicle.purchase_price || 0;
  if (!purchasePrice) return 0;

  const currentYear = new Date().getFullYear();
  const vehicleYear = vehicle.year || currentYear;
  const vehicleAge = currentYear - vehicleYear + extraYears;

  const depreciationTable: Record<number, number> = {
    0: 1.0, 1: 0.8, 2: 0.68, 3: 0.58, 4: 0.5,
    5: 0.44, 6: 0.38, 7: 0.33, 8: 0.29, 9: 0.25,
  };

  const ratio = vehicleAge >= 10 ? 0.2 : (depreciationTable[vehicleAge] ?? 0.2);
  return purchasePrice * ratio;
}

function calculateTCO(vehicle: VehicleInput, totalServiceSpend: number, extraYears = 0) {
  const purchasePrice = vehicle.purchase_price || 0;
  const avgMpg = vehicle.avg_mpg || 0;
  const fuelPrice = vehicle.fuel_price_per_gallon || 0;
  const insuranceMonthly = vehicle.insurance_monthly || 0;
  const currentMileage = vehicle.current_mileage || 0;
  const monthlyMiles = vehicle.avg_miles_per_month || 500;

  const monthsOwned = vehicle.created_at
    ? Math.max(1, Math.round((Date.now() - new Date(vehicle.created_at).getTime()) / (1000 * 60 * 60 * 24 * 30)))
    : 12;

  const futureMonths = monthsOwned + extraYears * 12;
  const futureMileage = currentMileage + extraYears * 12 * monthlyMiles;

  const activeMileage = extraYears > 0 ? futureMileage : currentMileage;
  const activeMonths = extraYears > 0 ? futureMonths : monthsOwned;

  const totalFuelCost = avgMpg > 0 && fuelPrice > 0 ? (currentMileage / avgMpg) * fuelPrice : 0;
  const futureFuelCost = avgMpg > 0 && fuelPrice > 0 ? (futureMileage / avgMpg) * fuelPrice : totalFuelCost;
  const activeFuelCost = extraYears > 0 ? futureFuelCost : totalFuelCost;

  const totalInsurance = insuranceMonthly * monthsOwned;
  const futureInsurance = insuranceMonthly * futureMonths;
  const activeInsurance = extraYears > 0 ? futureInsurance : totalInsurance;

  const futureServiceSpend = extraYears > 0
    ? totalServiceSpend + (totalServiceSpend / Math.max(1, monthsOwned)) * extraYears * 12
    : totalServiceSpend;
  const activeServiceSpend = extraYears > 0 ? futureServiceSpend : totalServiceSpend;

  const resaleValue = estimateResaleValue(vehicle, extraYears);
  const depreciation = purchasePrice > 0 ? purchasePrice - resaleValue : 0;

  const totalCost = depreciation + activeServiceSpend + activeFuelCost + activeInsurance;
  const netTCO = Math.max(0, totalCost);
  const costPerMile = activeMileage > 0 && netTCO > 0 ? netTCO / activeMileage : 0;
  const costPerMonth = activeMonths > 0 ? netTCO / activeMonths : 0;

  return {
    totalFuelCost: activeFuelCost,
    totalInsurance: activeInsurance,
    depreciation,
    resaleValue,
    netTCO,
    costPerMile,
    costPerMonth,
    monthsOwned: activeMonths,
    activeMileage,
  };
}

describe('TCO Calculator', () => {
  const mockVehicle: VehicleInput = {
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
});
