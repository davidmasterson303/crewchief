/**
 * What a subscription buys is three named features, and the gate cannot be on
 * before there is something to buy.
 *
 * @jest-environment node
 *
 * ── The pricing decision of 24 Aug ──────────────────────────────────────────
 *
 * The paid tier used to be a larger token allowance and the paywall sold that
 * difference in words. Three things were wrong with it and they compounded: the
 * unit was one the customer had never seen, the multiple stated was wrong
 * (IAP-06 — "five times" against a real 2.5×), and both tiers could reach every
 * expensive path so price and cost were unconnected.
 *
 * ── ⚠ What this suite is really guarding ────────────────────────────────────
 *
 * Not the arithmetic — there is none left. It guards two things that would be
 * expensive to get wrong and silent when they were:
 *
 *   1. **The gate defaults to off.** Enforcing before E8 lands takes three
 *      features from every existing account with no way to buy them back.
 *   2. **The paywall's promise and the server's gate are one list.** A
 *      hand-written list on a paywall is a second source of truth for what
 *      somebody just paid for, and the copy is the half the customer read.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  FREE_FEATURES,
  FREE_FEATURE_COPY,
  PAID_FEATURES,
  PAID_FEATURE_COPY,
  decideFeatureAccess,
  isPaidFeature,
  type PaidFeature,
} from '@wellkept/core/paid-features';
import { entitlesFeature } from '@wellkept/core/entitlement';

const ROOT = join(__dirname, '..', '..');
const PAYWALL = readFileSync(
  join(ROOT, 'apps', 'mobile', 'src', 'screens', 'PaywallScreen.tsx'),
  'utf8'
);
const GATE = readFileSync(join(ROOT, 'lib', 'feature-gate.ts'), 'utf8');
const ENV_EXAMPLE = readFileSync(join(ROOT, '.env.example'), 'utf8');

/**
 * Source with every comment removed, so an assertion cannot be satisfied by
 * prose that merely *discusses* the thing it is checking for.
 *
 * ⚠ Whole `/* … *\/` regions, not lines that begin with a comment marker. A
 * line-prefix filter looks right and fails on exactly the comments in this
 * codebase: a JSX `{/* … *\/}` block's middle lines start with ordinary words,
 * so the filter kept them — and these files all explain the finding they close
 * directly above the line that closes it. That is the `.tap-target-44` trap
 * from rule 5, which found a string in a comment 600 lines from the rule.
 *
 * Over-removal is the safe direction here: it can only make an assertion harder
 * to satisfy, never easier.
 */
