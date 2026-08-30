import { logger } from '@wellkept/core/logger';
import { type NextRequest } from 'next/server';
import type { ApiResponse } from '@wellkept/core/types';
import { checkRateLimit, getClientIdentifier, rateLimitResponse } from '@/lib/rate-limit';
import { authorizeVehicleAccess } from '@/lib/api-auth';
import { getConsultantSessions } from '@/app/actions';

export const dynamic = 'force-dynamic';

/**
 * The advisor's threads for one vehicle.
 *
 * A phone resumes conversations; it does not only start them. Without this the
 * mobile advisor would be a series of one-shot questions with no history,
 * which is a different and much weaker product than the web one.
 *
 * Authorization is here for the status code and in the action because the
 * action is independently reachable — the reasoning is written out in the
 * sibling `../route.ts`.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const identifier = getClientIdentifier(request);
  const rateLimit = await checkRateLimit(identifier, 'default');
  if (!rateLimit.allowed) {
    return rateLimitResponse(rateLimit);
  }

  try {
    const vehicleId = request.nextUrl.searchParams.get('vehicleId');

    // Validates the id shape, resolves demo vs owned, and denies with the
    // right status — including the 404 that keeps ids unprobeable.
    const access = await authorizeVehicleAccess(vehicleId, { intent: 'read' });
    if (!access.ok) {
      return access.response;
    }

    const result = await getConsultantSessions(vehicleId as string);

    if (!result.success) {
      logger.error('API:CONSULTANT_CONVERSATIONS', new Error('Failed to list conversations'), {
        vehicleId,
      });
      return Response.json(
        { success: false, error: 'Failed to load conversations', conversations: [] } as ApiResponse,
        { status: 500 }
      );
    }

    logger.info('API:CONSULTANT_CONVERSATIONS', 'Conversations listed', {
      vehicleId,
      count: result.data.length,
    });

    /*
      `conversations`, not the action's `data`. The action's name for its own
      return value is not a wire contract, and a field called `data` tells a
      client nothing about what is in it.
    */
    return Response.json({ success: true, conversations: result.data } as ApiResponse);
  } catch (error) {
    logger.error('API:CONSULTANT_CONVERSATIONS', error as Error);
    return Response.json(
      { success: false, error: 'Failed to load conversations', conversations: [] } as ApiResponse,
      { status: 500 }
    );
  }
}
