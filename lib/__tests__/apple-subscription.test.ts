/**
 * The Apple notification state machine.
 *
 * @jest-environment node
 *
 * Phase 6, E8. Every case here is an ordering or a state Apple can actually
 * produce, and most of them fail *silently* if the reasoning is wrong — a
 * resurrected subscription and a refunded-but-still-working account both look
 * exactly like a working account from the inside.
 */

import {
  applyAppleNotification,
  PRODUCT_TIERS,
  type AppleSubscriptionEvent,
  type StoredEntitlement,
} from '@crewchief/core/apple-subscription';
import { resolveEntitledTier } from '@crewchief/core/entitlement';

const MONTHLY = 'co.davidmasterson.crewchief.paid.monthly';

const at = (iso: string) => Date.parse(iso);

function event(over: Partial<AppleSubscriptionEvent> = {}): AppleSubscriptionEvent {
  return {
    notificationType: 'DID_RENEW',
    signedDate: at('2026-08-18T10:00:00Z'),
    originalTransactionId: '2000000000000001',
    productId: MONTHLY,
    transactionId: '2000000000000009',
    expiresDate: at('2026-09-18T10:00:00Z'),
    environment: 'Production',
    ...over,
  };
}

function stored(over: Partial<StoredEntitlement> = {}): StoredEntitlement {
  return {
    tier: 'paid',
    expiresAt: '2026-08-18T10:00:00.000Z',
    originalTransactionId: '2000000000000001',
    productId: MONTHLY,
    environment: 'Production',
    autoRenewStatus: true,
    revokedAt: null,
    latestTransactionId: '2000000000000008',
    lastSignedDate: '2026-08-18T09:00:00.000Z',
    ...over,
  };
}

/** Narrow to a write, failing loudly rather than returning undefined. */
function writeOf(decision: ReturnType<typeof applyAppleNotification>) {
  if (decision.action !== 'write') {
    throw new Error(`expected a write, got ignore:${decision.reason}`);
  }
  return decision.record;
}

describe('the product map is a closed list', () => {
  it('maps every configured product to a tier that exists', () => {
    /*
      Anti-vacuous: an empty map would make every "unknown product" assertion
      below pass while proving nothing about the real ids.
    */
    const ids = Object.keys(PRODUCT_TIERS);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((id) => id.startsWith('co.davidmasterson.crewchief.'))).toBe(true);
    expect(Object.values(PRODUCT_TIERS).every((t) => t === 'paid')).toBe(true);
  });

  it('carries no price', () => {
    // D2 is undecided, and Apple is the authority on price regardless.
    expect(JSON.stringify(PRODUCT_TIERS)).not.toMatch(/\d+\.\d{2}|\$|USD/);
  });
});

