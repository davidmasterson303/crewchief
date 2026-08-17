import { logger } from '@crewchief/core/logger';
import { type NextRequest } from 'next/server';
import type { ApiResponse } from '@crewchief/core/types';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { authorizeVehicleAccess } from '@/lib/api-auth';
import { isDemoVehicleId } from '@crewchief/core/demo';
import {
  sendConsultantMessage,
  createConsultantSession,
  getConsultantSession,
  generateSessionTitle,
} from '@/app/actions';

export const dynamic = 'force-dynamic';

/**
 * Ask the advisor — the flow carrying the 4.2 Minimum Functionality argument.
 *
 * ── Why this route can be thin ──────────────────────────────────────────────
 *
 * Because `sendConsultantMessage` stopped taking the vehicle's entire history
 * as parameters. Until `a0e9894` it did, which made it unusable as a public
 * API twice over: a phone cannot upload a car's whole record on every message,
 * and the prompt was assembled from whatever the caller posted. The context is
 * now derived from `vehicleId` server-side, so what is left for a caller to
 * supply is a vehicle, a thread, and a question.
 *
 * This route therefore **delegates rather than reimplementing**. Prompt
 * assembly, wishlist command parsing, performance updates and persistence all
 * live in the action and stay there. A second copy of any of that would be the
 * bug this codebase keeps finding — two implementations of one rule, drifting.
 *
 * ── Why authorization happens here as well as in the action ─────────────────
 *
 * Not redundancy. The action authorizes because it is independently reachable:
 * Next.js compiles server actions into public POST endpoints, so it must
 * defend itself and always must. This route authorizes because it needs the
 * *status code* — a denial has to come back as 401 or 404, and the action
 * returns `{ success: false, error }` with no status, as it should. Deriving
 * HTTP semantics by matching on error strings would be the fragile version of
 * this.
 *
 * One extra ownership query on a request that is about to spend one to three
 * seconds in Gemini. It is not the cost worth optimising.
 */

interface ConsultantRequestBody {
  vehicleId?: unknown;
  message?: unknown;
  sessionId?: unknown;
  messageHistory?: unknown;
  attachedDocuments?: unknown;
}

/** Keeps a single message from becoming an unbounded prompt. */
const MAX_MESSAGE_LENGTH = 4000;

export async function POST(request: NextRequest): Promise<Response> {
  logger.info('API:CONSULTANT', 'Consultant message received');

  let body: ConsultantRequestBody;
  try {
    body = (await request.json()) as ConsultantRequestBody;
  } catch {
    return Response.json(
      { success: false, error: 'Invalid JSON body' } as ApiResponse,
      { status: 400 }
    );
  }

  const vehicleId = typeof body.vehicleId === 'string' ? body.vehicleId : '';
  const message = typeof body.message === 'string' ? body.message.trim() : '';

  if (!vehicleId) {
    return Response.json(
      { success: false, error: 'Missing vehicleId' } as ApiResponse,
      { status: 400 }
    );
  }

  if (!message) {
    return Response.json(
      { success: false, error: 'Missing message' } as ApiResponse,
      { status: 400 }
    );
  }

  if (message.length > MAX_MESSAGE_LENGTH) {
    return Response.json(
      { success: false, error: `Message must be under ${MAX_MESSAGE_LENGTH} characters` } as ApiResponse,
      { status: 400 }
    );
  }

  /*
    Keyed by vehicle rather than by client address, matching the action's own
    limiter so the two cannot be used to double an allowance by alternating
    between them. The 'ai' tier, because this call spends Gemini tokens — the
    unbounded-cost bug recorded against `performance-stats`, where demo
    vehicles reached a model call on every anonymous page view.
  */
  const rateLimit = await checkRateLimit(`consultant:${vehicleId}`, 'ai');
  if (!rateLimit.allowed) {
    logger.warn('API:CONSULTANT', 'Rate limit exceeded', { vehicleId });
    return rateLimitResponse(rateLimit);
  }

  try {
    /*
      Conditional intent, and it must stay that way. `authorizeVehicleAccess`
      denies demo vehicles any write, so an unconditional 'write' here would
      return 403 for every consultant message on the public demo — the exact
      regression that killed the demo's headline feature once already.
      `auth-posture.test.ts` guards the action against it; this is a second
      place that needs the same care, and it has its own assertion.
    */
    const isDemoVehicle = isDemoVehicleId(vehicleId);

    const access = await authorizeVehicleAccess(vehicleId, {
      intent: isDemoVehicle ? 'read' : 'write',
    });
    if (!access.ok) {
      return access.response;
    }

    const thread = await resolveThread({
      vehicleId,
      isDemoVehicle,
      sessionId: typeof body.sessionId === 'string' ? body.sessionId : null,
      message,
      clientHistory: Array.isArray(body.messageHistory) ? body.messageHistory : [],
    });

    if (!thread.ok) {
      return Response.json(
        { success: false, error: thread.error } as ApiResponse,
        { status: thread.status }
      );
    }

    const result = await sendConsultantMessage({
      vehicleId,
      sessionId: thread.sessionId,
      message,
      messageHistory: thread.messageHistory,
      attachedDocuments: Array.isArray(body.attachedDocuments) ? body.attachedDocuments : undefined,
    });

    if (!result.success) {
      logger.warn('API:CONSULTANT', 'Consultant declined to answer', {
        vehicleId,
        error: result.error,
      });
      return Response.json(
        { success: false, error: result.error } as ApiResponse,
        { status: 502 }
      );
    }

    logger.info('API:CONSULTANT', 'Consultant answered', { vehicleId });

    return Response.json({
      success: true,
      sessionId: thread.sessionId,
      response: result.response,
      /*
        What the answer was grounded in, computed server-side from the context
        actually loaded. The web client renders these as "Based on" chips; the
        mobile client will want the same, and neither can derive them itself
        now that the context never leaves the server.
      */
      contextKinds: result.contextKinds ?? [],
      wishlistActions: result.wishlistActions ?? [],
      /*
        The priced lines behind the estimate well, and **omitted rather than
        emptied** when the answer did not price anything.

        Not `?? []` like the two above, and the difference is the whole design.
        Those are lists that are legitimately empty — no chips, no suggestions.
        An estimate is a claim about what a job costs, and there is no such
        thing as an empty one: a well rendering no lines, or a total of $0, on
        the ordinary advice turn would be the product asserting a price it
        never inferred. Absent has to arrive as absent.
      */
      ...(result.estimate ? { estimate: result.estimate } : {}),
    } as ApiResponse);
  } catch (error) {
    logger.error('API:CONSULTANT', error as Error);
    return Response.json(
      { success: false, error: 'Failed to answer' } as ApiResponse,
      { status: 500 }
    );
  }
}

