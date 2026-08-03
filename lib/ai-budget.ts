import { getServiceRoleClient } from './supabase';
import { logger } from '@crewchief/core/logger';
import {
  dayStart,
  decideBudget,
  decideDemoBudget,
  monthStart,
  resolveTier,
  type BudgetDecision,
  type DemoBudgetDecision,
} from '@crewchief/core/ai/budget';

/**
 * Read what an account has spent this month and decide whether it may spend
 * more. Phase 5.1.
 *
 * ── The demo is capped too, and degrades rather than breaking ───────────────
 *
 * Anonymous traffic (`user_id IS NULL`) is the only unauthenticated path to a
 * model in this application, and it was the largest uncontrolled cost in it.
 * An earlier version of this file left it uncapped, reasoning that a fuse
 * blowing on the recruiter-facing demo was worse than the bill. That protects
 * the wrong thing — an unbounded bill is not safer than a quiet consultant.
 *
 * `checkDemoBudget` bounds it with two windows against one shared pool, and
 * the design point is that **exhausting it does not break the page**. The
 * garage, dossiers, service history, health scores and cost tables are all
 * stored data that never touches a model; only live chat pauses, and it says
 * why and when it returns. The daily window is what makes that survivable —
 * a monthly cap alone would mean one bad afternoon silences the demo for three
 * weeks.
 *
 * ── It fails open, and that is also a decision ──────────────────────────────
 *
 * If the query fails — the table missing, the service key unset on a preview,
 * Postgres unreachable — the call is allowed. A budget check that fails closed
 * turns a metering outage into a total product outage, and the thing being
 * protected is a bill, not a security boundary. The failure is logged at warn.
 *
 * The honest consequence: **this ceiling is best-effort.** It cannot be relied
 * on as the only control, which is why the per-minute rate limit stays exactly
 * where it is.
 */

export type { BudgetDecision, DemoBudgetDecision };

/** Allowed, with nothing measured. The shape returned on every bail-out path. */
const UNMEASURED: BudgetDecision = {
  state: 'ok',
  allowed: true,
  usedOutputTokens: 0,
  limitOutputTokens: 0,
  fractionUsed: 0,
  remainingOutputTokens: Number.POSITIVE_INFINITY,
};

/**
 * Whether the shared public demo may make another model call.
 *
 * Anonymous traffic is one pool — there is no account to key on and that is
 * the point: the demo is a single shared resource with a single bill.
 *
 * One query, two windows. Today's rows are a subset of this month's, so
 * fetching the month once and partitioning in memory costs one round trip
 * instead of two. The row count is bounded by the cap itself, which is the
 * pleasant kind of circular.
 *
 * Fails open, like the per-account check and for the same reason: what is being
 * protected is a bill, not a security boundary, and the per-minute rate limit
 * is still underneath it.
 */
export async function checkDemoBudget(): Promise<DemoBudgetDecision> {
  try {
    const client = getServiceRoleClient();
    const since = monthStart().toISOString();

    const { data, error } = await client
      .from('ai_usage_events')
      .select('output_tokens, thoughts_tokens, created_at')
      .is('user_id', null)
      .gte('created_at', since);

    if (error) {
      logger.warn('AI_BUDGET:DEMO_READ_FAILED', 'Could not read demo usage; allowing the call', {
        message: error.message,
      });
      return { allowed: true, exhausted: null, usedToday: 0, usedThisMonth: 0 };
    }

    const dayBoundary = dayStart().getTime();
    let usedToday = 0;
    let usedThisMonth = 0;

    for (const row of data ?? []) {
      // Thinking counted with output — it bills at the output rate, and on the
      // consultant it is the larger half.
      const cost = (row.output_tokens ?? 0) + (row.thoughts_tokens ?? 0);
      usedThisMonth += cost;
      if (new Date(row.created_at as string).getTime() >= dayBoundary) usedToday += cost;
    }

    const decision = decideDemoBudget(usedToday, usedThisMonth);

    if (!decision.allowed) {
      logger.warn('AI_BUDGET:DEMO_EXHAUSTED', 'Demo AI allowance spent', {
        exhausted: decision.exhausted,
        usedToday: decision.usedToday,
        usedThisMonth: decision.usedThisMonth,
      });
    }

    return decision;
  } catch (err) {
    logger.warn('AI_BUDGET:DEMO_THREW', 'Demo budget check threw; allowing the call', {
      message: err instanceof Error ? err.message : String(err),
    });
    return { allowed: true, exhausted: null, usedToday: 0, usedThisMonth: 0 };
  }
}

export async function checkMonthlyBudget(userId: string | null): Promise<BudgetDecision> {
  // Anonymous traffic is not per-account and is gated by `checkDemoBudget`
  // instead — one shared pool, two windows. See above.
  if (!userId) return UNMEASURED;

  try {
    const client = getServiceRoleClient();
    const since = monthStart().toISOString();

    /*
      Only the two columns the decision needs, and only this month's rows. The
      `(user_id, created_at DESC)` index from `20260802150000` is what makes
      this cheap enough to run before a Gemini call rather than on a schedule.
    */
    const { data, error } = await client
      .from('ai_usage_events')
      .select('output_tokens, thoughts_tokens')
      .eq('user_id', userId)
      .gte('created_at', since);

    if (error) {
      logger.warn('AI_BUDGET:READ_FAILED', 'Could not read monthly usage; allowing the call', {
        userId,
        message: error.message,
      });
      return UNMEASURED;
    }

    /*
      Thinking is summed with output because it bills at the output rate — the
      whole reason `thoughts_tokens` is its own column. A budget that counted
      only `output_tokens` would have missed five-sixths of what the consultant
      cost before 2.95a, and still misses most of it now.
    */
    const outputTokens = (data ?? []).reduce(
      (sum, row) => sum + (row.output_tokens ?? 0) + (row.thoughts_tokens ?? 0),
      0
    );

    const decision = decideBudget({ inputTokens: 0, outputTokens }, resolveTier(userId));

    if (decision.state !== 'ok') {
      logger.warn('AI_BUDGET:' + decision.state.toUpperCase(), 'Account is at or near its monthly AI budget', {
        userId,
        used: decision.usedOutputTokens,
        limit: decision.limitOutputTokens,
      });
    }

    return decision;
  } catch (err) {
    logger.warn('AI_BUDGET:THREW', 'Budget check threw; allowing the call', {
      userId,
      message: err instanceof Error ? err.message : String(err),
    });
    return UNMEASURED;
  }
}
