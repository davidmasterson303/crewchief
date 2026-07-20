'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

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

export function useVehicles() {
  return useQuery({
    queryKey: ['vehicles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vehicles')
        .select(`
          id,year,make,model,trim,color,current_mileage,image_url,custom_image_url,
          performance_goal,ownership_objective,created_at,
          vehicle_status,avg_miles_per_month,focal_point_x,focal_point_y,
          nhtsa_data(recalls),
          vehicle_health_summary(health_score,summary,red_flags)
        `)
        .eq('is_demo', true)
        .order('created_at', { ascending: true });

      if (error) throw new Error(error.message);
      return (data || []) as unknown as GarageVehicle[];
    },
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 60,
  });
}