type ThreadResult =
  | { ok: true; sessionId: string; messageHistory: unknown[] }
  | { ok: false; error: string; status: number };

/**
 * Work out which thread this message belongs to, and what was said in it.
 *
 * **The history comes from the database, not the request.** A phone resuming a
 * conversation should not have to replay it, and a caller should not be able
 * to rewrite what it was told earlier — the same argument that moved the
 * vehicle context server-side. `consultant_conversations.message_history`
 * already holds it.
 *
 * Demo vehicles are the deliberate exception. Nothing is persisted for them —
 * every write in `sendConsultantMessage` is inside `if (!isDemoVehicle)` — so
 * there is no thread to read and the caller's own history is all there is. It
 * is their own conversation with a read-only car; the worst a caller can do by
 * editing it is mislead their own advisor.
 *
 * Omitting `sessionId` starts a thread. A phone should not need two round
 * trips to ask its first question.
 */
async function resolveThread({
  vehicleId,
  isDemoVehicle,
  sessionId,
  message,
  clientHistory,
}: {
  vehicleId: string;
  isDemoVehicle: boolean;
  sessionId: string | null;
  message: string;
  clientHistory: unknown[];
}): Promise<ThreadResult> {
  if (isDemoVehicle) {
    return { ok: true, sessionId: sessionId || 'demo-session', messageHistory: clientHistory };
  }

  if (sessionId) {
    // Authorizes the session against its own parent vehicle, so a valid id
    // belonging to another car is refused rather than resumed.
    const existing = await getConsultantSession(sessionId);

    if (!existing.success || !existing.data) {
      return { ok: false, error: 'Conversation not found', status: 404 };
    }

    if (existing.data.vehicle_id !== vehicleId) {
      // Same status as "not found": which conversations exist under which
      // vehicle is not something to confirm.
      return { ok: false, error: 'Conversation not found', status: 404 };
    }

    return {
      ok: true,
      sessionId,
      messageHistory: Array.isArray(existing.data.message_history)
        ? existing.data.message_history
        : [],
    };
  }

  const created = await createConsultantSession(vehicleId, await generateSessionTitle(message));

  if (!created.success || !created.sessionId) {
    return { ok: false, error: 'Failed to start a conversation', status: 500 };
  }

  return { ok: true, sessionId: created.sessionId, messageHistory: [] };
}
