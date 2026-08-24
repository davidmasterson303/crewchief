/**
 * What an App Store Server Notification does to a stored entitlement.
 *
 * Phase 6, E8. `entitlement.ts` answers *what may this account use today* by
 * reading a record against the clock. This answers the other half — **what
 * should that record become** when Apple tells us something changed — and it is
 * deliberately the same shape of thing: pure, no IO, no clock of its own, the
 * caller supplies the event and the current row.
 *
 * ── Why the decision is separated from the transport ────────────────────────
 *
 * The webhook that receives these has to do three unrelated jobs: verify a JWS
 * signature, parse a deeply nested payload, and decide what it means. Only the
 * third is interesting, and only the third is where a mistake costs money in
 * both directions — a wrong "revoke" bills nobody for a product they are using,
 * a wrong "renew" gives it away. Keeping it here means the reasoning can be
 * exercised against every ordering Apple can produce without a signature, a
 * network, or a database.
 *
 * ── ⚠ The failure mode that has no error message ────────────────────────────
 *
 * **Apple does not guarantee notification order.** The documentation is
 * explicit about it, and retries make it routine rather than theoretical: a
 * `DID_RENEW` signed at 10:00 can arrive *after* an `EXPIRED` signed at 10:05,
 * because the first delivery failed and the retry queued behind the second.
 *
 * Applied naively, that resurrects a dead subscription. Nothing throws. No log
 * line says anything is wrong. The account simply keeps working, and the only
 * evidence is a paid tier on an account that stopped paying — which is exactly
 * the class of defect `CLAUDE.md` says costs the most here.
 *
 * So every decision is gated on `signedDate`, which is Apple's own clock inside
 * the signed payload rather than ours. An event that is not strictly newer than
 * what we have already applied is **ignored**, and says so.
 */

import { TIERS, type TierName } from './ai/budget';

/**
 * Which App Store environment a payload came from.
 *
 * Trustworthy because it lives *inside* the signed JWS rather than beside it —
 * see `verifyAppleSignedPayload`. A client cannot assert it.
 */
export type AppleEnvironment = 'Sandbox' | 'Production';

/**
 * The subset of Apple's notification payload this decision actually needs.
 *
 * Flattened from `data.signedTransactionInfo` + `signedRenewalInfo`, which are
 * themselves JWS blobs nested inside the outer one. Flattening at the boundary
 * keeps Apple's three-level envelope out of the reasoning, and keeps this
 * testable without constructing one.
 *
 * All timestamps are **milliseconds since epoch**, which is what Apple sends.
 */
export interface AppleSubscriptionEvent {
  /** e.g. `SUBSCRIBED`, `DID_RENEW`, `EXPIRED`, `REFUND`. */
  notificationType: string;
  /** e.g. `INITIAL_BUY`, `GRACE_PERIOD`, `BILLING_RETRY`. Often absent. */
  subtype?: string | null;
  /** Apple's signing time. **The ordering authority — never our own clock.** */
  signedDate: number;
  /** Stable across every renewal of one subscription. The identity. */
  originalTransactionId: string;
  /** The App Store Connect product id. Maps to a tier below. */
  productId: string;
  /** The individual transaction, which changes each period. */
  transactionId?: string | null;
  /** When the current period ends. */
  expiresDate?: number | null;
  /** Set while Apple is retrying a failed renewal but access should continue. */
  gracePeriodExpiresDate?: number | null;
  /** Whether it is set to renew again. Display only — never entitlement. */
  autoRenewStatus?: boolean | null;
  /** Set on refund or family-sharing revocation. Ends access immediately. */
  revocationDate?: number | null;
  environment: AppleEnvironment;
}

/** The row as stored. Mirrors `account_entitlements`, in camelCase. */
export interface StoredEntitlement {
  tier: string | null;
  expiresAt: string | null;
  originalTransactionId: string | null;
  productId: string | null;
  environment: string | null;
  autoRenewStatus: boolean | null;
  revokedAt: string | null;
  latestTransactionId: string | null;
  /** Apple's `signedDate` of the last event applied. The ordering guard. */
  lastSignedDate: string | null;
}

/** What to write. Every field is derived; nothing is carried over blindly. */
export interface EntitlementWrite {
  tier: TierName;
  expiresAt: string | null;
  originalTransactionId: string;
  productId: string;
  environment: AppleEnvironment;
  autoRenewStatus: boolean | null;
  revokedAt: string | null;
  latestTransactionId: string | null;
  lastSignedDate: string;
}

export type IgnoreReason =
  | 'stale-event'
  | 'sandbox-would-overwrite-production'
  /**
   * IAP-09. A mapped paid product arriving with no expiry.
   *
   * ⚠ Worth an error-level log wherever this is consumed, not a shrug: it means
   * a payload we cannot interpret reached a path that would otherwise have
   * written a **lifetime** paid entitlement.
   */
  | 'paid-tier-with-no-expiry'
  | 'unhandled-notification-type';