describe('out-of-order delivery, which Apple does not prevent', () => {
  it('ignores a renewal signed before the event already applied', () => {
    /*
      The one that costs money and says nothing. A DID_RENEW delayed by a
      retry, arriving after the EXPIRED that superseded it, would otherwise
      write a future expiry over a dead subscription.
    */
    const decision = applyAppleNotification(
      stored({ lastSignedDate: '2026-08-18T10:05:00.000Z' }),
      event({ signedDate: at('2026-08-18T10:00:00Z') })
    );

    expect(decision.action).toBe('ignore');
    expect(decision).toMatchObject({ reason: 'stale-event' });
  });

  it('ignores a replay of the exact same event', () => {
    // Apple retries on any non-2xx, so duplicate delivery is routine.
    const decision = applyAppleNotification(
      stored({ lastSignedDate: '2026-08-18T10:00:00.000Z' }),
      event({ signedDate: at('2026-08-18T10:00:00Z') })
    );

    expect(decision).toMatchObject({ action: 'ignore', reason: 'stale-event' });
  });

  it('applies an event strictly newer than the last one', () => {
    const record = writeOf(
      applyAppleNotification(
        stored({ lastSignedDate: '2026-08-18T09:00:00.000Z' }),
        event({ signedDate: at('2026-08-18T10:00:00Z') })
      )
    );

    expect(record.lastSignedDate).toBe('2026-08-18T10:00:00.000Z');
    expect(record.expiresAt).toBe('2026-09-18T10:00:00.000Z');
  });

  it('applies the first event for an account that has never had one', () => {
    const record = writeOf(applyAppleNotification(null, event({ notificationType: 'SUBSCRIBED' })));

    expect(record.tier).toBe('paid');
    expect(record.originalTransactionId).toBe('2000000000000001');
  });

  it('does not wedge on an unparseable stored date', () => {
    /*
      A corrupt `last_signed_date` treated as a barrier would freeze the
      subscription at whatever it last was, forever, with no error. Letting the
      next real event through repairs the row.
    */
    const record = writeOf(
      applyAppleNotification(stored({ lastSignedDate: 'not a date' }), event())
    );

    expect(record.lastSignedDate).toBe('2026-08-18T10:00:00.000Z');
  });

  it('does not advance the ordering clock for a notification it ignores', () => {
    /*
      The subtle one. If an unhandled type wrote `lastSignedDate`, a meaningful
      notification signed between it and the next write would be dropped as
      stale — a real lapse silently discarded.
    */
    const ignored = applyAppleNotification(
      stored({ lastSignedDate: '2026-08-18T09:00:00.000Z' }),
      event({ notificationType: 'CONSUMPTION_REQUEST', signedDate: at('2026-08-18T11:00:00Z') })
    );
    expect(ignored).toMatchObject({ action: 'ignore', reason: 'unhandled-notification-type' });

    // The real event, signed earlier than the ignored one, must still apply.
    const record = writeOf(
      applyAppleNotification(
        stored({ lastSignedDate: '2026-08-18T09:00:00.000Z' }),
        event({ notificationType: 'EXPIRED', signedDate: at('2026-08-18T10:00:00Z') })
      )
    );
    expect(record.lastSignedDate).toBe('2026-08-18T10:00:00.000Z');
  });
});

describe('refunds end access now, not at the end of the period', () => {
  it('revokes on REFUND even with weeks left on the expiry', () => {
    const record = writeOf(
      applyAppleNotification(
        stored(),
        event({
          notificationType: 'REFUND',
          revocationDate: at('2026-08-18T10:00:00Z'),
          expiresDate: at('2026-09-18T10:00:00Z'),
          signedDate: at('2026-08-18T10:00:00Z'),
        })
      )
    );

    expect(record.tier).toBe('free');
    expect(record.revokedAt).toBe('2026-08-18T10:00:00.000Z');
    // Collapsed, so the read path needs no special case for revocation.
    expect(record.expiresAt).toBe('2026-08-18T10:00:00.000Z');
  });

  it('falls back to the signing time when REVOKE carries no revocation date', () => {
    // Family-sharing revocations can arrive without one.
    const record = writeOf(
      applyAppleNotification(
        stored(),
        event({
          notificationType: 'REVOKE',
          revocationDate: null,
          signedDate: at('2026-08-18T12:00:00Z'),
        })
      )
    );

    expect(record.revokedAt).toBe('2026-08-18T12:00:00.000Z');
    expect(record.tier).toBe('free');
  });

  it('reads as free through resolveEntitledTier, which is the real proof', () => {
    /*
      The two modules have to agree. A revoked write that still resolved to
      `paid` would be a refunded customer with a working product, and neither
      module alone would show it.
    */
    const record = writeOf(
      applyAppleNotification(
        stored(),
        event({ notificationType: 'REFUND', revocationDate: at('2026-08-18T10:00:00Z') })
      )
    );

    const tier = resolveEntitledTier(
      { tier: record.tier, expiresAt: record.expiresAt },
      new Date('2026-08-18T10:00:01Z')
    );
    expect(tier.name).toBe('free');
  });

  it('clears a previous revocation when the customer subscribes again', () => {
    const record = writeOf(
      applyAppleNotification(
        stored({ revokedAt: '2026-08-01T00:00:00.000Z', tier: 'free' }),
        event({ notificationType: 'SUBSCRIBED', signedDate: at('2026-08-18T10:00:00Z') })
      )
    );

    expect(record.revokedAt).toBeNull();
    expect(record.tier).toBe('paid');
  });
});

