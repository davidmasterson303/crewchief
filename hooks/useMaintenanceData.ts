import { useQuery } from '@tanstack/react-query';

export interface MaintenanceData {
  documents: any[];
  lineItems: any[];
  completedServiceItems: any[];
  maintenanceLineItems: any[];
}

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
