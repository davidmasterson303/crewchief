import { useQuery } from '@tanstack/react-query';

export function useVehicle(vehicleId: string | null | undefined) {
  return useQuery({
    queryKey: ['vehicle', vehicleId],
    queryFn: async () => {
      if (!vehicleId) throw new Error('Vehicle ID is required');

      const response = await fetch(`/api/load-vehicle?vehicleId=${vehicleId}`);
      if (!response.ok) {
        throw new Error('Failed to load vehicle');
      }
      return response.json();
    },
    enabled: !!vehicleId,
    staleTime: 1000 * 60 * 5,
  });
}
