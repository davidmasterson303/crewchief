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
 * `TIERS` is where a new plan gets its ceiling. **Which tier an account is
 * actually on is no longer decided here** — that moved to
 * `@wellkept/core/entitlement`, which reads a stored record against the clock,
 * because a subscription expires and a constant cannot.
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
  /*
    ⚠ Lowered 2,000,000 → 1,000,000 on 21 Aug, when the price landed at $3.99.

    The old ceiling was sized for a $9–15 subscription. At $3.99, Apple's 15%
    leaves $3.39 — so a ceiling of 2M output-equivalent tokens (~$15 at Flash's
    $7.50/M) was **4.4× the revenue it was supposed to protect**. A ceiling
    above net revenue is not a ceiling, it is a maximum loss.

    1M is ~$7.50 worst case, still 2.5× the free tier, and roughly three times
    the heaviest month any real account has ever produced: the developer's own
    account, building daily, measured $3.10/month across every purpose.

    ⚠ It remains a fuse rather than a plan. Nobody real is expected to approach
    it, and the two changes shipped alongside — caching modification details and
    dropping their thinking budget — cut typical spend by more than this cap
    does. This bounds the tail; those reduce the median.
  */
  paid: { name: 'paid', monthlyOutputTokens: 1_000_000 },
};

/*
  ── ⚠ `entitlementMultiple()` was here, and IAP-06 closed by deletion ────────

  It computed the paid:free ratio so `PaywallScreen` could say the subscription
  "raises that allowance N times over" without the number drifting from `TIERS`.
  That was the right fix for the arithmetic — the copy had claimed **five**
  times against a real 2.5× — and it left the actual problem standing: an
  allowance is not something a customer can see, judge, or relate to their own
  use, so the sentence was unintelligible whatever number went in it.

  The pricing decision of 24 Aug moved the boundary from how much you have used
  to which features you have, so there is **no multiple to state** and the
  sentence is gone rather than corrected. A derived figure nothing renders is
  the same defect in a smaller form.

  ⚠ The ceilings below did not go anywhere and are still enforced. What changed
  is their role: abuse protection behind the gate, never customer-facing copy.
  `paid-features.ts` carries the argument, and this file's own words for `free`
  — "a fuse, not a meter" — are now true of `paid` as well.
*/

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

/**
 * The anonymous front door's own ceiling. Phase 2.97a, decision **D8**.
 *
 * ── Why it cannot share the demo's pool ─────────────────────────────────────
 *
 * `checkDemoBudget` keys on `user_id IS NULL`, which today means the seeded
 * demo garage and nothing else. **The moment the front door opens, that
 * predicate matches both surfaces** and two budgets that must stay separate
 * become one. Roadmap D3 is explicit that the anonymous tier needs its own
 * budget line, and it is the more abusable of the two: the demo is three fixed
 * vehicles a visitor can chat to, while the front door accepts an uploaded
 * photograph from anyone.
 *
 * So this keys on `surface = 'anonymous'`, which is exactly what
 * `20260802200000` added the column for.
 *
 * ── D8: this is the primary control, and the ordering is the decision ───────
 *
 * Erratum **T1** corrected the original 2.97a wording, which named IP-bucketed
 * rate limiting as primary. `cc-tech-0003` (**high** confidence) forbids that
 * reasoning: a bucket keyed on a value the caller supplies is decorative, and
 * `X-Forwarded-For` is caller-supplied. A spend ceiling is not — it counts
 * money that has actually been spent, which no header can lie about.
 *
 *   1. **primary**   this ceiling, plus the kill switch
 *   2. *secondary*   per-IP bucketing on the platform-provided client IP
 *   3. always        no dossier generation on this path, ever (D6)
 *
 * David chose no captcha (D8, 3 Aug), on the grounds that a captcha is a
 * conversion tax on the exact surface 2.97d exists to measure.
 *
 * ── Daily only, and that is deliberate ──────────────────────────────────────
 *
 * The demo carries a monthly ceiling as well, because one bad afternoon should
 * not silence it for three weeks. **The front door takes the opposite lesson.**
 * A monthly cap here would mean an attack on the 3rd closes the acquisition
 * surface until the 1st — turning a cost incident into a month with no top of
 * funnel. A daily ceiling bounds the worst case to one day and bounds the month
 * to roughly thirty times it, which is the bill David actually signed up for.
 *
 * ── The arithmetic, and what is honestly not known ──────────────────────────
 *
 * $15/day, at roughly $7.50 per million output-equivalent tokens on Flash:
 *
 *   $15 / $7.50 per M  ≈  2,000,000 output-equivalent tokens per day
 *
 * Expressed in tokens rather than dollars for the same reason `TIERS` is: a
 * token ceiling protects the bill without pretending to know a price.
 *
 * **What is not known is the per-scan cost.** A consultant turn was measured on
 * 2 Aug at ~600 output-equivalent tokens, but the front door adds vision over a
 * full-resolution phone photograph and no such call has ever been made here.
 * Dividing the ceiling by a guessed per-scan figure would be exactly the
 * unearned number `cc-product-0003` exists to stop. **2.97d's meter is what
 * produces the real figure**, and the first week of it should be used to
 * re-set this constant rather than to confirm it.
 */
