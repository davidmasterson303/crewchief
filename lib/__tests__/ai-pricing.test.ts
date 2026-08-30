/**
 * The rule: **no customer can cost more than they pay.**
 *
 * @jest-environment node
 *
 * David, 30 Aug: *"some combo of pricing and LLM call budget that will prevent
 * me from losing money on any users… designing a model where worst case
 * customer usage is breakeven is ok with me."*
 *
 * ── ⛔ This suite currently pins a gap rather than a guarantee ───────────────
 *
 * The requirement is not met today, and that is the honest state of it. The
 * paid ceiling is 1,000,000 output-equivalent tokens, which costs about $10 at
 * the most expensive rate a metered path can reach, against $2.83 of net
 * revenue from the worst-paying plan. **3.5× the revenue it protects.**
 *
 * The derived ceiling — the one that makes the worst month cost exactly what
 * the worst plan earns — is about 283,000. It is not applied, and the blocker
 * is ordering rather than arithmetic: it is *below* the 400,000 free ceiling,
 * so applying it would make the paid tier smaller than the free one. That is
 * not a rounding problem, it is the tiers telling you the free allowance is
 * bigger than a subscription can pay for.
 *
 * So this file does two jobs. It asserts the model is arithmetically right —
 * which plan binds, what the ceiling would be, that the ordering works once the
 * gate is enforced — and it **pins the gap**, so the distance between what is
 * shipped and what was asked for cannot widen while nobody is looking.
 *
 * ⚠ The pinned numbers below are meant to be edited. When David sets a price,
 * enforces the gate, or the dossier's thinking level comes down, these fail —
 * and that failure is the point at which somebody reads the sentence above and
 * decides deliberately.
 */

import { TIERS } from '@wellkept/core/ai/budget';
import {
  APPLE_COMMISSION,
  OUTPUT_USD_PER_TOKEN,
  PRICING,
  ceilingOverRevenue,
  freeMonthlyOutputTokensWhenGated,
  netAnnualPerMonthUsd,
  netMonthlyFloorUsd,
  netMonthlyUsd,
  paidMonthlyOutputTokens,
  worstCaseMonthlyCostUsd,
} from '@wellkept/core/ai/pricing';

/** Two figures compared in dollars are compared to the cent, not the float. */
const cents = (usd: number) => Math.round(usd * 100);

describe('which plan sets the ceiling', () => {
  it('is the annual one, because a ceiling is monthly', () => {
    /*
      ⚠ The trap this exists for. An annual subscription looks like the safer
      plan — more money, paid up front — and earns *less per month* than the
      monthly one. A ceiling is enforced per calendar month, so an annual
      subscriber can spend a monthly subscriber's worth against an annual
      subscriber's revenue, every month, for a year.

      Deriving from the monthly price would leave that hole open under the plan
      nobody would think to check.
    */
    expect(netAnnualPerMonthUsd()).toBeLessThan(netMonthlyUsd());
    expect(cents(netMonthlyFloorUsd())).toBe(cents(netAnnualPerMonthUsd()));
  });

  it('takes Apple’s cut off the top', () => {
    expect(cents(netMonthlyUsd())).toBe(cents(PRICING.monthlyUsd * (1 - APPLE_COMMISSION)));

    // Anti-vacuous: the commission has to actually be doing something, or this
    // whole file is asserting that a price equals itself.
    expect(netMonthlyUsd()).toBeLessThan(PRICING.monthlyUsd);
  });
});

describe('the derived ceiling is breakeven by construction', () => {
  it('costs exactly what the worst-paying plan earns', () => {
    const spent = worstCaseMonthlyCostUsd(paidMonthlyOutputTokens());

    // Within a cent: the ceiling is floored to a whole token.
    expect(cents(spent)).toBe(cents(netMonthlyFloorUsd()));
    expect(spent).toBeLessThanOrEqual(netMonthlyFloorUsd());
  });

  it('is priced at the most expensive rate a metered path can reach', () => {
    /*
      `decideBudget` counts output-equivalent tokens and does not record which
      model produced them, so a ceiling priced at the Flash rate is only true
      while no meaningful share of a month is Pro. "Usually true" is not what
      breakeven-guaranteed means — the dossier runs on Pro.
    */
    expect(OUTPUT_USD_PER_TOKEN.pro).toBeGreaterThan(OUTPUT_USD_PER_TOKEN.flash);

    const atFlash = Math.floor(netMonthlyFloorUsd() / OUTPUT_USD_PER_TOKEN.flash);
    expect(paidMonthlyOutputTokens()).toBeLessThan(atFlash);
  });

  it('leaves room above the gated free tier, so the tiers do not invert', () => {
    /*
      The ordering that has to hold on the day both numbers are applied. It does
      — 25,000 against 283,000 — which is why the blocker below is the *current*
      free ceiling and not the derivation.
    */
    expect(freeMonthlyOutputTokensWhenGated()).toBeLessThan(paidMonthlyOutputTokens());
  });
});

describe('⛔ the gap between what is shipped and what was asked for', () => {
  it('the live paid ceiling is still above breakeven, and by how much', () => {
    /*
      Pinned, not bounded. A range would let this drift toward the wrong end
      without anybody noticing; an exact figure makes every movement a line
      somebody wrote on purpose.
    */
    expect(TIERS.paid.monthlyOutputTokens).toBe(1_000_000);
    expect(Math.round(ceilingOverRevenue(TIERS.paid.monthlyOutputTokens) * 10) / 10).toBe(3.5);
  });

  it('the live free ceiling is what blocks applying the derived one', () => {
    /*
      ⚠ This is the whole ordering problem in one assertion. The free ceiling is
      larger than the derived paid ceiling, so the paid tier cannot be lowered
      to breakeven without first lowering free — and free cannot be lowered
      until `PAID_FEATURES_ENFORCED` is on, because until then it is the only
      thing standing between a free account and every expensive path.

      Enforce the gate, then lower free, then lower paid. Any other order either
      inverts the tiers or takes features from accounts still entitled to them.
    */
    expect(TIERS.free.monthlyOutputTokens).toBeGreaterThan(paidMonthlyOutputTokens());
  });

  it('a free account can still cost real money against no revenue', () => {
    /*
      `paid-features.ts` says the three paid features "are exactly the three
      that call a model". Health summary generation also calls one and is
      deliberately not gated — the dial is the free product's face — so a free
      account has a legitimate paid-for-by-us path, and today's ceiling bounds
      it at about $3.00 a month. That is more than an annual subscriber nets.
    */
    expect(worstCaseMonthlyCostUsd(TIERS.free.monthlyOutputTokens)).toBeGreaterThan(
      netMonthlyFloorUsd()
    );
  });
});
