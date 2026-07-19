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
