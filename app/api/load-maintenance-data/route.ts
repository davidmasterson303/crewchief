import { getServiceRoleClient, createServerActionClient } from '@/lib/supabase';
import { isDemoVehicleId } from '@/lib/demo';
import { logger } from '@/lib/logger';
import { vehicleIdSchema } from '@/lib/validation';
import { type NextRequest } from 'next/server';
import type { ApiResponse } from '@/lib/types';
import { checkRateLimit, getClientIdentifier, rateLimitResponse } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<Response> {
  logger.info('API:LOAD_MAINTENANCE', 'Loading maintenance data');

  const identifier = getClientIdentifier(request);
  const rateLimit = await checkRateLimit(identifier, 'default');
  if (!rateLimit.allowed) {
    logger.warn('API:LOAD_MAINTENANCE', 'Rate limit exceeded', { identifier });
    return rateLimitResponse(rateLimit);
  }

  try {
    const vehicleId = request.nextUrl.searchParams.get('vehicleId');

    if (!vehicleId) {
      logger.warn('API:LOAD_MAINTENANCE', 'Missing vehicleId parameter');
      return Response.json({ success: false, error: 'Missing vehicleId' } as ApiResponse, { status: 400 });
    }

    const validationResult = vehicleIdSchema.safeParse(vehicleId);
    if (!validationResult.success) {
      logger.warn('API:LOAD_MAINTENANCE', 'Invalid vehicleId format');
      return Response.json({ success: false, error: 'Invalid vehicleId format' } as ApiResponse, { status: 400 });
    }

    const isDemo = isDemoVehicleId(vehicleId);

    if (!isDemo) {
      const authClient = createServerActionClient();
      const { data: { user }, error: authError } = await authClient.auth.getUser();
      if (authError || !user) {
        return Response.json({ success: false, error: 'Unauthorized' } as ApiResponse, { status: 401 });
      }

      const { data: ownership } = await authClient
        .from('vehicles')
        .select('id')
        .eq('id', vehicleId)
        .eq('user_id', user.id)
        .maybeSingle();

      if (!ownership) {
        return Response.json({ success: false, error: 'Vehicle not found' } as ApiResponse, { status: 404 });
      }
    }

    const supabase = getServiceRoleClient();

    logger.debug('API:LOAD_MAINTENANCE', 'Fetching all maintenance data in parallel');
    const [docsResult, lineItemsResult, serviceItemsResult, maintenanceItemsResult] = await Promise.all([
      supabase
        .from('vehicle_documents')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .order('upload_date', { ascending: false }),
      supabase
        .from('invoice_line_items')
        .select('*')
        .eq('vehicle_id', vehicleId),
      supabase
        .from('service_items')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .eq('status', 'completed')
        .order('date_completed', { ascending: false }),
      supabase
        .from('maintenance_line_items')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .order('service_date', { ascending: false })
    ]);

    if (docsResult.error) logger.warn('API:LOAD_MAINTENANCE', 'Docs query error', { error: docsResult.error.message });
    if (lineItemsResult.error) logger.warn('API:LOAD_MAINTENANCE', 'Line items query error', { error: lineItemsResult.error.message });
    if (serviceItemsResult.error) logger.warn('API:LOAD_MAINTENANCE', 'Service items query error', { error: serviceItemsResult.error.message });
    if (maintenanceItemsResult.error) logger.warn('API:LOAD_MAINTENANCE', 'Maintenance items query error', { error: maintenanceItemsResult.error.message });

    logger.info('API:LOAD_MAINTENANCE', 'Maintenance data loaded successfully', {
      docsCount: docsResult.data?.length || 0,
      lineItemsCount: lineItemsResult.data?.length || 0,
      serviceItemsCount: serviceItemsResult.data?.length || 0,
      maintenanceItemsCount: maintenanceItemsResult.data?.length || 0,
    });

    return Response.json({
      success: true,
      documents: docsResult.data || [],
      lineItems: lineItemsResult.data || [],
      completedServiceItems: serviceItemsResult.data || [],
      maintenanceLineItems: maintenanceItemsResult.data || [],
    } as ApiResponse);
  } catch (error) {
    logger.error('API:LOAD_MAINTENANCE', error as Error);
    return Response.json(
      { success: false, error: 'Failed to load maintenance data' } as ApiResponse,
      { status: 500 }
    );
  }
}
