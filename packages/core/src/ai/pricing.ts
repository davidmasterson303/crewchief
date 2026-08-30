/**
 * What a subscription earns, what a customer can cost, and the rule that keeps
 * the second below the first.
 *
 * ── The requirement, in David's words ───────────────────────────────────────
 *
 * *"Some combo of pricing and LLM call budget that will prevent me from losing
 * money on any users. I want the price low, though — designing a model where
 * worst case customer usage is breakeven is ok with me."*
 *
 * That is a stronger constraint than it sounds, and it decides the shape of
 * this file. **Breakeven at the ceiling** means the ceiling cannot be chosen
 * for how generous it feels — it is whatever number makes the worst possible
 * month cost exactly what the worst-paying plan earns. So the ceiling is
 * derived here rather than tuned, and the price is the input.
 *
 * `ai/budget.ts` had it the other way around: a ceiling picked by hand, with an
 * argument beside it about the price it was picked against. That argument was
 * correct on 21 Aug and silently expires the day a price changes — which is
 * exactly what a placeholder price is for.
 *
 * ── The four inputs, and which of them are decisions ────────────────────────
 *
 *   price            David's. Placeholders today — see `PRICING`.
 *   Apple's cut      15% under the Small Business Program.
 *   the token rate   Google's. Worst case, not typical — see below.
 *   free allowance   ⚠ David's, and the one nobody has made yet.
 *
 * Everything else in this file is arithmetic on those four.
 *
 * ── ⚠ The annual plan is the binding constraint, not the monthly one ────────
 *
 * A ceiling is enforced per calendar month, so the plan that matters is the one
 * earning the least **per month**. An annual subscription at ten months' price
 * earns less monthly than the monthly plan does, and an account on it can spend
 * exactly as much. Deriving from the monthly price would leave every annual
 * subscriber able to cost more than they pay — the failure this file exists to
 * make impossible, arriving through the plan that looks like the safer one.
 *
 * So the floor is the **minimum** net across every plan sold.
 *
 * ── ⚠ Worst case is priced at the Pro rate, not the Flash rate ──────────────
 *
 * The advisor and invoice extraction run on Flash; the dossier runs on
 * `PRO_MODEL`, which bills output at roughly $10/M against Flash's $7.50/M.
 * `decideBudget` counts output-equivalent tokens without recording which model
 * produced them, so a ceiling priced at the Flash rate is only true if no
 * meaningful share of a month's tokens is Pro. That is *usually* true — a
 * dossier is generated once per vehicle and cached, and can't be looped — but
 * "usually true" is not what breakeven-guaranteed means.
 *
 * Pricing every token at the most expensive rate any metered path can reach is
 * the only version of this that is a guarantee rather than an expectation. It
 * costs ~25% of the ceiling and buys the word "cannot".
 *
 * ── What this does NOT protect against ──────────────────────────────────────
 *
 * Input tokens. `decideBudget` measures output only, and `budget.ts` argues
 * that case: output bills at ~12× input on Flash, so input is single-digit
 * percent of a call's cost. Measured on the dossier — 1,054 in against 3,847
 * output-equivalent — input was under 2% of the bill. It is inside the margin
 * the Pro-rate rounding above already buys, and it is stated here rather than
 * left for somebody to discover.
 *
 * ⚠ **Vision is the honest gap.** An invoice photograph bills as input, and no
 * per-scan cost has ever been measured here — `budget.ts` says so about the
 * front door too. A very large image on a very cheap plan is the one path where
 * the guarantee is an argument rather than arithmetic. Measure a scan and this
 * comment either goes away or becomes a number.
 */

/**
 * Apple's commission under the Small Business Program.
 *
 * 15% while annual proceeds are under $1M, which is the situation for as long
 * as anybody reading this will care. It is 30% outside the programme — if that
 * ever applies, this constant is the only thing that changes and every ceiling
 * below follows it down.
 */
export const APPLE_COMMISSION = 0.15;

/**
 * The prices, and ⚠ they are placeholders.
 *
 * Design's rebrand package carries $4.99 / $39.99 and says so. Nothing here
 * depends on them being right — that is the point of deriving the ceiling — but
 * the numbers a ceiling is computed from should be the numbers actually
 * charged, so this is the constant to change on the day they are set in App
 * Store Connect.
 *
 * ⚠ The app never renders either figure. `PaywallScreen` prints StoreKit's own
 * `displayPrice`, localised, so these exist for arithmetic and not for copy.
 * They cannot drift into what a customer is shown, and a mismatch between here
 * and App Store Connect is invisible to the customer and fatal to the
 * guarantee — which is the argument for checking them together.
 */
export const PRICING = {
  monthlyUsd: 4.99,
  /**
   * ⚠ At $39.99 the annual plan is 8.0 months of the monthly price, and it is
   * the plan that sets every ceiling below. A conventional 10-month annual
   * ($49.90) would raise the ceiling by 25% at the same monthly price.
   */
  annualUsd: 39.99,
} as const;

/**
 * Output-equivalent token rates, US dollars per token.
 *
 * `PRO` is the ceiling's rate for the reason in the header. `FLASH` is here to
 * make the difference visible rather than buried in a comment, and because the
 * "what would this cost typically" arithmetic wants it.
 */
export const OUTPUT_USD_PER_TOKEN = {
  pro: 10 / 1_000_000,
  flash: 7.5 / 1_000_000,
} as const;