function rendered(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const LIVE = { tier: 'paid', expiresAt: '2099-01-01T00:00:00.000Z' };
const LAPSED = { tier: 'paid', expiresAt: '2020-01-01T00:00:00.000Z' };

describe('what is sold', () => {
  it('is the advisor, invoice scanning, the dossier and recalls', () => {
    expect([...PAID_FEATURES]).toEqual(['advisor', 'invoice-scanning', 'dossier', 'recalls']);
  });

  it('leaves the owner’s own records readable', () => {
    /*
      ⚠ This list is no longer "the free tier" — there is not one as of 30 Aug.
      It is what a **lapsed** account keeps, and the argument is unchanged: a
      garage that stops working when a subscription ends is a hostage, and the
      records in it are the owner's own. Everything on it is stored rather than
      generated, so showing it costs nothing.
    */
    expect([...FREE_FEATURES]).toEqual(['garage', 'service-log', 'mileage']);
  });

  it('puts recalls behind the paywall — David’s call, 30 Aug', () => {
    /*
      ⚠ This assertion is the reverse of what it said this morning, and the
      reversal is deliberate rather than a drift.

      It read "never puts a safety recall behind the paywall", and the argument
      was strong: a federal defect notice an owner cannot see because their card
      expired. Design's rebrand package gated recalls, then reversed and
      endorsed that argument. **David overruled both**, and it is his call.

      Kept as an explicit assertion rather than deleted, because the next person
      to read this file will have the same instinct the old test encoded — and
      an unasserted list is one somebody "fixes" back on a quiet afternoon.

      What it costs is written at `FREE_FEATURE_COPY` in the module: a lapsed
      owner stops receiving new recall notifications for a car they still own,
      and keeps every recall already stored against it.
    */
    expect(isPaidFeature('recalls')).toBe(true);
    expect(FREE_FEATURES).not.toContain('recalls');
  });

  it('gives every feature copy a customer can act on', () => {
    for (const feature of PAID_FEATURES) {
      const copy = PAID_FEATURE_COPY[feature];
      expect([feature, copy.label.length > 0, copy.blurb.length > 20]).toEqual([feature, true, true]);
    }
    for (const feature of FREE_FEATURES) {
      expect(FREE_FEATURE_COPY[feature].label.length).toBeGreaterThan(0);
    }
  });
});

describe('the gate is off until there is something to buy', () => {
  /*
    ── ⚠ The assertion this suite exists for ─────────────────────────────────

    E8 is unfinished: `PaywallScreen` is mounted by no navigator and no StoreKit
    library is installed. A gate enforced in that state is three features
    withdrawn with no purchase path — a worse product for everybody, on the
    surface App Review opens.
  */
  it('lets everything through when `enforced` is not set', () => {
    for (const feature of PAID_FEATURES) {
      expect(decideFeatureAccess({ feature, tier: 'free' }).state).toBe('not-enforced');
    }
  });

  it('distinguishes "not enforced" from "allowed"', () => {
    /*
      Both let the call through, and a caller that logs them identically cannot
      tell an entitled account from a gate that is switched off — which is
      exactly the fact somebody needs on the day the switch flips.
    */
    expect(decideFeatureAccess({ feature: 'advisor', tier: 'paid' }).state).toBe('not-enforced');
    expect(decideFeatureAccess({ feature: 'advisor', tier: 'paid', enforced: true }).state).toBe(
      'allowed'
    );
  });

  it('only the exact string "true" switches it on', () => {
    /*
      A gate that switches on for a typo is a gate that switches on by accident,
      and the accident here is a support inbox. Asserted against the source
      because the read is a private function.
    */
    expect(GATE).toMatch(/process\.env\.PAID_FEATURES_ENFORCED === 'true'/);
  });

  it('is documented as a launch rather than a config change', () => {
    expect(ENV_EXAMPLE).toMatch(/PAID_FEATURES_ENFORCED=/);
    expect(ENV_EXAMPLE).toMatch(/not a rollout flag|NOT a rollout flag/i);
  });
});

describe('once enforced, it fails toward refusal', () => {
  const on = { enforced: true, now: new Date('2026-08-24T00:00:00.000Z') };

  it('admits a live subscriber', () => {
    for (const feature of PAID_FEATURES) {
      expect([feature, entitlesFeature(LIVE, feature, on).state]).toEqual([feature, 'allowed']);
    }
  });

  it('refuses no record, a lapsed one and a malformed one alike', () => {
    /*
      ⚠ The same direction `resolveEntitledTier` fails in, and for the same
      reason: reading a broken row as paid gives the product away to precisely
      the case somebody would try to manufacture.
    */
    for (const record of [null, LAPSED, { tier: 'paid', expiresAt: 'not-a-date' }, { tier: 'wat', expiresAt: null }]) {
      const decision = entitlesFeature(record as never, 'advisor', on);
      expect(decision.state).toBe('needs-subscription');
    }
  });

  it('names the feature and never mentions an allowance', () => {
    /*
      The whole point of the change is that a customer can tell what they are
      buying. A refusal reading "you have reached your monthly allowance" would
      put the old model back in the one place they actually read.
    */
    const decision = entitlesFeature(null, 'invoice-scanning', on);
    if (decision.state !== 'needs-subscription') throw new Error('expected a refusal');

    expect(decision.message).toContain(PAID_FEATURE_COPY['invoice-scanning'].label);
    expect(decision.message).not.toMatch(/allowance|token|limit|times over/i);
    // And it says what they keep, so the refusal is not a threat.
    expect(decision.message).toMatch(/free/i);
  });
});

describe('the paywall and the gate are one list', () => {
  it('renders the features rather than writing them out', () => {
    expect(PAYWALL).toMatch(/PAID_FEATURE_COPY/);
    expect(PAYWALL).toMatch(/FREE_FEATURE_COPY/);
  });

  it('has no allowance copy left in it', () => {
    /*
      ── ⚠ IAP-06 · killed rather than corrected ─────────────────────────────

      The screen claimed the paid tier "raises that allowance five times over"
      against a real 2.5×. Deriving the figure fixed the arithmetic and left the
      unit unintelligible, so the sentence is deleted. `entitlementMultiple()`
      is gone with it — a derived figure nothing renders is the same defect in a
      smaller form.
    */
    const body = rendered(PAYWALL);

    expect(body).not.toMatch(/entitlementMultiple|times over|allowance/i);

    // Anti-vacuous: the stripper leaves real JSX alone.
    expect(body).toMatch(/PAID_FEATURE_COPY\[feature\]/);
  });

  it('no longer exports the multiple from budget', () => {
    const budget = readFileSync(
      join(ROOT, 'packages', 'core', 'src', 'ai', 'budget.ts'),
      'utf8'
    );
    expect(budget).not.toMatch(/export function entitlementMultiple/);
    // The ceilings themselves are untouched and still enforced.
    expect(budget).toMatch(/export const TIERS/);
  });
});

describe('every paid path is gated', () => {
  /*
    ⚠ The shape `every-generation-has-a-ceiling.test.ts` already uses, for the
    same reason: eleven of fourteen model call sites once bypassed the monthly
    ceiling because nothing named them all in one place. A gate wired at two of
    three entry points is a gate.
  */
  const SITES: Array<[string, string, PaidFeature]> = [
    ['advisor', join(ROOT, 'app', 'actions.ts'), 'advisor'],
    ['invoice scanning', join(ROOT, 'app', 'actions.ts'), 'invoice-scanning'],
    ['dossier (mod detail)', join(ROOT, 'app', 'actions.ts'), 'dossier'],
    ['dossier (research)', join(ROOT, 'lib', 'vehicle-research.ts'), 'dossier'],
  ];

  it.each(SITES)('%s calls the gate', (_name, file, feature) => {
    const source = readFileSync(file, 'utf8');
    expect(source).toMatch(new RegExp(`checkFeatureAccess\\([^)]*'${feature}'\\)`));
  });

  it('leaves the demo consultant ungated', () => {
    /*
      The demo reaches the consultant through its own budget and must keep doing
      so — a portfolio piece with its own ceiling, not an account. A paywall on
      it is a paywall on the page recruiters are sent to.
    */
    const actions = readFileSync(join(ROOT, 'app', 'actions.ts'), 'utf8');
    const demoBranch = actions.slice(
      actions.indexOf('const demo = await checkDemoBudget()'),
      actions.indexOf("checkFeatureAccess(access.userId, 'advisor')")
    );
    expect(demoBranch).not.toMatch(/checkFeatureAccess/);
  });
});
