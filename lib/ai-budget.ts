import { getServiceRoleClient } from './supabase';
import { logger } from '@crewchief/core/logger';
import {
  dayStart,
  decideBudget,
  decideDemoBudget,
  decideFrontDoor,
  monthStart,
  resolveTier,
  FRONT_DOOR_DISABLED_ENV,
  type BudgetDecision,
  type DemoBudgetDecision,
  type FrontDoorDecision,
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

export type { BudgetDecision, DemoBudgetDecision, FrontDoorDecision };

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

/**
 * Whether the anonymous front door may make another model call. Phase 2.97a.
 *
 * **Keys on `surface = 'anonymous'`, not on `user_id IS NULL`.** That
 * distinction is the whole reason this function exists rather than reusing
 * `checkDemoBudget`: the null-user predicate matches the seeded demo today, and
 * will match both surfaces the moment this door opens. Two budgets D3 requires
 * to be separate would silently become one pool, and the more abusable surface
 * would be spending the portfolio piece's allowance.
 *
 * Daily window only — see `FRONT_DOOR_BUDGET` for why a monthly ceiling is the
 * wrong shape here even though the demo has one.
 *
 * Fails **open**, like every other budget check in this file, and here that is
 * a genuinely uncomfortable choice worth naming rather than inheriting: this is
 * an unauthenticated endpoint, so failing open on a metering outage means an
 * uncapped anonymous path to a paid model. It is still right. A budget read
 * that fails closed turns a Postgres hiccup into a dead acquisition surface,
 * the per-IP bucket is still underneath, and the manual kill switch does not
 * depend on this query at all — which is precisely why the switch is checked
 * first and separately.
 */
export async function checkFrontDoorBudget(): Promise<FrontDoorDecision> {
  const manuallyDisabled = process.env[FRONT_DOOR_DISABLED_ENV] === 'true';

  /*
    Checked before the query, and returned before it. The switch is what
    someone reaches for while watching money leave, so it must not be able to
    fail because the thing it is protecting against has also broken the
    database.
  */
  if (manuallyDisabled) {
    return decideFrontDoor({ usedToday: 0, manuallyDisabled: true });
  }

  try {
    const client = getServiceRoleClient();

    const { data, error } = await client
      .from('ai_usage_events')
      .select('output_tokens, thoughts_tokens')
      .eq('surface', 'anonymous')
      .gte('created_at', dayStart().toISOString());

    if (error) {
      logger.warn('AI_BUDGET:FRONT_DOOR_READ_FAILED', 'Could not read front-door usage; allowing the call', {
        message: error.message,
      });
      return decideFrontDoor({ usedToday: 0, manuallyDisabled: false });
    }

    // Thinking summed with output — it bills at the output rate, and on a
    // vision call it is not the small half.
    const usedToday = (data ?? []).reduce(
      (sum, row) => sum + (row.output_tokens ?? 0) + (row.thoughts_tokens ?? 0),
      0
    );

    const decision = decideFrontDoor({ usedToday, manuallyDisabled: false });

    if (decision.shouldAlert) {
      /*
        The only `error`-level line in this file. Everything else here is a warn
        because it degrades something; this one means the acquisition surface is
        shut and will stay shut until midnight UTC.

        **Who receives it is undecided** — the third part of D8, unanswered while
        the captcha and ceiling halves were settled. Until that is closed this
        reaches the platform log and nobody's phone, which is worth knowing
        rather than assuming.
      */
      logger.error(
        'AI_BUDGET:FRONT_DOOR_EXHAUSTED',
        new Error('Front door daily ceiling hit — anonymous quote checks are closed until tomorrow'),
        { usedToday: decision.usedToday, limitToday: decision.limitToday }
      );
    } else if (decision.state === 'approaching') {
      logger.warn('AI_BUDGET:FRONT_DOOR_APPROACHING', 'Front door is near its daily ceiling', {
        usedToday: decision.usedToday,
        limitToday: decision.limitToday,
      });
    }

    return decision;
  } catch (err) {
    logger.warn('AI_BUDGET:FRONT_DOOR_THREW', 'Front-door budget check threw; allowing the call', {
      message: err instanceof Error ? err.message : String(err),
    });
    return decideFrontDoor({ usedToday: 0, manuallyDisabled: false });
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