export type EntitlementDecision =
  | {
      action: 'ignore';
      reason: IgnoreReason;
      /** Present when the reason is worth a log line rather than a shrug. */
      detail?: string;
    }
  | {
      action: 'write';
      record: EntitlementWrite;
      /**
       * Set when the write is correct but something about it wants a human.
       * The route logs these at error level — see `unknown-product` below.
       */
      warning?: string;
    };

/**
 * App Store Connect product id → the tier it grants.
 *
 * ⚠ **These strings must match App Store Connect exactly.** They are the one
 * part of this file that cannot be verified from inside the repo, because the
 * products live in an account this code has no access to. A typo here does not
 * throw — it produces `unknown-product`, which grants `free` and logs loudly,
 * which is the least-bad shape for a mistake that only shows up in production.
 *
 * ⚠ **The price is not here and must not come here.** D2 is undecided, and
 * Apple is the authority on price regardless: the App Store returns a localised,
 * currency-correct string per storefront, and a number hardcoded in the client
 * is wrong for most of the world the moment it is written. This maps identity
 * to entitlement, nothing else.
 */
export const PRODUCT_TIERS: Readonly<Record<string, TierName>> = Object.freeze({
  'co.davidmasterson.crewchief.paid.monthly': 'paid',
  'co.davidmasterson.crewchief.paid.annual': 'paid',
});

/**
 * Notification types that end access immediately, whatever the expiry says.
 *
 * A refund is not a lapse. The period may have weeks left on it and the money
 * has gone back, so `expiresDate` is no longer the truth — `revokedAt` is.
 * `resolveEntitledTier` never sees a revoked record as live because the write
 * below also collapses `expiresAt` onto the revocation instant.
 */
const REVOKING_TYPES = new Set(['REFUND', 'REVOKE']);

/**
 * Types that carry a current subscription state worth storing.
 *
 * `CONSUMPTION_REQUEST`, `PRICE_INCREASE` and friends are deliberately absent:
 * they are real notifications that say nothing about whether access should
 * continue, and writing on them would move `lastSignedDate` forward and cause
 * a genuinely meaningful event behind them to be dropped as stale.
 */
const STATE_BEARING_TYPES = new Set([
  'SUBSCRIBED',
  'DID_RENEW',
  'DID_CHANGE_RENEWAL_STATUS',
  'DID_CHANGE_RENEWAL_PREF',
  'DID_FAIL_TO_RENEW',
  'EXPIRED',
  'GRACE_PERIOD_EXPIRED',
  'OFFER_REDEEMED',
  'RENEWAL_EXTENDED',
  'REFUND',
  'REVOKE',
  /*
    ── ⚠ IAP-07 · a reversed refund used to lock somebody out forever ─────────

    `REFUND_REVERSED` is Apple telling us a refund it previously granted has
    been **reversed** — the customer's chargeback failed, or Apple reconsidered.
    It was absent from this set and from `REVOKING_TYPES`, so it fell into
    `unhandled-notification-type` and was logged and dropped.

    The consequence is one-directional and permanent: `REFUND` set `revokedAt`,
    `resolveEntitledTier` reads a revoked record as not live, and **nothing
    would ever clear it**. The customer is paying and locked out, and the only
    signal that would fix it is the one being ignored.

    It is state-bearing but deliberately **not** revoking: it restores the
    record to whatever `expiresDate` says, and the `revokedAt: null` at the foot
    of `applyAppleNotification` — written for the re-subscribe case — does
    exactly that here too.
  */
  'REFUND_REVERSED',
]);

/**
 * Decide what an Apple event does to the stored record.
 *
 * Returns `ignore` rather than throwing for every input it declines to act on,
 * because a webhook that throws gets retried by Apple forever and a 500 loop is
 * a worse outcome than a logged no-op.
 */
