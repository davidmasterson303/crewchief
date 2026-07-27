import { logger } from '@crewchief/core/logger';
import { type NextRequest } from 'next/server';
import type { ApiResponse } from '@crewchief/core/types';
import { checkRateLimit, getClientIdentifier, rateLimitResponse } from '@/lib/rate-limit';
import { authorizeVehicleAccess } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

/**
 * Vehicle and knowledge-base read.
 *
 * Authorization goes through `authorizeVehicleAccess` like everything else.
 * It used to hand-roll its own: session lookup, then a `vehicles` ownership
 * query, then `getServiceRoleClient()` — a second implementation of the rule
 * `lib/api-auth.ts` exists to own, and the bug this codebase keeps repeating.
 *
 * It also reached for the service role **unconditionally, including for demo
 * vehicles**, which is why this route returned 500 "Invalid API key" on both
 * deployments while sibling routes served the demo fine: the deployed
 * service-role key is rejected, and this route needed it even for public data.
 * `authorizeVehicleAccess` hands back the anon client for a demo read, so that
 * path no longer depends on the elevated credential at all.
 */

export async function GET(request: NextRequest): Promise<Response> {
  logger.info('API:LOAD_VEHICLE', 'Loading vehicle');

  const identifier = getClientIdentifier(request);
  const rateLimit = await checkRateLimit(identifier, 'default');
  if (!rateLimit.allowed) {
    logger.warn('API:LOAD_VEHICLE', 'Rate limit exceeded', { identifier });
    return rateLimitResponse(rateLimit);
  }

  try {
    const vehicleId = request.nextUrl.searchParams.get('vehicleId');

    if (!vehicleId) {
      logger.warn('API:LOAD_VEHICLE', 'Missing vehicleId parameter');
      return Response.json({ success: false, error: 'Missing vehicleId' } as ApiResponse, { status: 400 });
    }

    // Validates the id, resolves demo vs owned, and returns the right client:
    // anon for a demo read, service-role only once ownership is proven.
    const access = await authorizeVehicleAccess(vehicleId, { intent: 'read' });
    if (!access.ok) {
      return access.response;
    }

    const supabase = access.client;

    const [vehicleResult, knowledgeResult] = await Promise.all([
      supabase.from('vehicles').select('*').eq('id', vehicleId).maybeSingle(),
      supabase.from('vehicle_knowledge_base').select('*').eq('vehicle_id', vehicleId).maybeSingle(),
    ]);

    const { data: vehicleData, error: vehicleError } = vehicleResult;

    if (vehicleError) {
      return Response.json({ success: false, error: vehicleError.message } as ApiResponse, { status: 500 });
    }

    if (!vehicleData) {
      return Response.json({ success: false, error: 'Vehicle not found' } as ApiResponse, { status: 404 });
    }

    const knowledgeData = knowledgeResult.data;

    logger.info('API:LOAD_VEHICLE', 'Vehicle loaded successfully', { vehicleId });

    return Response.json({
      success: true,
      vehicle: vehicleData,
      knowledge: knowledgeData,
    } as ApiResponse);
  } catch (error) {
    logger.error('API:LOAD_VEHICLE', error as Error);
    return Response.json(
      { success: false, error: 'Failed to load vehicle' } as ApiResponse,
      { status: 500 }
    );
  }
}
