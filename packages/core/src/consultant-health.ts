/**
 * Classifying a consultant round trip into good / broken / degraded.
 *
 * Pure. The route in `app/api/health/consultant` does the network call and
 * hands the result here, so the decision that gates a promotion can be tested
 * without Google, without a key, and without a deployment.
 *
 * ── Why three outcomes and not two ──────────────────────────────────────────
 *
 * From `CREWCHIEF_ROUNDTRIP_GATE_DESIGN.md`. A gate that fails on someone
 * else's outage gets routed around within a week, and a gate people route
 * around is worse than no gate. So "the consultant is broken" and "Gemini is
 * unavailable right now" are different answers with different consequences:
 * the first is ours and blocks absolutely; the second blocks but can be
 * overridden deliberately, on the command line, with the reason written into
 * the promotion's merge commit.
 *
 * ── Why classification happens server-side ──────────────────────────────────
 *
 * The route sees the actual Google error object. `verify-demo.mjs` would only
 * see text through two layers of indirection, and a classifier built on
 * someone else's copywriting is a classifier that breaks when they reword an
 * error. The route returns a machine token; the script reads the token.
 *
 * That matters here more than usual: §22 records this project mis-diagnosing a
 * 401 twice, because a stale credential and a malformed one return **the same
 * UNAUTHENTICATED text**. Both are `broken` below, which is why that
 * distinction does not need to be made to gate correctly.
 */

export type ConsultantHealthStatus = 'good' | 'broken' | 'degraded';

export interface ConsultantHealth {
  status: ConsultantHealthStatus;
  /** Machine token. Stable — scripts branch on this, never on `detail`. */
  reason: string;
  /** Human text. May quote upstream wording; never parsed. */
  detail: string;
}

/** The literal string the client renders when a consultant call fails. */
export const CLIENT_ERROR_FALLBACK = 'Sorry, I encountered an error. Please try again.';

/**
 * Upstream conditions that are Google being unavailable rather than us being
 * wrong. Retried once before this classification stands.
 */
const DEGRADED_HTTP = [429, 500, 502, 503, 504];

/**
 * Google error markers that mean our credential is wrong, missing or stale.
 *
 * All three are `broken`. §22's lesson is that they are not reliably
 * distinguishable from one another — and for gating they do not need to be,
 * because the response to every one of them is the same: do not promote.
 */
const CREDENTIAL_MARKERS = [
  'UNAUTHENTICATED',
  'ACCESS_TOKEN_TYPE_UNSUPPORTED',
  'API_KEY_INVALID',
  'PERMISSION_DENIED',
];

export interface RoundTripResult {
  /** HTTP status from our own consultant call, or 0 if the request threw. */
  httpStatus: number;
  /** The answer text, if one came back. */
  answer?: string | null;
  /** Error text from the transport or the upstream body. */
  errorText?: string | null;
  /** True when the request timed out rather than returning. */
  timedOut?: boolean;
}

/**
 * Decide what a round trip means.
 *
 * @param expectedTokens Vehicle-specific facts from the seed knowledge base.
 *                       At least one must appear for `good`. Sourced from
 *                       `CONSULTANT_ROUND_TRIP` in `demo-contract.ts`, not
 *                       hardcoded, so correcting the seed does not fail the
 *                       gate.
 */
export function classifyRoundTrip(
  result: RoundTripResult,
  expectedTokens: readonly string[]
): ConsultantHealth {
  const error = result.errorText ?? '';

  if (result.timedOut) {
    return {
      status: 'degraded',
      reason: 'TIMEOUT',
      detail: 'The consultant did not respond before the timeout.',
    };
  }

  /*
    Our own authorization refusing the call — cause 1 of the §25 outage, when
    a demo vehicle was rejected as read-only by a route that should have been
    reading. Ours, so it blocks with no override.
  */
  if (result.httpStatus === 403 || /read-only/i.test(error)) {
    return {
      status: 'broken',
      reason: 'AUTHORIZATION_REFUSED',
      detail: `Our own authorization refused the consultant call: ${error || 'HTTP 403'}`,
    };
  }

  const credentialMarker = CREDENTIAL_MARKERS.find((m) => error.includes(m));
  if (credentialMarker) {
    return {
      status: 'broken',
      reason: 'CREDENTIAL_REJECTED',
      detail: `Google rejected this deployment's credential (${credentialMarker}). Stale or wrong — the response does not distinguish them, and both block.`,
    };
  }

  if (result.httpStatus === 401) {
    return {
      status: 'broken',
      reason: 'CREDENTIAL_REJECTED',
      detail: 'HTTP 401 from the consultant call.',
    };
  }

  if (DEGRADED_HTTP.includes(result.httpStatus)) {
    return {
      status: 'degraded',
      reason: `UPSTREAM_${result.httpStatus}`,
      detail: `Gemini returned HTTP ${result.httpStatus}. Retried once already.`,
    };
  }

  if (result.httpStatus !== 200) {
    return {
      status: 'broken',
      reason: 'UNEXPECTED_STATUS',
      detail: `Consultant call returned HTTP ${result.httpStatus}. ${error}`.trim(),
    };
  }

  const answer = result.answer ?? '';

  /*
    A 200 carrying the client's own error string is the §25 failure exactly:
    the page loaded, the request succeeded, and the feature was dead. `broken`,
    not `degraded` — the whole reason this gate exists is that a 200 was
    treated as proof once already.
  */
  if (answer.includes(CLIENT_ERROR_FALLBACK)) {
    return {
      status: 'broken',
      reason: 'CLIENT_ERROR_STRING',
      detail: 'The consultant returned 200 carrying its own error message.',
    };
  }

  if (!answer.trim()) {
    return {
      status: 'broken',
      reason: 'EMPTY_ANSWER',
      detail: 'The consultant returned 200 with an empty answer.',
    };
  }

  const matched = expectedTokens.filter((t) => answer.includes(t));
  if (matched.length === 0) {
    /*
      A generic answer. Distinguishes "the model replied" from "the model
      replied about *this vehicle*" — which is the difference between the
      consultant working and the consultant merely responding.
    */
    return {
      status: 'broken',
      reason: 'NO_VEHICLE_FACTS',
      detail: `The answer contained none of the expected vehicle facts (${expectedTokens.join(', ')}). It answered, but not about this car.`,
    };
  }

  return {
    status: 'good',
    reason: 'OK',
    detail: `The consultant answered with vehicle-specific facts: ${matched.join(', ')}.`,
  };
}

/** Whether a status should be retried once before it stands. */
export function isRetryable(status: ConsultantHealthStatus): boolean {
  /*
    Only degraded. Never retry a `broken`: a 403 from our own authorization
    returns exactly the same 403 the second time, and retrying only makes the
    log ambiguous about whether something intermittent happened.
  */
  return status === 'degraded';
}
