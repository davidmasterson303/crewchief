import { useQuery } from '@tanstack/react-query';

export interface MaintenanceData {
  documents: any[];
  lineItems: any[];
  completedServiceItems: any[];
  maintenanceLineItems: any[];
}

/**
 * Maintenance history through the API. **Currently unreferenced** — see the
 * note on `useVehicle` for why these are kept rather than deleted.
 *
 * Specific to this one: the four tables behind it are not readable by the
 * `anon` role, so it cannot serve a demo vehicle at all. It is a signed-in
 * endpoint, and until the deployed service-role key is fixed it cannot serve
 * anyone. Do not wire a page onto it before then.
 */
export function useMaintenanceData(vehicleId: string | null | undefined) {
  return useQuery({
    queryKey: ['maintenance', vehicleId],
    queryFn: async () => {
      if (!vehicleId) throw new Error('Vehicle ID is required');

      const response = await fetch(`/api/v1/load-maintenance-data?vehicleId=${vehicleId}`);
      if (!response.ok) {
        throw new Error('Failed to load maintenance data');
      }
      return response.json() as Promise<MaintenanceData>;
    },
    enabled: !!vehicleId,
    staleTime: 1000 * 60 * 5,
  });
}
