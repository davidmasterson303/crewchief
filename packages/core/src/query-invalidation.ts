import { queryClient } from './query-client';

/**
 * Invalidates all dashboard-related query caches for a given vehicle.
 * Call this after any mutation that changes vehicle data (mileage, issue status,
 * mod status, wishlist changes, maintenance history, etc.).
 */
export function invalidateDashboardCache(vehicleId: string) {
  queryClient.invalidateQueries({ queryKey: ['dashboard', vehicleId] });
  queryClient.invalidateQueries({ queryKey: ['wishlist', vehicleId] });
  queryClient.invalidateQueries({ queryKey: ['serviceItems', vehicleId] });
  queryClient.invalidateQueries({ queryKey: ['vehicle', vehicleId] });
  queryClient.invalidateQueries({ queryKey: ['maintenance', vehicleId] });
}

/**
 * Invalidates the garage-level vehicle list cache.
 * Call this after any vehicle is added or deleted to refresh the garage page.
 */
export async function invalidateGarageCache() {
  await Promise.all([
    queryClient.refetchQueries({ queryKey: ['vehicles'] }),
    queryClient.refetchQueries({ queryKey: ['garage'] }),
    queryClient.refetchQueries({ queryKey: ['allVehicles'] })
  ]);
}

/**
 * Invalidates all vehicle-related caches.
 * This is a nuclear option - use for major state changes.
 * Call this after deletion or critical mutations affecting multiple vehicles.
 */
export function invalidateAllVehicleQueries() {
  queryClient.invalidateQueries({ queryKey: ['vehicles'] });
  queryClient.invalidateQueries({ queryKey: ['vehicle'] });
  queryClient.invalidateQueries({ queryKey: ['garage'] });
  queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  queryClient.invalidateQueries({ queryKey: ['allVehicles'] });
}
