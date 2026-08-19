/**
 * What the app may unlock, and what it tells the customer.
 *
 * @jest-environment node
 *
 * Phase 6, E8. The matrix test below is the point of this file: `grantsAccess`
 * must be true for exactly one combination of inputs, and asserting that by
 * enumeration rather than by example is what stops a later "small" addition
 * from quietly opening a second door.
 */

import {
  resolvePurchase,
  verifyOutcomeFromStatus,
  type StoreOutcome,
  type VerifyOutcome,
} from '@crewchief/core/purchase-flow';

const STORE_OUTCOMES: StoreOutcome[] = [
  { kind: 'purchased', jwsRepresentation: 'jws' },
  { kind: 'cancelled' },
  { kind: 'pending' },
  { kind: 'already-owned' },
  { kind: 'failed', message: 'Your payment method was declined.' },
  { kind: 'failed' },
  { kind: 'nothing-to-restore' },
];

const VERIFY_OUTCOMES: (VerifyOutcome | null)[] = [
  null,
  { kind: 'entitled', tier: 'paid' },
  { kind: 'recorded-not-entitled' },
  { kind: 'belongs-to-another-account' },
  { kind: 'retry-later' },
  { kind: 'rejected' },
  { kind: 'network' },
];

describe('the one door', () => {
  it('grants access for exactly one combination out of the whole matrix', () => {
    /*
      ⚠ The assertion this file exists for. A successful StoreKit purchase does
      not entitle anybody — only the server has checked Apple's signature, and
      the device is the party that benefits from lying about it.

      Enumerated rather than sampled: an example-based test would keep passing
      if a new outcome were added that also unlocked.
    */
    const granting: string[] = [];

    for (const store of STORE_OUTCOMES) {
      for (const verify of VERIFY_OUTCOMES) {
        if (resolvePurchase(store, verify).grantsAccess) {
          granting.push(`${store.kind} + ${verify ? verify.kind : 'no-verdict'}`);
        }
      }
    }

    expect(granting).toEqual(['purchased + entitled']);
  });

  it('can still detect a door being opened', () => {
    // Anti-vacuous: the enumeration above must be capable of finding one.
    expect(
      resolvePurchase({ kind: 'purchased', jwsRepresentation: 'j' }, { kind: 'entitled', tier: 'paid' })
        .grantsAccess
    ).toBe(true);
  });

  it('never grants access on a purchase whose verification never returned', () => {
    // Reachable when the verify call throws before producing an outcome.
    const result = resolvePurchase({ kind: 'purchased', jwsRepresentation: 'j' }, null);
    expect(result.grantsAccess).toBe(false);
    expect(result.offerRestore).toBe(true);
  });
});

describe('outcomes that are not failures', () => {
  it('says nothing at all when the customer cancels', () => {
    /*
      A dialog confirming that somebody did not buy something is the app
      arguing with them about a decision they just made.
    */
    const result = resolvePurchase({ kind: 'cancelled' }, null);
    expect(result.message).toBeNull();
    expect(result.status).toBe('declined');
  });

  it('treats Ask to Buy as waiting, and promises neither outcome', () => {
    const result = resolvePurchase({ kind: 'pending' }, null);

    expect(result.status).toBe('waiting');
    expect(result.message).toMatch(/needs approval/i);
    // It has not been approved and may never be. No claim either way.
    expect(result.message).not.toMatch(/\b(active|purchased|complete|success)\b/i);
    expect(result.message).toMatch(/do not need to buy it again/i);
  });

  it('sends an existing subscriber to restore rather than to buy again', () => {
    const result = resolvePurchase({ kind: 'already-owned' }, null);
    expect(result.offerRestore).toBe(true);
    expect(result.message).toMatch(/restore/i);
  });

  it('distinguishes an empty restore from a failed one', () => {
    const empty = resolvePurchase({ kind: 'nothing-to-restore' }, null);
    expect(empty.status).toBe('declined');
    expect(empty.message).toMatch(/no previous subscription/i);
    // Not an error, so it must not invite another restore loop.
    expect(empty.offerRestore).toBe(false);
  });
});

describe('never tell someone a completed payment failed', () => {
  it.each([
    ['retry-later', { kind: 'retry-later' } as VerifyOutcome],
    ['network', { kind: 'network' } as VerifyOutcome],
  ])('reassures rather than alarms when verification is delayed (%s)', (_n, verify) => {
    /*
      The money has left. Telling somebody it failed invites them to buy it
      twice, and the entitlement arrives anyway — on a retry, or on Apple's own
      notification, which is what the webhook is for.
    */
    const result = resolvePurchase({ kind: 'purchased', jwsRepresentation: 'j' }, verify);

    expect(result.status).toBe('waiting');
    expect(result.grantsAccess).toBe(false);
    expect(result.message).toMatch(/went through/i);
    expect(result.message).toMatch(/not be charged twice/i);
    expect(result.message).not.toMatch(/\bfailed\b/i);
  });

  it('uses StoreKit’s own message when it has one, because ours would be a guess', () => {
    const withMessage = resolvePurchase(
      { kind: 'failed', message: 'Your payment method was declined.' },
      null
    );
    expect(withMessage.message).toBe('Your payment method was declined.');

    const without = resolvePurchase({ kind: 'failed' }, null);
    expect(without.message).toMatch(/could not be completed/i);
    // A failure means no charge, and saying so prevents a duplicate purchase.
    expect(without.message).toMatch(/not been charged/i);
  });

  it('names the wrong-account case plainly rather than softening it', () => {
    const result = resolvePurchase(
      { kind: 'purchased', jwsRepresentation: 'j' },
      { kind: 'belongs-to-another-account' }
    );
    expect(result.message).toMatch(/different CrewChief account/i);
    expect(result.grantsAccess).toBe(false);
  });
});

describe('reading the route’s answer', () => {
  it('does not treat a bare 200 as entitlement', () => {
    /*
      The route answers 200 for an event it deliberately ignored — a stale
      notification, a duplicate. Reading the status alone would grant access on
      the strength of the server having replied at all.
    */
    expect(verifyOutcomeFromStatus(200, { entitlement: { tier: null, recorded: false } })).toEqual({
      kind: 'recorded-not-entitled',
    });
    expect(verifyOutcomeFromStatus(200, null)).toEqual({ kind: 'recorded-not-entitled' });
  });

  it('does not treat the free tier as a subscription', () => {
    expect(verifyOutcomeFromStatus(200, { entitlement: { tier: 'free', recorded: true } })).toEqual({
      kind: 'recorded-not-entitled',
    });
  });

  it('reads a paid tier as entitlement', () => {
    expect(verifyOutcomeFromStatus(200, { entitlement: { tier: 'paid', recorded: true } })).toEqual({
      kind: 'entitled',
      tier: 'paid',
    });
  });

  it.each([
    [409, 'belongs-to-another-account'],
    [503, 'retry-later'],
    [400, 'rejected'],
    [401, 'rejected'],
    [500, 'network'],
    [502, 'network'],
  ])('maps %s to %s, matching the route contract', (status, kind) => {
    expect(verifyOutcomeFromStatus(status as number).kind).toBe(kind);
  });
});
