import { getServiceRoleClient } from './supabase';
import { logger } from '@crewchief/core/logger';
import {
  FUNNEL_STEPS,
  type FunnelStep,
  isRecordableVisitorId,
  funnelCounts,
} from '@crewchief/core/funnel';

/**
 * Record that an anonymous visitor reached a step on the front door.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * Phase 2.97d, and a **ship gate** rather than a component (advisory P1, 7.6).
 * Phase 2.97 is justified entirely on producing demand evidence before money is
 * spent forming an entity; without this the phase produces a nicer landing page
 * and no knowledge. It is also the smallest line in the phase, which is exactly
 * why it is a gate — under time pressure it is the first thing that would go.
 *
 * ── It cannot fail a request, same hard rule as the AI meter ────────────────
 *
 * A stranger is mid-way through finding out whether their repair quote is fair.
 * Whether we recorded that they got there is not their problem, and an
 * instrumentation bug that turns a working answer into an error is strictly
 * worse than an unrecorded step. So every path returns rather than throws, the
 * caller does not await it, and a failed write is logged at warn and dropped.
 *
 * The honest cost of that, stated for the same reason `lib/ai-usage.ts` states
 * it: **this under-reports.** A dropped write is a visitor who got somewhere and
 * was not counted. `funnelCounts` is cumulative specifically so that a lost
 * middle step cannot produce a funnel where more people were answered than
 * uploaded — but the absolute numbers are a floor, and this table is not an
 * accounting record.
 *
 * ── Idempotent by construction ──────────────────────────────────────────────
 *
 * `UNIQUE (visitor_id, step)` plus `ON CONFLICT DO NOTHING` means a reload, a
 * prefetch, a back-button or a retry all collapse to one row. `landed` is the
 * event this matters for — it fires on a render — and solving it here rather
 * than at four call sites is why the constraint is in the schema.
 */

export type { FunnelStep };
export { FUNNEL_STEPS, funnelCounts };

export interface FunnelEvent {
  /**
   * The first-party id issued when the visitor landed.
   *
   * Required, and a missing one drops the event rather than writing a row with
   * a placeholder. A step that cannot be joined to the other three is a
   * counter, and counting it would inflate the top of the funnel and depress
   * every rate derived from it — a wrong funnel is worse than a short one,
   * because a short one is visible.
   */
  visitorId: string;
  step: FunnelStep;
}

/**
 * Persist one step. Resolves `true` when a row was written or already existed.
 *
 * A duplicate resolves `true`: the visitor did reach the step, which is the
 * question this table answers. Reporting the second `landed` of a reload as a
 * failure would put warnings in the log for the system working correctly.
 *
 * Exported un-wrapped so tests can await it. Application code should call
 * `recordFunnelStepInBackground`.
 */
export async function recordFunnelStep(event: FunnelEvent): Promise<boolean> {
  try {
    if (!isRecordableVisitorId(event.visitorId)) {
      logger.warn('FUNNEL:NO_VISITOR', 'Funnel step had no usable visitor id and was dropped', {
        step: event.step,
      });
      return false;
    }

    if (!FUNNEL_STEPS.includes(event.step)) {
      /*
        The database CHECK would refuse this too, but refusing here keeps the
        failure in the log next to the step name instead of surfacing as a
        constraint violation from a background write nobody is awaiting.
      */
      logger.warn('FUNNEL:UNKNOWN_STEP', 'Funnel step is not in the vocabulary', {
        step: event.step,
      });
      return false;
    }

    const client = getServiceRoleClient();

    const { error } = await client
      .from('funnel_events')
      .upsert(
        { visitor_id: event.visitorId, step: event.step },
        { onConflict: 'visitor_id,step', ignoreDuplicates: true }
      );

    if (error) {
      logger.warn('FUNNEL:WRITE_FAILED', 'Could not record funnel step', {
        step: event.step,
        message: error.message,
      });
      return false;
    }

    return true;
  } catch (err) {
    /*
      Catches what the `error` branch cannot: `getServiceRoleClient` throwing
      because the key is unset. That is the shape a misconfigured preview takes,
      and on the front door it must not turn a stranger's first impression into
      a 500.
    */
    logger.warn('FUNNEL:RECORD_THREW', 'Funnel recording threw and was dropped', {
      step: event.step,
      message: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Fire-and-forget. The call site does not await it and cannot be broken by it.
 *
 * `void` on the promise is load-bearing rather than stylistic: without it an
 * unhandled rejection from a future refactor above would take the process down
 * under Node's default, and the point of this module is that it cannot.
 */
export function recordFunnelStepInBackground(event: FunnelEvent): void {
  void recordFunnelStep(event).catch(() => {
    // `recordFunnelStep` already swallows and logs. Belt to that braces —
    // reached only if the catch above is ever removed.
  });
}
