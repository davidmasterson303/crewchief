'use server';

import { getServiceRoleClient } from '@/lib/supabase';
import { logger } from '@crewchief/core/logger';

export async function fetchVehicleById(vehicleId: string) {
  try {
    const client = getServiceRoleClient();

    const { data, error } = await client
      .from('vehicles')
      .select(`
        *,
        nhtsa_data(*),
        vehicle_health_summary(*),
        vehicle_knowledge_base(*)
      `)
      .eq('id', vehicleId)
      .maybeSingle();

    if (error) {
      logger.error('VEHICLES:FETCH_BY_ID', error as Error, { vehicleId });
      return { success: false, error: error.message };
    }

    if (!data) {
      return { success: false, error: 'Vehicle not found' };
    }

    return { success: true, vehicle: data };
  } catch (error: unknown) {
    logger.error('VEHICLES:FETCH_BY_ID_EXCEPTION', error as Error, { vehicleId });
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function fetchDashboardData(vehicleId: string) {
  try {
    const client = getServiceRoleClient();

    const [vehicleResult, knowledgeResult, serviceItemsResult, nhtsaResult, bundlesResult, healthSummaryResult] = await Promise.all([
      client.from('vehicles').select('*').eq('id', vehicleId).maybeSingle(),
      client.from('vehicle_knowledge_base').select('*').eq('vehicle_id', vehicleId).maybeSingle(),
      client.from('service_items').select('*').eq('vehicle_id', vehicleId).order('created_at', { ascending: false }),
      client.from('nhtsa_data').select('*').eq('vehicle_id', vehicleId).maybeSingle(),
      client.from('labor_bundles').select('*').eq('vehicle_id', vehicleId).eq('status', 'suggested').order('suggested_at', { ascending: false }),
      client.from('vehicle_health_summary').select('*').eq('vehicle_id', vehicleId).maybeSingle(),
    ]);

    if (vehicleResult.error) {
      logger.error('VEHICLES:DASHBOARD_VEHICLE', vehicleResult.error as Error, { vehicleId });
      return { success: false, error: vehicleResult.error.message };
    }

    if (!vehicleResult.data) {
      return { success: false, error: 'Vehicle not found' };
    }

    if (knowledgeResult.error) logger.warn('VEHICLES:DASHBOARD_KNOWLEDGE', 'Knowledge base error (non-critical)', { error: knowledgeResult.error });
    if (serviceItemsResult.error) logger.warn('VEHICLES:DASHBOARD_SERVICE', 'Service items error (non-critical)', { error: serviceItemsResult.error });
    if (nhtsaResult.error) logger.warn('VEHICLES:DASHBOARD_NHTSA', 'NHTSA data error (non-critical)', { error: nhtsaResult.error });
    if (bundlesResult.error) logger.warn('VEHICLES:DASHBOARD_BUNDLES', 'Bundles error (non-critical)', { error: bundlesResult.error });
    if (healthSummaryResult.error) logger.warn('VEHICLES:DASHBOARD_HEALTH', 'Health summary error (non-critical)', { error: healthSummaryResult.error });

    return {
      success: true,
      vehicle: vehicleResult.data,
      knowledge: knowledgeResult.data,
      serviceItems: serviceItemsResult.data || [],
      nhtsa: nhtsaResult.data,
      bundles: bundlesResult.data || [],
      healthSummary: healthSummaryResult.data,
    };
  } catch (error: unknown) {
    logger.error('VEHICLES:DASHBOARD_EXCEPTION', error as Error, { vehicleId });
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function fetchConsultantPageData(vehicleId: string) {
  try {
    const client = getServiceRoleClient();

    const [
      vehicleResult,
      knowledgeResult,
      sessionsResult,
      wishlistResult,
      allServiceResult,
      maintenanceLineItemsResult,
      documentsResult,
      issueTrackingResult,
    ] = await Promise.all([
      client.from('vehicles').select('*').eq('id', vehicleId).maybeSingle(),
      client.from('vehicle_knowledge_base').select('*').eq('vehicle_id', vehicleId).maybeSingle(),
      client.from('consultant_conversations').select('id, title, created_at, updated_at').eq('vehicle_id', vehicleId).order('updated_at', { ascending: false }),
      client.from('service_items').select('*').eq('vehicle_id', vehicleId).eq('status', 'wishlist'),
      client.from('service_items').select('*').eq('vehicle_id', vehicleId).order('date_completed', { ascending: false }),
      client.from('maintenance_line_items').select('*').eq('vehicle_id', vehicleId).order('created_at', { ascending: false }),
      client.from('vehicle_documents').select('*').eq('vehicle_id', vehicleId).order('created_at', { ascending: false }),
      client.from('known_issue_tracking').select('*').eq('vehicle_id', vehicleId),
    ]);

    if (vehicleResult.error) {
      logger.error('VEHICLES:CONSULTANT_VEHICLE', vehicleResult.error as Error, { vehicleId });
      return { success: false, error: vehicleResult.error.message };
    }

    if (!vehicleResult.data) {
      return { success: false, error: 'Vehicle not found' };
    }

    if (knowledgeResult.error) logger.warn('VEHICLES:CONSULTANT_KNOWLEDGE', 'Knowledge error (non-critical)', { error: knowledgeResult.error });
    if (sessionsResult.error) logger.warn('VEHICLES:CONSULTANT_SESSIONS', 'Sessions error (non-critical)', { error: sessionsResult.error });
    if (wishlistResult.error) logger.warn('VEHICLES:CONSULTANT_WISHLIST', 'Wishlist error (non-critical)', { error: wishlistResult.error });
    if (allServiceResult.error) logger.warn('VEHICLES:CONSULTANT_SERVICE', 'Service items error (non-critical)', { error: allServiceResult.error });
    if (maintenanceLineItemsResult.error) logger.warn('VEHICLES:CONSULTANT_MAINTENANCE', 'Maintenance items error (non-critical)', { error: maintenanceLineItemsResult.error });
    if (documentsResult.error) logger.warn('VEHICLES:CONSULTANT_DOCUMENTS', 'Documents error (non-critical)', { error: documentsResult.error });
    if (issueTrackingResult.error) logger.warn('VEHICLES:CONSULTANT_ISSUES', 'Issue tracking error (non-critical)', { error: issueTrackingResult.error });

    const allServiceItems = allServiceResult.data || [];
    const completedItems = allServiceItems.filter((item: { status: string }) => item.status === 'completed');

    return {
      success: true,
      vehicle: vehicleResult.data,
      knowledge: knowledgeResult.data,
      sessions: sessionsResult.data || [],
      wishlistItems: wishlistResult.data || [],
      allServiceItems,
      completedItems,
      maintenanceLineItems: maintenanceLineItemsResult.data || [],
      documents: documentsResult.data || [],
      issueTracking: issueTrackingResult.data || [],
    };
  } catch (error: unknown) {
    logger.error('VEHICLES:CONSULTANT_EXCEPTION', error as Error, { vehicleId });
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function fetchAllVehicles() {
  try {
    const client = getServiceRoleClient();

    const { data, error } = await client
      .from('vehicles')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('VEHICLES:FETCH_ALL', error as Error);
      return { success: false, data: [], error: error.message };
    }

    return { success: true, data: data || [] };
  } catch (error: unknown) {
    logger.error('VEHICLES:FETCH_ALL_EXCEPTION', error as Error);
    return { success: false, data: [], error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function updateVehicleMileage(vehicleId: string, newMileage: number) {
  try {
    const client = getServiceRoleClient();

    const { error } = await client
      .from('vehicles')
      .update({ current_mileage: newMileage, updated_at: new Date().toISOString() })
      .eq('id', vehicleId);

    if (error) {
      logger.error('VEHICLES:UPDATE_MILEAGE', error as Error, { vehicleId });
      return { success: false, error: `Failed to update mileage: ${error.message}` };
    }

    return { success: true };
  } catch (error: unknown) {
    logger.error('VEHICLES:UPDATE_MILEAGE_EXCEPTION', error as Error, { vehicleId });
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function updateVehicleAvgMileage(vehicleId: string, avgMilesPerMonth: number) {
  try {
    const client = getServiceRoleClient();

    const { error } = await client
      .from('vehicles')
      .update({ avg_miles_per_month: avgMilesPerMonth, updated_at: new Date().toISOString() })
      .eq('id', vehicleId);

    if (error) {
      logger.error('VEHICLES:UPDATE_AVG_MILEAGE', error as Error, { vehicleId });
      return { success: false, error: `Failed to update average mileage: ${error.message}` };
    }

    return { success: true };
  } catch (error: unknown) {
    logger.error('VEHICLES:UPDATE_AVG_MILEAGE_EXCEPTION', error as Error, { vehicleId });
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function updatePerformanceGoal(vehicleId: string, performanceGoal: 'mild' | 'moderate' | 'aggressive') {
  try {
    const client = getServiceRoleClient();
    const { error } = await client
      .from('vehicles')
      .update({ performance_goal: performanceGoal, updated_at: new Date().toISOString() })
      .eq('id', vehicleId);

    if (error) {
      logger.error('VEHICLES:UPDATE_PERF_GOAL', error as Error, { vehicleId });
      return { success: false, error: 'Failed to update performance goal' };
    }

    return { success: true };
  } catch (error: unknown) {
    logger.error('VEHICLES:UPDATE_PERF_GOAL_EXCEPTION', error as Error, { vehicleId });
    return { success: false, error: 'Failed to update performance goal' };
  }
}
