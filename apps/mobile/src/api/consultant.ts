import { apiRequest } from './client';
import { isContextKind, type ContextKind } from '@wellkept/core/consultant-context-kinds';
import type { AdviceRange } from '@wellkept/core/advice-range';
import type { ConsultantEstimate, EstimateLine } from '@wellkept/core/consultant-estimate';

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
  /**
   * The priced lines behind the estimate well, when the answer priced anything.
   *
   * ⚠ **Optional, and it is the field's most important property.** Most advisor
   * answers are not quotes. The server omits this rather than sending an empty
   * one for exactly that reason — see the route's own note — and the screen must
   * render nothing at all when it is absent. A well showing no lines, or a total
   * of $0, on ordinary advice would be the product asserting a price it never
   * inferred.
   */
  estimate?: ConsultantEstimate;
}

/**
 * Narrow an estimate off the wire, or drop it whole.
 *
 * The same argument as `isContextKind` one field along, and stronger here. This
 * is rendered as **prices, in the product's own voice, inside a styled well** —
 * the strongest claim of precision anything in this app makes. A partially
 * understood estimate is not a degraded estimate, it is a wrong one, so a
 * malformed line takes only itself and a payload with no usable lines returns
 * `undefined` rather than an empty shell.
 *
 * ⚠ It does **not** re-validate the numbers. `parseEstimate` on the server
 * already widened every range to an honest spread and dropped verdict labels;
 * repeating that here would put two copies of the same policy in two packages,
 * and the copy that drifts is always the second one.
 */
function narrowEstimate(raw: unknown): ConsultantEstimate | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;

  const source = raw as { lines?: unknown; likely?: unknown };
  if (!Array.isArray(source.lines)) return undefined;

  const lines = source.lines.filter(isEstimateLine);
  if (lines.length === 0) return undefined;

  const likely = isAdviceRange(source.likely) ? source.likely : undefined;

  return { lines, ...(likely ? { likely } : {}) };
}

function isAdviceRange(value: unknown): value is AdviceRange {
  if (typeof value !== 'object' || value === null) return false;
  const range = value as { low?: unknown; high?: unknown };
  return typeof range.low === 'number' && typeof range.high === 'number';
}

function isEstimateLine(value: unknown): value is EstimateLine {
  if (typeof value !== 'object' || value === null) return false;
  const line = value as { label?: unknown; range?: unknown };
  return typeof line.label === 'string' && line.label !== '' && isAdviceRange(line.range);
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
    estimate?: unknown;
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

  const estimate = narrowEstimate(body.estimate);

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
    // Spread rather than assigned, so an answer with no estimate has no
    // `estimate` key at all. `undefined` and absent read the same in most code
    // and differently in an `'estimate' in answer` check, and this is a field
    // whose whole contract is that absent means absent.
    ...(estimate ? { estimate } : {}),
  };
}
