/**
 * What an account is allowed to spend on Gemini in a month, and what happens
 * as it gets there. No database, no SDK.
 *
 * ── Why this exists at all ──────────────────────────────────────────────────
 *
 * Phase 5.1. Before it, the only control on AI spend was ten calls per minute
 * per vehicle — a ceiling of roughly 432,000 calls a month, which is not a
 * ceiling. `CREWCHIEF_COMMERCIAL_EVAL_2026-08-01.md` puts a daily-use
 * enthusiast at $10.63–$13.57/month against $9.40 net at $9.99, so the tail is
 * not a rounding error, it is the whole margin. Addendum A is blunt that this
 * control "is not optional".
 *
 * ── What this file deliberately does not decide ─────────────────────────────
 *
 * **The price (D2) and the free-tier shape (D3) are not decided**, and the
 * advisor KB is silent on both — checked, not assumed. So the numbers below are
 * *cost ceilings*, not product tiers, and they are expressed in tokens rather
 * than dollars or features. A token ceiling protects the bill without claiming
 * to know what anyone will pay.
 *
 * When 5.2 lands and a profile can say which plan it is on, `TIERS` gains
 * entries and `resolveTier` stops returning a constant. Nothing else here
 * should need to change.
 */

/** The billable quantity a budget is measured in. See `billableTokens`. */
export interface MonthlyUsage {
  /** Input tokens billed at the full rate, this calendar month. */
  inputTokens: number;
  /** Output *and* thinking tokens, which bill at the same higher rate. */
  outputTokens: number;
}

export type TierName = 'free' | 'paid';

export interface Tier {
  name: TierName;
  /**
   * Output-equivalent tokens per calendar month.
   *
   * Output rather than total, because output is where the money is: on
   * `gemini-3.6-flash` it bills at roughly 12x the input rate, and thinking —
   * measured on 2 Aug at 5–8x the visible answer even at `LOW` — bills as
   * output. A cap on total tokens would be dominated by prompt size, which is
   * the cheap half and the half a user does not control.
   */
  monthlyOutputTokens: number;
}

/**
 * Ceilings, not plans.
 *
 * `free` is set so an ordinary month of real use does not touch it — the
 * eval's median archetype lands around 200k output-equivalent tokens — while
 * still stopping the runaway case that costs more than any plausible price.
 * It is a fuse, not a meter.
 *
 * `paid` exists so the shape of the code is right before there is anything to
 * sell. It is not a commitment to a number.
 */
export const TIERS: Record<TierName, Tier> = {
  free: { name: 'free', monthlyOutputTokens: 400_000 },
  paid: { name: 'paid', monthlyOutputTokens: 2_000_000 },
};

/**
 * Which tier an account is on.
 *
 * Constant until 5.2 gives a profile somewhere to record a subscription. It is
 * a function rather than a constant so the call sites are already written
 * against the right shape — swapping the body is then the whole change.
 */
export function resolveTier(_userId: string | null): Tier {
  return TIERS.free;
}

/**
 * The public demo's own ceiling.
 *
 * ── Why the demo needs one at all ───────────────────────────────────────────
 *
 * It is the only unauthenticated surface that calls Gemini. The per-minute
 * limit is ten calls per vehicle and there are three demo vehicles, so the
 * theoretical ceiling was around 1.3 million calls a month — which is not a
 * ceiling, it is a number. An anonymous, publicly invokable model endpoint with
 * no monthly bound is the largest uncontrolled cost in the application, and it
 * was first left uncapped on the argument that capping it risked the portfolio
 * piece. That argument protects the wrong thing: an unbounded bill is not safer
 * than a quiet consultant.
 *
 * ── Two windows, and the daily one is the important half ────────────────────
 *
 * A monthly cap alone fails badly. One bad afternoon exhausts it and the demo's
 * consultant is dead for three weeks — precisely the outcome worth avoiding on
 * a page recruiters are sent to. A daily cap turns that into "quiet until
 * tomorrow", which is survivable, and bounds the month anyway. Whichever binds
 * first wins.
 *
 * ── The arithmetic behind the numbers ───────────────────────────────────────
 *
 * Measured 2 Aug: a consultant turn runs roughly 450 thinking + 150 output ≈
 * 600 output-equivalent tokens, and Flash output bills around $7.50/M — about
 * $0.0045 a turn.
 *
 *   daily      150,000 ≈   250 turns ≈  $1.13/day
 *   monthly  1,500,000 ≈ 2,500 turns ≈ $11.25/month
 *
 * 250 consultant turns in a day is far more than a portfolio link produces, so
 * an honest visitor never meets the limit. The worst case stops being unbounded
 * and becomes about eleven dollars.
 */
export const DEMO_BUDGET = {
  dailyOutputTokens: 150_000,
  monthlyOutputTokens: 1_500_000,
} as const;

/** The fraction of the budget at which a user is told they are approaching it. */
export const WARN_AT = 0.8;

export type BudgetState = 'ok' | 'approaching' | 'exceeded';

export interface BudgetDecision {
  state: BudgetState;
  /** Whether the call this decision gates may proceed. */
  allowed: boolean;
  usedOutputTokens: number;
  limitOutputTokens: number;
  /** Never negative — a user 20% over budget is at 100%, not 120%. */
  fractionUsed: number;
  remainingOutputTokens: number;
}

