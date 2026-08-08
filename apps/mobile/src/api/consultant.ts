import { apiRequest } from './client';
import { isContextKind, type ContextKind } from '@crewchief/core/consultant-context-kinds';

/**
 * The advisor — Phase 3.4, and the flow carrying the App Store 4.2 argument.
 *
 * ── One call, and no transcript upload ──────────────────────────────────────
 *
 * `POST /api/v1/consultant` takes a vehicle, a question, and optionally the
 * thread it belongs to. **It does not take the conversation.** The route reads
 * `message_history` out of `consultant_conversations` itself, so a phone
 * resuming a thread does not replay it and cannot rewrite what it was told
 * earlier. That is the route's design, not a convenience — its `resolveThread`
 * docblock is the authority.
 *
 * Omitting `sessionId` starts a thread and the response carries the new id, so
 * asking a first question is one round trip rather than two. **The caller must
 * keep that id** — the screen holds it for the life of the conversation, and
 * dropping it silently starts a second thread on the next message.
 *
 * ── What is deliberately not sent ───────────────────────────────────────────
 *
 * `messageHistory` and `attachedDocuments` are both accepted by the route and
 * neither is in `AskAdvisorParams`. History is server-side for the reason
 * above — the route ignores what a non-demo caller posts. Attachments belong to
 * 3.3, which needs a camera, which is a native module and therefore a second
 * EAS build; sending the field before that flow exists would be a parameter no
 * caller can populate.
 *
 * ── Why the response is narrowed by hand ────────────────────────────────────
 *
 * `apiRequest<T>` casts. What actually arrives is parsed JSON, so `T` is a
 * claim about the server rather than a check on it, and `contextKinds` in
 * particular is rendered as a **provenance row** — the one place in this app
 * where drawing something unverified means asserting something untrue. A kind
 * this build does not recognise is dropped rather than shown, which is what
 * `isContextKind` is for.
 */

export interface AskAdvisorParams {
  vehicleId: string;
  message: string;
  /** Omit on the first message of a thread; the response returns the new id. */
  sessionId?: string | null;
}

export interface AdvisorAnswer {
  /** Always present, and always the id to send with the next message. */
  sessionId: string;
  response: string;
  /** What the server loaded and put in front of the model. Rendered "Based on". */
  contextKinds: ContextKind[];
}

/** Matches the route's own ceiling, so an over-long message fails before the flight. */
export const MAX_MESSAGE_LENGTH = 4000;

export async function askAdvisor({
  vehicleId,
  message,
  sessionId,
}: AskAdvisorParams): Promise<AdvisorAnswer> {
  const body = await apiRequest<{
    sessionId?: unknown;
    response?: unknown;
    contextKinds?: unknown;
  }>('/consultant', {
    method: 'POST',
    body: {
      vehicleId,
      message,
      /*
        Omitted rather than sent as null. The route reads it with
        `typeof body.sessionId === 'string'`, so null and absent are already
        equivalent to it — but "absent" is what "start a new thread" means, and
        writing it that way keeps the request honest about the intent.
      */
      ...(sessionId ? { sessionId } : {}),
    },
  });

  return {
    /*
      Falling back to the id we sent covers the impossible case without
      inventing one: a server that answered but returned no id has still
      answered *this* thread. An empty string would silently start a new
      conversation on the next message.
    */
    sessionId: typeof body.sessionId === 'string' ? body.sessionId : (sessionId ?? ''),
    response: typeof body.response === 'string' ? body.response : '',
    contextKinds: Array.isArray(body.contextKinds)
      ? body.contextKinds.filter(isContextKind)
      : [],
  };
}
