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

    /*
      A failed query must not be reported as an empty one.

      Each of these errors used to be logged as a warning and then flattened
      by `|| []` into an empty array under `success: true`. So a total
      credential failure produced a 200 reading "no documents, no line items,
      no service history" — indistinguishable from a vehicle that genuinely has
      none, and accompanied by a log line saying "loaded successfully".

      That is not hypothetical. On both deployed Netlify projects this route
      currently returns exactly that, because their service-role key is
      rejected with "Invalid API key" — see the sibling route
      /api/v1/load-vehicle, which calls the same client and surfaces the real
      error because it checks. Silence here is why nobody noticed.

      Partial failure is treated the same as total: a caller shown three of
      four datasets, told it succeeded, will render "no maintenance records"
      and be wrong.
    */
    const failures = [
      ['documents', docsResult.error],
      ['invoice line items', lineItemsResult.error],
      ['completed service items', serviceItemsResult.error],
      ['maintenance line items', maintenanceItemsResult.error],
    ].filter(([, error]) => error) as Array<[string, { message: string }]>;

    if (failures.length > 0) {
      for (const [label, error] of failures) {
        logger.error('API:LOAD_MAINTENANCE', new Error(`${label}: ${error.message}`), { vehicleId });
      }
      return Response.json(
        { success: false, error: 'Failed to load maintenance data' } as ApiResponse,
        { status: 500 }
      );
    }

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
