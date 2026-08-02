/**
 * The monthly AI budget — the decision, not the query.
 *
 * @jest-environment node
 *
 * Phase 5.1. Before it, the only control on AI spend was ten calls per minute
 * per vehicle, which is a ceiling of roughly 432,000 calls a month and
 * therefore not a ceiling. The eval puts a daily-use enthusiast at
 * $10.63–$13.57/month against $9.40 net at $9.99 — the tail is the whole
 * margin, not a rounding error.
 *
 * What is tested here is every decision around the query, because a budget is
 * the kind of code whose bugs are silent in both directions: too loose and it
 * protects nothing while appearing to work, too tight and it takes a paid
 * feature offline for someone who has done nothing wrong.
 */

import {
  decideBudget,
  monthStart,
  budgetMessage,
  resolveTier,
  TIERS,
  WARN_AT,
} from '@crewchief/core/ai/budget';

const tier = TIERS.free;
const LIMIT = tier.monthlyOutputTokens;

const usage = (outputTokens: number) => ({ inputTokens: 0, outputTokens });

describe('decideBudget', () => {
  it('allows an ordinary month', () => {
    const d = decideBudget(usage(50_000), tier);

    expect(d.state).toBe('ok');
    expect(d.allowed).toBe(true);
    expect(d.remainingOutputTokens).toBe(LIMIT - 50_000);
  });

  it('warns before it blocks, not as it blocks', () => {
    /*
      A limit that gives no notice is indistinguishable from a fault. The
      warning has to arrive while the user can still act on it.
    */
    const d = decideBudget(usage(Math.ceil(LIMIT * WARN_AT)), tier);

    expect(d.state).toBe('approaching');
    expect(d.allowed).toBe(true);
  });

  it('still allows the call at 99% of budget', () => {
    const d = decideBudget(usage(LIMIT - 1), tier);

    expect(d.state).toBe('approaching');
    expect(d.allowed).toBe(true);
  });

  it('blocks exactly at the limit, not one token past it', () => {
    // A user who has spent their allowance has spent it. `>` rather than `>=`
    // here would give away one extra call, which is harmless — but it is the
    // kind of boundary that gets copied into the billing code later.
    const d = decideBudget(usage(LIMIT), tier);

    expect(d.state).toBe('exceeded');
    expect(d.allowed).toBe(false);
    expect(d.remainingOutputTokens).toBe(0);
  });

  it('reports a user over budget as at 100%, never more', () => {
    // `fractionUsed` drives a progress meter. 140% would render as an
    // overflowing bar, which reads as a rendering bug rather than a limit.
    const d = decideBudget(usage(LIMIT * 1.4), tier);

    expect(d.fractionUsed).toBe(1);
    expect(d.remainingOutputTokens).toBe(0);
    expect(d.allowed).toBe(false);
  });

  it('treats a missing or nonsense reading as zero rather than as infinite spend', () => {
    // The reader returns 0 on every failure path. A NaN reaching this
    // function must not resolve to "exceeded" and lock the account out.
    for (const bad of [NaN, undefined as unknown as number, -500]) {
      const d = decideBudget(usage(bad), tier);
      expect(d.usedOutputTokens).toBe(0);
      expect(d.allowed).toBe(true);
    }
  });

  it('treats an unconfigured limit as no ceiling, not as a zero ceiling', () => {
    /*
      The failure this prevents is a config typo becoming a total outage. A
      tier with `monthlyOutputTokens: 0` read literally would block every AI
      call for everyone on it, instantly and silently.
    */
    const d = decideBudget(usage(999_999), { name: 'free', monthlyOutputTokens: 0 });

    expect(d.allowed).toBe(true);
    expect(d.state).toBe('ok');
  });

  it('counts against the tier it is given', () => {
    const overFree = usage(TIERS.free.monthlyOutputTokens + 1);

    expect(decideBudget(overFree, TIERS.free).allowed).toBe(false);
    expect(decideBudget(overFree, TIERS.paid).allowed).toBe(true);
  });
});

describe('the tiers themselves', () => {
  it('gives paid more room than free', () => {
    // If these ever invert or collapse, the tiering has stopped meaning
    // anything — the same assertion `model-tiering.test.ts` makes about models.
    expect(TIERS.paid.monthlyOutputTokens).toBeGreaterThan(TIERS.free.monthlyOutputTokens);
  });

  it('leaves an ordinary month well clear of the free ceiling', () => {
    /*
      The eval's median archetype is around 200k output-equivalent tokens a
      month. A fuse that a normal user trips is not a fuse, it is a bug, and
      this is the number that decides which one it is.
    */
    expect(TIERS.free.monthlyOutputTokens).toBeGreaterThanOrEqual(2 * 200_000);
  });

  it('resolves everyone to free until there is something to sell', () => {
    // Honest placeholder. When 5.2 gives a profile a subscription this stops
    // being a constant, and this assertion is what will fail to say so.
    expect(resolveTier(null).name).toBe('free');
    expect(resolveTier('any-user-id').name).toBe('free');
  });
});

describe('monthStart', () => {
  it('is the first instant of the month in UTC', () => {
    expect(monthStart(new Date('2026-08-02T21:30:00Z')).toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });

  it('does not move with the caller local timezone', () => {
    /*
      A month boundary that followed local time would hand someone in UTC+13
      several extra hours of budget, twice a year, and would disagree with the
      `created_at` values it is compared against — which Postgres wrote in UTC.
    */
    const lateOnTheFirstUtc = new Date('2026-08-01T23:59:59Z');
    const earlyOnTheFirstUtc = new Date('2026-08-01T00:00:01Z');

    expect(monthStart(lateOnTheFirstUtc).toISOString()).toBe(monthStart(earlyOnTheFirstUtc).toISOString());
  });

  it('rolls over at the boundary rather than near it', () => {
    expect(monthStart(new Date('2026-07-31T23:59:59Z')).toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(monthStart(new Date('2026-08-01T00:00:00Z')).toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });
});

describe('budgetMessage', () => {
  it('says when the allowance comes back', () => {
    const d = decideBudget(usage(LIMIT), tier);

    expect(budgetMessage(d, new Date('2026-08-15T12:00:00Z'))).toContain('September 1');
  });

  it('rolls the reset date into the next year in December', () => {
    const d = decideBudget(usage(LIMIT), tier);

    expect(budgetMessage(d, new Date('2026-12-20T12:00:00Z'))).toContain('January 1');
  });

  it('does not offer an upgrade that does not exist yet', () => {
    /*
      D2 (price) and D3 (free tier) are both undecided and the advisor KB is
      silent on them — checked on 2 Aug, not assumed. An upgrade prompt leading
      nowhere is worse than a plain limit, and this assertion is what stops one
      being added before there is something behind it.
    */
    const message = budgetMessage(decideBudget(usage(LIMIT), tier));

    expect(message.toLowerCase()).not.toMatch(/upgrade|subscribe|plan|pricing/);
  });
});