/** Net dollars per month from a monthly subscriber, after Apple. */
export function netMonthlyUsd(): number {
  return PRICING.monthlyUsd * (1 - APPLE_COMMISSION);
}

/** Net dollars per month from an annual subscriber, after Apple, spread evenly. */
export function netAnnualPerMonthUsd(): number {
  return (PRICING.annualUsd * (1 - APPLE_COMMISSION)) / 12;
}

/**
 * The least a paying account can earn in a month, whichever plan they chose.
 *
 * This is the number the paid ceiling is derived from. See the header: a
 * ceiling is monthly, so the worst-paying month is what has to cover the
 * worst-spending month.
 */
export function netMonthlyFloorUsd(): number {
  return Math.min(netMonthlyUsd(), netAnnualPerMonthUsd());
}

/**
 * The paid tier's monthly ceiling, in output-equivalent tokens.
 *
 * Breakeven by construction: spending every token of it at the most expensive
 * rate any metered path can reach costs exactly what the cheapest plan earns.
 * A customer who exhausts it has cost their whole subscription and not a cent
 * more.
 *
 * ⚠ **It is a fuse, and a fuse that fires is still a bad month for somebody.**
 * Breakeven is the floor of acceptable, not the target: an account that hits
 * this has paid for a product that then stopped answering. The number to watch
 * is not whether this is safe — it is safe by arithmetic — but how far above
 * real use it sits. `budget.ts` records the two measurements that matter: a
 * consultant turn is ~600 output-equivalent tokens, and the heaviest month any
 * real account has ever produced was the developer's own, building daily, at
 * about $3.10.
 */
export function paidMonthlyOutputTokens(): number {
  return Math.floor(netMonthlyFloorUsd() / OUTPUT_USD_PER_TOKEN.pro);
}

/**
 * ⚠ What a free account is allowed to cost — a decision nobody has made, and
 * one that cannot be applied yet even when they do.
 *
 * **A free account earns nothing, so no ceiling makes it breakeven.** The
 * question is not arithmetic, it is what a signup is worth, and that is David's
 * number. `FREE_MONTHLY_COST_USD` is a placeholder sized against the free
 * tier's own legitimate model use, not a considered figure.
 *
 * ── Why a free account can cost anything at all ─────────────────────────────
 *
 * `paid-features.ts` says the three paid features "are exactly the three that
 * call a model". **That is not quite true, and here is where it shows.** Health
 * summary generation calls Gemini and sits outside `checkFeatureAccess` — by
 * design, because the health dial is the free product's whole face. So the free
 * tier has one legitimate path that costs us money, and its ceiling has to
 * cover that path without covering an abuse case.
 *
 * At the 400,000-token ceiling that exposure is about **$3.00 a month per free
 * account against zero revenue** — more than the net on an annual subscription.
 * That number was not chosen for this situation; it is inherited from when the
 * tiers differed by allowance rather than by feature.
 *
 * ── ⛔ Why the smaller number is not live ───────────────────────────────────
 *
 * `PAID_FEATURES_ENFORCED` is off. Until it flips, a free account can still
 * reach the advisor, invoice scanning and the dossier — so the free ceiling is
 * currently the *only* thing standing between a free account and every
 * expensive path in the product. Dropping it to the gated figure today would
 * not save money that is being lost; it would cut every existing account off
 * from the features they can still legitimately use.
 *
 * The two changes are one change, in this order: enforce the gate, then lower
 * this ceiling. `budget.ts` names the pairing at `TIERS`, and
 * `ai-pricing.test.ts` asserts it rather than trusting a comment.
 *
 * ⚠ A health summary has never been measured. The gated figure sizes it against
 * the nearest thing that has — a consultant turn at ~600 output-equivalent
 * tokens — and allows generously for a summary being longer and for several
 * cars. Measure one and this stops being an estimate.
 */
export const FREE_MONTHLY_COST_USD = 0.25;

/**
 * What the free ceiling becomes once the feature gate is enforced.
 *
 * Not what it is today. See the header above: this is the second half of a
 * two-part change whose first half is a product launch.
 */
export function freeMonthlyOutputTokensWhenGated(): number {
  return Math.floor(FREE_MONTHLY_COST_USD / OUTPUT_USD_PER_TOKEN.pro);
}

/**
 * How many times over the current paid ceiling exceeds what it earns.
 *
 * ⚠ 1.0 is the requirement. Above 1.0 is a maximum loss wearing a ceiling's
 * clothes; the figure today is about 3.5. `ai-pricing.test.ts` pins it so it
 * cannot widen unnoticed, and `budget.ts` names the three things that close it.
 *
 * Takes the ceiling as an argument rather than importing `TIERS`, because
 * `budget.ts` imports this file's *reasoning* in a docblock and importing back
 * would be a cycle for one number.
 */
export function ceilingOverRevenue(ceilingTokens: number): number {
  return worstCaseMonthlyCostUsd(ceilingTokens) / netMonthlyFloorUsd();
}

/**
 * What a month at a given ceiling actually costs us, in dollars.
 *
 * Exists so the invariant can be asserted as money rather than as tokens — a
 * test comparing two token counts derived from the same constant proves
 * nothing, and dollars is the form the guarantee is actually stated in.
 */
export function worstCaseMonthlyCostUsd(tokens: number): number {
  return tokens * OUTPUT_USD_PER_TOKEN.pro;
}
