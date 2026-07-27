import { createServerActionClient } from '@/lib/supabase';
import { logger } from '@crewchief/core/logger';
import type { ApiResponse } from '@crewchief/core/types';

export async function GET(): Promise<Response> {
  logger.info('API:GET_VEHICLES', 'Fetching vehicles for authenticated user');

  try {
    const supabase = createServerActionClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return Response.json(
        { success: false, error: 'Unauthorized', vehicles: [] } as ApiResponse,
        { status: 401 }
      );
    }

    const { data, error } = await supabase
      .from('vehicles')
      .select(`
        *,
        nhtsa_data(*),
        vehicle_health_summary(*)
      `)
      .eq('user_id', user.id)
      .eq('is_demo', false)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('API:GET_VEHICLES', new Error(error.message));
      return Response.json(
        { success: false, error: error.message, vehicles: [] } as ApiResponse,
        { status: 500 }
      );
    }

    logger.info('API:GET_VEHICLES', 'Vehicles fetched successfully', {
      count: data?.length || 0,
    });

    return Response.json({
      success: true,
      vehicles: data || [],
    } as ApiResponse);
  } catch (error) {
    logger.error('API:GET_VEHICLES', error as Error);
    return Response.json(
      { success: false, error: 'Failed to load vehicles', vehicles: [] } as ApiResponse,
      { status: 500 }
    );
  }
}
