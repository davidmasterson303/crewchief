import { logger } from '@crewchief/core/logger';
import { type NextRequest } from 'next/server';
import type { ApiResponse } from '@crewchief/core/types';
import { checkRateLimit, getClientIdentifier, rateLimitResponse } from '@/lib/rate-limit';
import { authorizeVehicleAccess } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

/**
 * Documents, invoice lines, completed service items and maintenance lines.
 *
 * Authorization goes through `authorizeVehicleAccess`, which replaces a
 * hand-rolled copy of the ownership check identical to the one that was in
 * `load-vehicle` — two more implementations of the rule `lib/api-auth.ts` owns.
 *
 * **A demo vehicle will fail here, and that is the honest answer rather than a
 * bug.** Measured against the live project on 27 Jul: the `anon` role is
 * granted SELECT on `vehicles` and `vehicle_knowledge_base`, and is refused —
 * "permission denied for table" — on all four tables this route reads. So an
 * anonymous caller genuinely cannot see this data.
 *
 * The tempting fix is to use the service-role client for demo vehicles the way
 * this route used to. Do not. `authorizeVehicleAccess` returns the anon client
 * for demo reads deliberately, so that RLS scopes them; reaching past it for
 * shared public data is how a demo-shaped hole gets opened in a boundary that
 * currently holds. If the demo should expose maintenance history, that is a
 * deliberate grant on those four tables, not a client swap here.
 *
 * Nothing displays this today — see the note on the hooks below.
 */

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

    const access = await authorizeVehicleAccess(vehicleId, { intent: 'read' });
    if (!access.ok) {
      return access.response;
    }

    const supabase = access.client;

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
