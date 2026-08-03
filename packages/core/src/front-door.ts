import { frontDoorClosedMessage, type FrontDoorDecision } from './ai/budget';

/**
 * The gate every anonymous front-door request passes, and the order it passes
 * it in. Phase 2.97a/b.
 *
 * ── Why the order is the artefact ───────────────────────────────────────────
 *
 * Erratum **T1** did not add a control, it **reordered** two that both already
 * existed in the plan — and that reorder was the whole finding. `cc-tech-0003`
 * at high confidence: a bucket keyed on a caller-supplied value counts to one
 * forever while reporting success, so IP bucketing cannot be the control the
 * design leans on.
 *
 * An ordering is exactly the kind of property that survives review and dies in
 * implementation, because every individual check is present and the diff looks
 * complete. So the order lives here as a pure function with tests on the
 * ordering itself, rather than as the sequence of `if` statements a route
 * handler happens to be written in.
 *
 * ── The order, and why each step is where it is ─────────────────────────────
 *
 * 1. **Kill switch.** Unconditional, and first. It is what someone reaches for
 *    while watching a bill climb; anything that can precede it can defeat it.
 * 2. **Daily spend ceiling.** The primary control (D8). Before the rate limit
 *    because a closed door should not also consume a visitor's rate-limit
 *    budget — they would then be throttled tomorrow for a request that was
 *    never served today.
 * 3. **Per-IP bucket.** Secondary, on a platform-supplied address only. Absent
 *    address means the bucket does not apply, not that everyone shares one.
 * 4. **Serve.** The visitor id rides along and may be `null`.
 *
 * ── An unmeasurable request is still served ─────────────────────────────────
 *
 * `visitorId` may be `null` on an allowed request, and that is deliberate.
 * Refusing to answer a stranger because the funnel cannot record them would be
 * instrumenting over serving — the measurement exists for the product, not the
 * other way round. The funnel drops the event; the person still gets their
 * answer.
 *
 * ── D6 is an absence, not a branch ──────────────────────────────────────────
 *
 * "No dossier generation on this path, ever" cannot be expressed as a check
 * here, because the correct implementation is that nothing on this path calls
 * it. It is asserted in the suite as an absence instead — a $0.118 Pro dossier
 * firing for anonymous traffic is the single most expensive mistake this
 * surface could make.
 */

export type GateRefusal = 'disabled' | 'closed' | 'rate_limited';

export type FrontDoorGate =
  | { allow: true; visitorId: string | null }
  | {
      allow: false;
      refusal: GateRefusal;
      /** HTTP status the route should return. */
      status: number;
      /** Copy safe to show a stranger. Never names a budget — see below. */
      message: string;
      /** Seconds, when the refusal is a rate limit. */
      retryAfterSeconds?: number;
    };

/**
 * What to tell someone who is asking too fast.
 *
 * Distinct from the closed-door message because the situations differ and the
 * remedies differ: this one is about them and resolves in seconds, the other is
 * about us and resolves tomorrow. Collapsing them into one string would tell
 * half of each group the wrong thing.
 */
export function tooFastMessage(): string {
  return 'That was a lot of requests at once — give it a moment and try again.';
}

export function decideFrontDoorGate({
  budget,
  rateLimited,
  retryAfterSeconds,
  visitorId,
}: {
  budget: FrontDoorDecision;
  rateLimited: boolean;
  retryAfterSeconds?: number;
  visitorId: string | null;
}): FrontDoorGate {
  /*
    1 and 2. Both come out of the budget decision, which checks the switch
    before it reads usage. They are separated here only so the route can return
    the right status and the log can say which happened.
  */
  if (!budget.allowed) {
    return {
      allow: false,
      refusal: budget.state === 'disabled' ? 'disabled' : 'closed',
      /*
        503, not 429. The distinction is not pedantry: 429 says "you did too
        much" and invites a retry in seconds, which is wrong on both counts
        here — the visitor did nothing, and the door reopens at midnight UTC.
        503 is also the honest signal to a crawler, which should back off rather
        than keep the surface pinned while it is already over budget.
      */
      status: 503,
      message: frontDoorClosedMessage(),
    };
  }

  // 3. Secondary, and only reached on a door that is actually open.
  if (rateLimited) {
    return {
      allow: false,
      refusal: 'rate_limited',
      status: 429,
      message: tooFastMessage(),
      retryAfterSeconds,
    };
  }

  // 4. `visitorId` may be null — see the header.
  return { allow: true, visitorId };
}
