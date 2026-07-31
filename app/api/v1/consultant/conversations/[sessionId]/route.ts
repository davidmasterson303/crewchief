import { logger } from '@crewchief/core/logger';
import { type NextRequest } from 'next/server';
import type { ApiResponse } from '@crewchief/core/types';
import { checkRateLimit, getClientIdentifier, rateLimitResponse } from '@/lib/rate-limit';
import { authorizeVehicleScopedRow } from '@/lib/api-auth';
import { getConsultantSession } from '@/app/actions';

export const dynamic = 'force-dynamic';

/**
 * One thread, with what was said in it.
 *
 * Authorized from the row rather than from a vehicle in the URL:
 * `authorizeVehicleScopedRow` resolves the conversation's parent vehicle and
 * authorizes *that*. A caller cannot name the vehicle themselves, so a valid
 * session id belonging to someone else's car is refused rather than trusted.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { sessionId: string } }
): Promise<Response> {
  const identifier = getClientIdentifier(request);
  const rateLimit = await checkRateLimit(identifier, 'default');
  if (!rateLimit.allowed) {
    return rateLimitResponse(rateLimit);
  }

  try {
    const access = await authorizeVehicleScopedRow('consultant_conversations', params.sessionId, {
      intent: 'read',
    });
    if (!access.ok) {
      return access.response;
    }

    const result = await getConsultantSession(params.sessionId);

    if (!result.success || !result.data) {
      return Response.json(
        { success: false, error: 'Conversation not found' } as ApiResponse,
        { status: 404 }
      );
    }

    /*
      Shaped for the wire rather than passed through. The action selects `*`,
      which includes `context_snapshot` — a stored copy of the vehicle context
      as it stood when the thread was written. That is large, it is stale by
      construction, and after task 3.0.1 it is not even what the advisor reads
      any more. Shipping it would put a second, wrong source of vehicle facts
      in front of a client, which is the whole failure this phase has been
      unpicking.
    */
    const { id, title, created_at, updated_at, message_history } = result.data;

    logger.info('API:CONSULTANT_CONVERSATION', 'Conversation loaded', {
      sessionId: params.sessionId,
    });

    return Response.json({
      success: true,
      conversation: {
        id,
        title,
        created_at,
        updated_at,
        messages: Array.isArray(message_history) ? message_history : [],
      },
    } as ApiResponse);
  } catch (error) {
    logger.error('API:CONSULTANT_CONVERSATION', error as Error);
    return Response.json(
      { success: false, error: 'Failed to load conversation' } as ApiResponse,
      { status: 500 }
    );
  }
}