/**
 * Decide whether a call may proceed, given what has been spent this month.
 *
 * Pure, and separate from the query that feeds it, because this is the part
 * that is easy to get subtly wrong — an off-by-one at the boundary, a negative
 * remainder, a NaN from a missing row — and none of those throw.
 */
export function decideBudget(usage: MonthlyUsage, tier: Tier): BudgetDecision {
  const used = Math.max(0, Math.round(usage.outputTokens || 0));
  const limit = tier.monthlyOutputTokens;

  /*
    A non-positive limit means "no ceiling configured", not "spend nothing".
    Reading it the other way would take every AI feature offline the moment a
    tier was misconfigured — a config typo becoming an outage.
  */
  if (!Number.isFinite(limit) || limit <= 0) {
    return {
      state: 'ok',
      allowed: true,
      usedOutputTokens: used,
      limitOutputTokens: 0,
      fractionUsed: 0,
      remainingOutputTokens: Number.POSITIVE_INFINITY,
    };
  }

  const fractionUsed = Math.min(1, used / limit);
  const remaining = Math.max(0, limit - used);

  // `>=` at the boundary: a user exactly at their limit has spent it.
  const state: BudgetState = used >= limit ? 'exceeded' : used >= limit * WARN_AT ? 'approaching' : 'ok';

  return {
    state,
    allowed: state !== 'exceeded',
    usedOutputTokens: used,
    limitOutputTokens: limit,
    fractionUsed,
    remainingOutputTokens: remaining,
  };
}

/**
 * Decide whether the shared demo may make another model call.
 *
 * Two windows against one pool. The tighter verdict wins, and the *reason* is
 * carried back so the message can say "today" or "this month" — "the limit was
 * reached" with no horizon reads as broken, where "quiet until tomorrow" reads
 * as designed.
 */
export interface DemoBudgetDecision {
  allowed: boolean;
  /** Which window stopped it, or null when nothing did. */
  exhausted: 'day' | 'month' | null;
  usedToday: number;
  usedThisMonth: number;
}

export function decideDemoBudget(
  usedToday: number,
  usedThisMonth: number,
  budget: { dailyOutputTokens: number; monthlyOutputTokens: number } = DEMO_BUDGET
): DemoBudgetDecision {
  const today = Math.max(0, Math.round(usedToday || 0));
  const month = Math.max(0, Math.round(usedThisMonth || 0));

  /*
    Same rule as `decideBudget`: a non-positive ceiling means "not configured",
    never "spend nothing". A typo here would silence the consultant on the
    public demo, which is the failure this whole design is trying to avoid.
  */
  const dailyLimit = budget.dailyOutputTokens > 0 ? budget.dailyOutputTokens : Infinity;
  const monthlyLimit = budget.monthlyOutputTokens > 0 ? budget.monthlyOutputTokens : Infinity;

  // Month checked first: if the month is gone, saying "try tomorrow" would be
  // a lie, and a wrong horizon is worse than none.
  if (month >= monthlyLimit) {
    return { allowed: false, exhausted: 'month', usedToday: today, usedThisMonth: month };
  }
  if (today >= dailyLimit) {
    return { allowed: false, exhausted: 'day', usedToday: today, usedThisMonth: month };
  }

  return { allowed: true, exhausted: null, usedToday: today, usedThisMonth: month };
}

/**
 * What the demo says when its allowance is spent.
 *
 * Deliberately not an apology and not an error. This is a shared public demo
 * with a spending cap, which is a true and faintly reassuring thing for a
 * recruiter to read — and every other part of the page still works, because
 * the garage, the dossiers, the service history and the cost tables are all
 * real stored data that never touches a model.
 */
export function demoBudgetMessage(decision: DemoBudgetDecision): string {
  const horizon = decision.exhausted === 'month' ? 'next month' : 'tomorrow';

  return (
    `This is a shared public demo, and its AI allowance for ${
      decision.exhausted === 'month' ? 'this month' : 'today'
    } has been used. ` +
    `The consultant is back ${horizon}. Everything else on this page is real data and still works.`
  );
}

/**
 * The first instant of the current day, in UTC.
 *
 * UTC for the same reason as `monthStart` — it has to agree with the
 * `created_at` values it is compared against, which Postgres wrote in UTC.
 */
export function dayStart(now: Date = new Date()): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0)
  );
}

/**
 * The first instant of the current calendar month, in UTC.
 *
 * UTC rather than local time, deliberately: the budget is compared against
 * rows whose `created_at` the database wrote in UTC, and a month boundary that
 * moves with the user's timezone would give someone in UTC+13 several extra
 * hours of budget twice a year. It also has to agree with whatever bills.
 */
export function monthStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}

/**
 * The message a user sees when the fuse blows.
 *
 * Says what happened, when it resets, and does not apologise for a limit that
 * exists to keep the product alive. It deliberately does not say "upgrade":
 * there is nothing to upgrade to until 5.2, and an upgrade prompt that leads
 * nowhere is worse than a plain limit.
 */
export function budgetMessage(decision: BudgetDecision, now: Date = new Date()): string {
  const resets = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const when = resets.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });

  return `You have used this month's AI allowance. It resets on ${when}.`;
}