export function applyAppleNotification(
  current: StoredEntitlement | null | undefined,
  event: AppleSubscriptionEvent
): EntitlementDecision {
  if (!STATE_BEARING_TYPES.has(event.notificationType)) {
    return {
      action: 'ignore',
      reason: 'unhandled-notification-type',
      detail: event.notificationType,
    };
  }

  /*
    A Sandbox event must never overwrite a Production entitlement.

    App Review runs against Sandbox, so sandbox traffic is expected and normal
    and must work. What must not happen is a sandbox purchase — which anyone
    with a developer account can make against our bundle id, for free —
    extending a real, paid, production subscription that shares an
    `original_transaction_id` space with it. Production is the stronger claim,
    so it wins, and the sandbox event is dropped with a reason rather than
    silently.
  */
  if (event.environment === 'Sandbox' && current?.environment === 'Production') {
    return {
      action: 'ignore',
      reason: 'sandbox-would-overwrite-production',
      detail: event.originalTransactionId,
    };
  }

  /*
    The ordering guard. `>=` rather than `>` is wrong here and it is worth
    saying why: Apple can legitimately sign two notifications in the same
    millisecond, and re-applying an identical event is harmless, but replaying
    an *older* one is not. Strictly-newer is the only comparison that makes
    replay safe without needing the events to be unique.
  */
  const previousSignedDate = parseStoredDate(current?.lastSignedDate);
  if (previousSignedDate !== null && event.signedDate <= previousSignedDate) {
    return {
      action: 'ignore',
      reason: 'stale-event',
      detail: `${event.notificationType} signed ${new Date(event.signedDate).toISOString()} is not newer than ${current?.lastSignedDate}`,
    };
  }

  const tier = PRODUCT_TIERS[event.productId];
  const warning =
    tier === undefined
      ? `unknown-product: ${event.productId} is not in PRODUCT_TIERS; granting free`
      : undefined;

  const base = {
    originalTransactionId: event.originalTransactionId,
    productId: event.productId,
    environment: event.environment,
    latestTransactionId: event.transactionId ?? null,
    lastSignedDate: new Date(event.signedDate).toISOString(),
  };

  if (REVOKING_TYPES.has(event.notificationType)) {
    /*
      `revocationDate` is the authority, but it is not always present — a
      `REVOKE` for family sharing can arrive without one. Falling back to the
      signing time is right: it is Apple's own clock, it is never in the
      future, and the alternative (leaving `expiresAt` alone) keeps a refunded
      subscription alive.
    */
    const revokedAt = new Date(event.revocationDate ?? event.signedDate).toISOString();
    return {
      action: 'write',
      warning,
      record: {
        ...base,
        tier: 'free',
        // Collapsed onto the revocation so the read path needs no special case.
        expiresAt: revokedAt,
        autoRenewStatus: false,
        revokedAt,
      },
    };
  }

  /*
    Grace period extends access past `expiresDate` while Apple retries the
    card. Taking the later of the two is what "grace" means, and taking it
    unconditionally rather than only on `DID_FAIL_TO_RENEW` is deliberate:
    the field is present on any renewal-info payload while grace is running,
    and reading it only on the one notification that introduced it would drop
    the grace state on the next unrelated event.
  */
  const expiresMs = laterOf(event.expiresDate, event.gracePeriodExpiresDate);

  /*
    ── ⚠ IAP-09 · a null expiry reads as a lifetime grant ────────────────────

    `expiresAt: null` means "does not expire" to `resolveEntitledTier`, which is
    correct for a **non-renewing** product and catastrophic for a subscription:
    a mapped product arriving with no `expiresDate` — a malformed payload, a
    field Apple stops sending, a consumable that shares a tier name — writes a
    paid entitlement that never lapses and that no renewal event will correct.

    A subscription without an expiry is not a subscription we understand, so it
    is refused rather than stored. `ignore` rather than a write, because writing
    `free` would revoke somebody mid-period on the strength of a payload we have
    already decided is untrustworthy.
  */
  if (expiresMs === null && tier && tier !== 'free' && !REVOKING_TYPES.has(event.notificationType)) {
    return {
      action: 'ignore',
      reason: 'paid-tier-with-no-expiry',
      detail: event.productId ?? undefined,
    };
  }

  return {
    action: 'write',
    warning,
    record: {
      ...base,
      tier: tier ?? 'free',
      expiresAt: expiresMs === null ? null : new Date(expiresMs).toISOString(),
      autoRenewStatus: event.autoRenewStatus ?? null,
      /*
        A new purchase clears a previous revocation. Re-subscribing after a
        refund is an ordinary thing to do, and leaving `revokedAt` set would
        leave a permanent mark that no later event removes.
      */
      revokedAt: null,
    },
  };
}

/** The later of two optional epoch-ms values, or null when neither is usable. */
function laterOf(a: number | null | undefined, b: number | null | undefined): number | null {
  const values = [a, b].filter(
    (v): v is number => typeof v === 'number' && Number.isFinite(v)
  );
  return values.length === 0 ? null : Math.max(...values);
}

/**
 * Parse a stored ISO timestamp to epoch ms, treating anything unparseable as
 * absent.
 *
 * Unparseable is treated as "no previous event" rather than as a barrier,
 * because the alternative wedges the account permanently: a single corrupt
 * `last_signed_date` would make every future notification look stale and the
 * subscription would freeze at whatever it last was, with no error anywhere.
 * Letting the next real event through repairs the row.
 */
function parseStoredDate(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Every tier this module can grant. Exported so a guard can close the list. */
export const GRANTABLE_TIERS: readonly TierName[] = Object.freeze(
  Object.keys(TIERS) as TierName[]
);
