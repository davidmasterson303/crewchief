import { getServiceRoleClient } from './supabase';
import { logger } from '@crewchief/core/logger';
import {
  decideBudget,
  monthStart,
  resolveTier,
  type BudgetDecision,
} from '@crewchief/core/ai/budget';

/**
 * Read what an account has spent this month and decide whether it may spend
 * more. Phase 5.1.
 *
 * ── The demo is never hard-stopped, and that is a decision ──────────────────
 *
 * Anonymous demo traffic (`user_id IS NULL`) is real spend on a public,
 * unauthenticated surface, and it is exactly the traffic a budget exists to
 * bound. It is also `crewchief-demo.davidmasterson.co` — linked from a
 * portfolio, shown to recruiters during an active job search. A hard stop
 * there converts a cost problem into a blank page in front of the audience the
 * whole product is being shown to.
 *
 * So the demo is **measured and logged, never blocked**. If it ever runs hot
 * the log says so and the answer is a decision someone takes deliberately, not
 * a fuse that blows on a Tuesday afternoon while someone is reading the page.
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

export type { BudgetDecision };

/** Allowed, with nothing measured. The shape returned on every bail-out path. */
const UNMEASURED: BudgetDecision = {
  state: 'ok',
  allowed: true,
  usedOutputTokens: 0,
  limitOutputTokens: 0,
  fractionUsed: 0,
  remainingOutputTokens: Number.POSITIVE_INFINITY,
};

export async function checkMonthlyBudget(userId: string | null): Promise<BudgetDecision> {
  // The demo. Measured by `recordAiUsage` like everything else; simply not
  // gated. See the note above.
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
