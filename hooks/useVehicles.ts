'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/AuthProvider';

export interface GarageVehicle {
  id: string;
  year: number;
  make: string;
  model: string;
  trim: string | null;
  color: string | null;
  current_mileage: number | null;
  image_url: string | null;
  custom_image_url: string | null;
  performance_goal: string | null;
  ownership_objective: string | null;
  created_at: string;
  vehicle_status: string | null;
  avg_miles_per_month: number | null;
  focal_point_x: number | null;
  focal_point_y: number | null;
  nhtsa_data: { recalls: unknown[] }[] | null;
  vehicle_health_summary: { health_score: number; summary: string; red_flags: unknown }[] | null;
}

const GARAGE_COLUMNS = `
  id,year,make,model,trim,color,current_mileage,image_url,custom_image_url,
  performance_goal,ownership_objective,created_at,
  vehicle_status,avg_miles_per_month,focal_point_x,focal_point_y,
  nhtsa_data(recalls),
  vehicle_health_summary(health_score,summary,red_flags)
`;

/**
 * The three seeded demo vehicles.
 *
 * For the public surfaces — the landing page and `/demo` — where the whole
 * point is showing a populated garage to someone with no account.
 *
 * This used to be called `useVehicles` and was *also* what `/garage` rendered,
 * which meant the authenticated garage showed the demo cars and a signed-in
 * user could never see their own. It went unnoticed because no real account
 * has ever added a vehicle: the project has one auth user and three vehicles,
 * all demo. Renamed so the next caller has to say which set it wants.
 */
export function useDemoVehicles() {
  return useQuery({
    queryKey: ['vehicles', 'demo'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vehicles')
        .select(GARAGE_COLUMNS)
        .eq('is_demo', true)
        .order('created_at', { ascending: true });

      if (error) throw new Error(error.message);
      return (data || []) as unknown as GarageVehicle[];
    },
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 60,
  });
}

/**
 * The signed-in user's own vehicles.
 *
 * Filters on `user_id` explicitly rather than trusting RLS to scope the
 * result. That is not belt-and-braces: the `vehicles` table's own policies are
 * unrestricted — see
 * `supabase/migrations/20260727150000_scope_vehicles_rls_to_owner.sql` — so an
 * unfiltered select here would currently return every row in the table. The
 * explicit filter is correct whether or not that migration has been applied,
 * and stays correct after it is.
 *
 * `is_demo` is excluded so the demo cars do not appear alongside the user's
 * own. They are reachable from `/demo`, which is where they belong.
 */
export function useMyVehicles() {
  const { user, loading } = useAuth();

  return useQuery({
    // Keyed by user id: two accounts in one tab must not share a cache entry.
    // Sign-out clears the cache anyway (lib/sign-out.ts), but a key that
    // cannot collide is the stronger guarantee.
    queryKey: ['vehicles', 'mine', user?.id ?? null],
    // Nothing to ask for until the session resolves. Without this the query
    // fires with no user on first paint and caches an empty garage.
    enabled: !loading && !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vehicles')
        .select(GARAGE_COLUMNS)
        .eq('user_id', user!.id)
        .eq('is_demo', false)
        .order('created_at', { ascending: true });

      if (error) throw new Error(error.message);
      return (data || []) as unknown as GarageVehicle[];
    },
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 60,
  });
}
