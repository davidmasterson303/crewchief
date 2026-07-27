import { useQuery } from '@tanstack/react-query';

/**
 * Vehicle + knowledge base, through the API rather than straight to Supabase.
 *
 * **Currently unreferenced**, and deliberately kept. The pages that show this
 * data — `app/dashboard/[vehicleId]`, `app/vehicle-info/[vehicleId]`,
 * `app/consultant/[vehicleId]` — query Supabase directly with the browser
 * client, so they are protected by RLS alone. Going through the API instead
 * puts `lib/api-auth.ts` in the path, which is the stronger posture and the
 * one Phase 2 is building toward: a native client has to use these endpoints.
 *
 * Two things block that migration, and neither is this hook:
 *
 *  1. The route returns vehicle + knowledge base. The dashboard also needs
 *     `nhtsa_data`, `vehicle_health_summary` and `recall_actions`, so the swap
 *     is a route change, not a call-site change.
 *  2. The deployed service-role key is rejected. That no longer affects the
 *     demo path — `authorizeVehicleAccess` uses the anon client there — but it
 *     does affect every signed-in read.
 *
 * Delete this only alongside the route, and only if the decision is that
 * direct Supabase access is the intended pattern for the web client.
 */
export function useVehicle(vehicleId: string | null | undefined) {
  return useQuery({
    queryKey: ['vehicle', vehicleId],
    queryFn: async () => {
      if (!vehicleId) throw new Error('Vehicle ID is required');

      const response = await fetch(`/api/v1/load-vehicle?vehicleId=${vehicleId}`);
      if (!response.ok) {
        throw new Error('Failed to load vehicle');
      }
      return response.json();
    },
    enabled: !!vehicleId,
    staleTime: 1000 * 60 * 5,
  });
}