describe('grace period keeps a good customer working while the card is retried', () => {
  it('extends access to the grace date when it is later than the expiry', () => {
    const record = writeOf(
      applyAppleNotification(
        stored(),
        event({
          notificationType: 'DID_FAIL_TO_RENEW',
          subtype: 'GRACE_PERIOD',
          expiresDate: at('2026-08-18T10:00:00Z'),
          gracePeriodExpiresDate: at('2026-08-25T10:00:00Z'),
        })
      )
    );

    expect(record.expiresAt).toBe('2026-08-25T10:00:00.000Z');
    expect(resolveEntitledTier(record, new Date('2026-08-20T00:00:00Z')).name).toBe('paid');
  });

  it('does not shorten access when the grace date is earlier', () => {
    const record = writeOf(
      applyAppleNotification(
        stored(),
        event({
          expiresDate: at('2026-09-18T10:00:00Z'),
          gracePeriodExpiresDate: at('2026-08-19T10:00:00Z'),
        })
      )
    );

    expect(record.expiresAt).toBe('2026-09-18T10:00:00.000Z');
  });

  it('lapses once the grace period expires', () => {
    const record = writeOf(
      applyAppleNotification(
        stored(),
        event({
          notificationType: 'GRACE_PERIOD_EXPIRED',
          expiresDate: at('2026-08-25T10:00:00Z'),
          gracePeriodExpiresDate: null,
          signedDate: at('2026-08-25T10:00:01Z'),
        })
      )
    );

    expect(resolveEntitledTier(record, new Date('2026-08-26T00:00:00Z')).name).toBe('free');
  });
});

describe('sandbox cannot reach a production subscription', () => {
  it('ignores a sandbox event against a production entitlement', () => {
    /*
      Anyone with a developer account can make a free sandbox purchase against
      this bundle id. It must not extend a real one.
    */
    const decision = applyAppleNotification(
      stored({ environment: 'Production' }),
      event({ environment: 'Sandbox', signedDate: at('2026-08-18T11:00:00Z') })
    );

    expect(decision).toMatchObject({
      action: 'ignore',
      reason: 'sandbox-would-overwrite-production',
    });
  });

  it('still lets App Review buy things, which runs entirely in sandbox', () => {
    /*
      The assertion that keeps the rule above from being a rejection. A
      reviewer's account has no production entitlement, so a sandbox purchase
      must work normally.
    */
    const fresh = writeOf(
      applyAppleNotification(null, event({ environment: 'Sandbox', notificationType: 'SUBSCRIBED' }))
    );
    expect(fresh.tier).toBe('paid');
    expect(fresh.environment).toBe('Sandbox');

    const renewed = writeOf(
      applyAppleNotification(
        stored({ environment: 'Sandbox' }),
        event({ environment: 'Sandbox', signedDate: at('2026-08-18T11:00:00Z') })
      )
    );
    expect(renewed.tier).toBe('paid');
  });

  it('lets production write over a sandbox row', () => {
    // The stronger claim wins in the direction that is not an attack.
    const record = writeOf(
      applyAppleNotification(
        stored({ environment: 'Sandbox' }),
        event({ environment: 'Production', signedDate: at('2026-08-18T11:00:00Z') })
      )
    );
    expect(record.environment).toBe('Production');
  });
});

