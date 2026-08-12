/**
 * Whether an account is entitled to what it is asking for.
 *
 * @jest-environment node
 *
 * Phase 6, E7. Every ambiguous input here resolves to `free`, and that is the
 * opposite default from `decideBudget` in the same subsystem — which reads a
 * misconfigured limit as "no ceiling" and lets the call through.
 *
 * The two disagree on purpose. `decideBudget` protects a **bill**, so failing
 * open costs money and failing closed costs an outage. This protects
 * **revenue**, so failing open gives the product away — silently, to exactly
 * the malformed rows an attacker would aim for — while failing closed puts a
 * paying customer on a generous ceiling they can complain about.
 *
 * Most of the tests below are that asymmetry, one input at a time.
 */

import { resolveEntitledTier, hasLiveEntitlement } from '@crewchief/core/entitlement';
import { TIERS } from '@crewchief/core/ai/budget';

const NOW = new Date('2026-08-12T12:00:00Z');
const FUTURE = '2026-09-12T12:00:00Z';
const PAST = '2026-07-12T12:00:00Z';

describe('resolveEntitledTier', () => {
  it('grants paid while the period is still running', () => {
    expect(resolveEntitledTier({ tier: 'paid', expiresAt: FUTURE }, NOW).name).toBe('paid');
  });

  it('drops to free the moment the period ends', () => {
    /*
      The load-bearing one. Apple tells us about a lapse asynchronously through
      a server notification, so between a failed renewal and that notification
      arriving, the stored row still says `paid` with a date in the past. If
      this comparison were not made on every read, a lapsed subscriber would
      keep the paid ceiling until a webhook we do not control turned up.
    */
    expect(resolveEntitledTier({ tier: 'paid', expiresAt: PAST }, NOW).name).toBe('free');
  });

  it('treats the exact expiry instant as over', () => {
    // `>` rather than `>=`: an entitlement that expires at noon is not live at
    // noon. The same boundary convention as `decideBudget`'s `used >= limit`.
    expect(resolveEntitledTier({ tier: 'paid', expiresAt: NOW.toISOString() }, NOW).name).toBe(
      'free'
    );
  });

  it('honours an entitlement with no expiry', () => {
    /*
      A comped account or a support gesture. Null must not be read as expired,
      and it is distinguishable from a lapse because a lapse writes a date in
      the past — never a null.
    */
    expect(resolveEntitledTier({ tier: 'paid', expiresAt: null }, NOW).name).toBe('paid');
  });

  it('reads a missing record as free', () => {
    // The ordinary case: an account only gets a row when it buys something.
    expect(resolveEntitledTier(null, NOW).name).toBe('free');
    expect(resolveEntitledTier(undefined, NOW).name).toBe('free');
  });

  it('refuses to grant paid on an unparseable expiry', () => {
    /*
      The cheapest subscription in the product, if this were wrong. A malformed
      date is the one input here that someone could hope to influence, and
      reading it as "probably fine" would make a corrupt row a free upgrade.
    */
    expect(resolveEntitledTier({ tier: 'paid', expiresAt: 'whenever' }, NOW).name).toBe('free');
    expect(resolveEntitledTier({ tier: 'paid', expiresAt: '' }, NOW).name).toBe('free');
  });

  it('refuses a tier it does not recognise', () => {
    /*
      The CHECK constraint on the table should make these impossible. This is
      the belt to that: a future migration that widens the CHECK without
      widening `TIERS` would otherwise resolve an unknown string through
      `TIERS[tier]` and hand back undefined, which reads as neither tier and
      would crash at the call site rather than deny politely.
    */
    expect(resolveEntitledTier({ tier: 'enterprise', expiresAt: FUTURE }, NOW).name).toBe('free');
    expect(resolveEntitledTier({ tier: 'PAID', expiresAt: FUTURE }, NOW).name).toBe('free');
    expect(resolveEntitledTier({ tier: null, expiresAt: FUTURE }, NOW).name).toBe('free');
  });

  it('does not let a prototype-shaped tier name reach TIERS', () => {
    /*
      `TIERS` is a plain object literal, so `TIERS['constructor']` is a truthy
      function and `TIERS['toString']` is truthy too. A membership test written
      as `if (TIERS[tier])` would accept both and return something that is not
      a Tier at all. The guard uses `hasOwnProperty` for exactly this.
    */
    expect(resolveEntitledTier({ tier: 'constructor', expiresAt: FUTURE }, NOW).name).toBe('free');
    expect(resolveEntitledTier({ tier: 'toString', expiresAt: null }, NOW).name).toBe('free');
    expect(resolveEntitledTier({ tier: '__proto__', expiresAt: FUTURE }, NOW).name).toBe('free');
  });

  it('never returns a tier object the budget cannot use', () => {
    /*
      Whatever the input, the result has to be a real `Tier` with a usable
      ceiling — `decideBudget` reads `monthlyOutputTokens` off it immediately
      and a NaN there produces a decision with a NaN fraction, which is neither
      allowed nor denied in any legible way.
    */
    const inputs = [
      null,
      { tier: 'paid', expiresAt: FUTURE },
      { tier: 'paid', expiresAt: PAST },
      { tier: 'nonsense', expiresAt: 'nonsense' },
      { tier: null, expiresAt: null },
    ];

    for (const input of inputs) {
      const tier = resolveEntitledTier(input, NOW);
      expect(Object.values(TIERS)).toContain(tier);
      expect(Number.isFinite(tier.monthlyOutputTokens)).toBe(true);
      expect(tier.monthlyOutputTokens).toBeGreaterThan(0);
    }
  });

  it('degrades a lapsed subscriber to a ceiling they can live with, not to zero', () => {
    /*
      Why failing closed is defensible rather than punitive, asserted rather
      than assumed. `free` is documented as a fuse — an ordinary month lands
      near 200k output-equivalent tokens — so the worst case for a paying
      customer whose row is corrupt is a quiet degradation, not a locked door.

      If someone ever sets the free ceiling near zero, this test is what says
      the entitlement design stopped being safe to fail closed into.
    */
    const lapsed = resolveEntitledTier({ tier: 'paid', expiresAt: PAST }, NOW);
    expect(lapsed.monthlyOutputTokens).toBeGreaterThanOrEqual(2 * 200_000);
  });
});

describe('hasLiveEntitlement', () => {
  /*
    A separate question from "what may they use today", and E5 is why: deleting
    an account while an Apple-billed subscription keeps charging is a documented
    App Store rejection reason. That needs "is there a live subscription",
    which a lapsed record must answer no to.
  */
  it('is true only while a paid period is running', () => {
    expect(hasLiveEntitlement({ tier: 'paid', expiresAt: FUTURE }, NOW)).toBe(true);
    expect(hasLiveEntitlement({ tier: 'paid', expiresAt: null }, NOW)).toBe(true);
  });

  it('is false for a lapsed, free, missing or malformed record', () => {
    expect(hasLiveEntitlement({ tier: 'paid', expiresAt: PAST }, NOW)).toBe(false);
    expect(hasLiveEntitlement({ tier: 'free', expiresAt: FUTURE }, NOW)).toBe(false);
    expect(hasLiveEntitlement(null, NOW)).toBe(false);
    expect(hasLiveEntitlement({ tier: 'paid', expiresAt: 'nonsense' }, NOW)).toBe(false);
  });
});
