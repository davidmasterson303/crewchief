import { getServiceRoleClient, createServerActionClient } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { vehicleIdSchema } from '@/lib/validation';
import { type NextRequest } from 'next/server';
import type { ApiResponse } from '@/lib/types';
import { checkRateLimit, getClientIdentifier, rateLimitResponse } from '@/lib/rate-limit';
import { isDemoVehicleId } from '@/lib/demo';

export const dynamic = 'force-dynamic';

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

    const validationResult = vehicleIdSchema.safeParse(vehicleId);
    if (!validationResult.success) {
      logger.warn('API:LOAD_VEHICLE', 'Invalid vehicleId format');
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