describe('a product we do not recognise never grants a paid tier', () => {
  it('grants free and says so loudly', () => {
    /*
      The realistic cause is a typo in PRODUCT_TIERS or a product added in App
      Store Connect and not here. Silently granting `paid` would be a hole;
      silently granting `free` would be an unexplained support ticket. So it
      grants free and carries a warning the route logs at error level.
    */
    const decision = applyAppleNotification(
      null,
      event({ productId: 'co.davidmasterson.crewchief.paid.weekly' })
    );

    const record = writeOf(decision);
    expect(record.tier).toBe('free');
    expect(decision.action === 'write' && decision.warning).toMatch(/unknown-product/);
  });

  it('carries no warning for a product that is mapped', () => {
    // Anti-vacuous: the warning must not be unconditional.
    const decision = applyAppleNotification(null, event());
    expect(decision.action === 'write' && decision.warning).toBeUndefined();
  });
});

describe('auto-renew status is recorded but never decides entitlement', () => {
  it('stores a cancellation without ending access', () => {
    /*
      Turning off auto-renew means "do not charge me again", not "cut me off
      now". The customer has paid through the period and ending it early is
      both wrong and a refund request waiting to happen.
    */
    const record = writeOf(
      applyAppleNotification(
        stored(),
        event({
          notificationType: 'DID_CHANGE_RENEWAL_STATUS',
          subtype: 'AUTO_RENEW_DISABLED',
          autoRenewStatus: false,
          expiresDate: at('2026-09-18T10:00:00Z'),
        })
      )
    );

    expect(record.autoRenewStatus).toBe(false);
    expect(record.tier).toBe('paid');
    expect(resolveEntitledTier(record, new Date('2026-09-01T00:00:00Z')).name).toBe('paid');
  });
});

/**
 * ── IAP-07 / IAP-09: two states the decision layer used to drop ─────────────
 */
describe('states that were silently unhandled', () => {
  it('restores access when Apple reverses a refund — IAP-07', () => {
    /*
      ⚠ The failure was **one-directional and permanent**. `REFUND` sets
      `revokedAt`, `resolveEntitledTier` reads a revoked record as not live, and
      `REFUND_REVERSED` — Apple saying the refund it granted has been reversed,
      because the chargeback failed — was not in `STATE_BEARING_TYPES`. So it
      fell into `unhandled-notification-type`, was logged, and dropped.

      The customer is paying and locked out, and the only signal that would fix
      it is the one being ignored.
    */
    const revoked = applyAppleNotification(null, event({ notificationType: 'REFUND' }));
    expect(revoked.action).toBe('write');
    expect(revoked.action === 'write' && revoked.record.revokedAt).not.toBeNull();

    const restored = applyAppleNotification(
      revoked.action === 'write' ? revoked.record : null,
      event({
        notificationType: 'REFUND_REVERSED',
        signedDate: at('2026-08-19T10:00:00Z'),
        expiresDate: at('2026-09-18T10:00:00Z'),
      })
    );

    expect(restored.action).toBe('write');
    expect(restored.action === 'write' && restored.record.revokedAt).toBeNull();
    expect(restored.action === 'write' && restored.record.tier).not.toBe('free');
  });

  it('refuses a paid tier that arrives with no expiry — IAP-09', () => {
    /*
      ⚠ `expiresAt: null` means "does not expire" to `resolveEntitledTier`. For
      a subscription that is a **lifetime grant** written from a payload we do
      not understand, and no renewal event would ever correct it.

      `ignore`, not a write of `free`: revoking somebody mid-period on the
      strength of a payload already judged untrustworthy is the wrong direction
      to be wrong in.
    */
    const decision = applyAppleNotification(
      null,
      event({ notificationType: 'DID_RENEW', expiresDate: null })
    );

    expect(decision).toMatchObject({ action: 'ignore', reason: 'paid-tier-with-no-expiry' });
  });

  it('still writes a revocation that has no expiry, because it does not need one', () => {
    /*
      The anti-vacuous half. A refund's truth is `revokedAt`, not `expiresDate`
      — refusing it for a missing expiry would leave access running on a
      subscription that has been refunded, which is the opposite of the fix.
    */
    const decision = applyAppleNotification(
      null,
      event({ notificationType: 'REVOKE', expiresDate: null })
    );

    expect(decision.action).toBe('write');
  });
});
