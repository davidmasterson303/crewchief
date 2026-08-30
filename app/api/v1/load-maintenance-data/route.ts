import { logger } from '@wellkept/core/logger';
import { type NextRequest } from 'next/server';
import type { ApiResponse } from '@wellkept/core/types';
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
 * ── What a demo caller gets, and why it is not everything ───────────────────
 *
 * This used to 500 for demo vehicles, on the reasoning that `anon` was refused
 * on all four tables so the failure was the honest answer. That was measured on
 * 27 Jul and **two of the four have changed since**: `20260731030000` and
 * `20260731040000` granted `anon` scoped SELECT on `maintenance_line_items` and
 * `service_items`. A demo caller can now legitimately read half of this.
 *
 * The other half stays shut, deliberately and permanently:
 *
 *   - `vehicle_documents` — scoped to owners with no demo arm by
 *     `20260801140000`. That was a decision, not an omission: the demo's five
 *     rows are `demo-placeholder.local` paths pointing at no file, and every
 *     other row is a real invoice. Granting anon here would undo it.
 *   - `invoice_line_items` — never in scope for the demo.
 *
 * So the route asks a demo caller's client only for what that caller may read,
 * and reports the rest as **omitted rather than empty**. That distinction is the
 * same one the failure handling below exists to make: `documents: []` would tell
 * a maintenance screen "this car has no invoices", which is false — the honest
 * statement is "you may not see them".
 *
 * Roadmap Rev. D asked for this decision before Phase 3.3, framed as "either the
 * route narrows to what the demo may legitimately show, or two more grants get
 * written". Narrowing, for the reason above: one of the two grants was just
 * deliberately refused.
 *
 * The tempting alternative is the service-role client for demo vehicles, the
 * way this route used to work. Still do not. `authorizeVehicleAccess` returns
 * the anon client for demo reads so that RLS scopes them; reaching past it is
 * how a demo-shaped hole opens in a boundary that currently holds.
 *
 * Nothing displays this today — Phase 3.3's maintenance screen is the caller
 * this is being made ready for.
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

    /*
      The two datasets a demo caller may not read. Named here rather than
      inferred from which queries happened to fail, because "we did not ask" and
      "we asked and were refused" must not be the same branch — the second is
      still a real failure and must still 500.
    */
    const OWNER_ONLY = ['documents', 'lineItems'] as const;
    const omitted: string[] = access.isDemo ? [...OWNER_ONLY] : [];

    logger.debug('API:LOAD_MAINTENANCE', 'Fetching maintenance data in parallel', {
      isDemo: access.isDemo,
      omitted,
    });

    /*
      `null` for a query not issued, distinct from a result that came back
      empty. Skipping them also saves a demo caller two round trips that could
      only ever have been refused.
    */
    const [docsResult, lineItemsResult, serviceItemsResult, maintenanceItemsResult] = await Promise.all([
      access.isDemo
        ? Promise.resolve(null)
        : supabase
            .from('vehicle_documents')
            .select('*')
            .eq('vehicle_id', vehicleId)
            .order('upload_date', { ascending: false }),
      access.isDemo
        ? Promise.resolve(null)
        : supabase
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
    /*
      A skipped query has no error and contributes nothing here. Only queries
      that were actually issued can fail, which keeps the loud-failure property
      exactly as strong for real callers as it was before demo narrowing.
    */
    const failures = [
      ['documents', docsResult?.error],
      ['invoice line items', lineItemsResult?.error],
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
      docsCount: docsResult?.data?.length ?? null,
      lineItemsCount: lineItemsResult?.data?.length ?? null,
      serviceItemsCount: serviceItemsResult.data?.length || 0,
      maintenanceItemsCount: maintenanceItemsResult.data?.length || 0,
      omitted,
    });

    /*
      `omitted` names what this caller was not shown, so a client can say "not
      available on the demo" instead of "no invoices on file". Sending `[]` for
      a dataset the caller may not read is the same lie as the `|| []` flatten
      above, one layer up.

      The two keys are still present and still arrays, so a client that ignores
      `omitted` renders an empty section rather than crashing. Wrong, but wrong
      in the direction that fails visibly.
    */
    return Response.json({
      success: true,
      documents: docsResult?.data || [],
      lineItems: lineItemsResult?.data || [],
      completedServiceItems: serviceItemsResult.data || [],
      maintenanceLineItems: maintenanceItemsResult.data || [],
      omitted,
    } as ApiResponse);
  } catch (error) {
    logger.error('API:LOAD_MAINTENANCE', error as Error);
    return Response.json(
      { success: false, error: 'Failed to load maintenance data' } as ApiResponse,
      { status: 500 }
    );
  }
}