export const FRONT_DOOR_BUDGET = {
  dailyOutputTokens: 2_000_000,
} as const;

/**
 * Environment variable that closes the door by hand.
 *
 * The manual half of the kill switch. Read at request time rather than at
 * build time so flipping it takes effect without a deploy — a switch that
 * needs a build is not a switch, and the incident it exists for is one where
 * money is leaving every second.
 */
export const FRONT_DOOR_DISABLED_ENV = 'FRONT_DOOR_DISABLED';

export type FrontDoorState = 'ok' | 'approaching' | 'exhausted' | 'disabled';

export interface FrontDoorDecision {
  allowed: boolean;
  state: FrontDoorState;
  usedToday: number;
  limitToday: number;
  /** Never above 1 — 20% over is 100%, not 120%. */
  fractionUsed: number;
  /**
   * Whether this decision is worth waking someone for.
   *
   * True when the ceiling is actually hit, and *not* at the warn threshold:
   * `approaching` is a normal busy day on a surface whose whole purpose is to
   * attract strangers. Paging on 80% would train whoever carries it to ignore
   * the page, which is worse than not having one.
   *
   * **Who receives it is still undecided** — it was the third part of D8 and
   * only the captcha and ceiling halves were answered. Today this drives a
   * logger call at error level and nothing else.
   */
  shouldAlert: boolean;
}

/**
 * Decide whether the anonymous front door may make another model call.
 *
 * Pure, and separate from the query that feeds it, for the reason `decideBudget`
 * gives: the boundary conditions are where this goes quietly wrong, and none of
 * them throw.
 *
 * The manual switch is checked first and unconditionally. It is the control
 * someone reaches for while watching a bill climb, and anything that could
 * override it — including a misread of usage — makes it untrustworthy at the
 * only moment it matters.
 */
export function decideFrontDoor({
  usedToday,
  manuallyDisabled,
  budget = FRONT_DOOR_BUDGET,
}: {
  usedToday: number;
  manuallyDisabled: boolean;
  budget?: { dailyOutputTokens: number };
}): FrontDoorDecision {
  const used = Math.max(0, Math.round(usedToday || 0));

  if (manuallyDisabled) {
    return {
      allowed: false,
      state: 'disabled',
      usedToday: used,
      limitToday: budget.dailyOutputTokens,
      fractionUsed: 0,
      // Someone turned this off on purpose. Paging them about it is noise.
      shouldAlert: false,
    };
  }

  /*
    A non-positive ceiling means "not configured", never "spend nothing" — the
    same rule as `decideBudget` and `decideDemoBudget`.

    It is worth being explicit that this failure direction is *open* on an
    unauthenticated endpoint, which is the uncomfortable case. It is still
    right: a config typo that silently closes the acquisition surface would be
    found in weeks, by wondering why the funnel is empty, whereas a typo that
    leaves it open is bounded by the per-IP bucket underneath and visible in
    the meter the next morning.
  */
  const limit = budget.dailyOutputTokens > 0 ? budget.dailyOutputTokens : Infinity;

  if (!Number.isFinite(limit)) {
    return {
      allowed: true,
      state: 'ok',
      usedToday: used,
      limitToday: 0,
      fractionUsed: 0,
      shouldAlert: false,
    };
  }

  const fractionUsed = Math.min(1, used / limit);

  // `>=` at the boundary: spent exactly the ceiling means spent it.
  if (used >= limit) {
    return {
      allowed: false,
      state: 'exhausted',
      usedToday: used,
      limitToday: limit,
      fractionUsed,
      shouldAlert: true,
    };
  }

  return {
    allowed: true,
    state: used >= limit * WARN_AT ? 'approaching' : 'ok',
    usedToday: used,
    limitToday: limit,
    fractionUsed,
    shouldAlert: false,
  };
}

/**
 * What a visitor is told when the door is shut.
 *
 * Never mentions a budget, a limit or a cost. A stranger who came to find out
 * whether their repair quote was fair does not care why, and "we have hit our
 * daily spending cap" invites both "so you are broke" and someone testing how
 * fast they can hit it tomorrow. It says the honest user-facing thing —
 * temporarily unavailable, try later — and points at the account path, which
 * is real and is not rate-limited by this ceiling.
 */
export function frontDoorClosedMessage(): string {
  return 'Quote checks are temporarily unavailable — please try again later. If you have an account, your advisor is still available as usual.';
}

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
