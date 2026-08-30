/**
 * Unwrapping Apple's three-layer envelope into one event.
 *
 * Phase 6, E8. An App Store Server Notification is a JWS whose payload contains
 * two *more* JWS blobs — `signedTransactionInfo` and `signedRenewalInfo` — and
 * the fields the entitlement decision needs are spread across all three levels.
 *
 * ── ⚠ Every layer is verified, not just the outer one ───────────────────────
 *
 * The tempting shortcut is to verify the envelope and then `JSON.parse` the
 * inner blobs, on the grounds that they arrived inside something already
 * trusted. That is wrong, and it is wrong in the direction that costs money:
 * the *expiry date* and the *product id* — the two fields that decide what an
 * account gets and for how long — live in the inner transaction, not the outer
 * envelope. A verifier that checks only the outside is checking the postmark
 * and not the cheque.
 *
 * So `signedTransactionInfo` and `signedRenewalInfo` are each verified against
 * the same pinned roots. Apple signs them separately and it signs them for a
 * reason.
 *
 * ── Renewal info is optional, transaction info is not ───────────────────────
 *
 * `signedRenewalInfo` is absent on some notification types and its fields are
 * either display state (`autoRenewStatus`) or a grace period that is only
 * sometimes running. Missing it degrades the record; missing the transaction
 * means there is nothing to record at all, so that one is a hard failure.
 */

import {
  verifyAppleSignedPayload,
  type JwsFailureReason,
} from '@/lib/apple-jws';
import type { AppleEnvironment, AppleSubscriptionEvent } from '@wellkept/core/apple-subscription';

export type ParseFailureReason =
  | `envelope:${JwsFailureReason}`
  | `transaction:${JwsFailureReason}`
  | `renewal:${JwsFailureReason}`
  | 'missing-transaction-info'
  /** IAP-03. Correctly signed by Apple, for somebody else's app. */
  | 'transaction-is-for-another-app'
  | 'missing-required-fields';

export type ParsedNotification =
  | { ok: true; event: AppleSubscriptionEvent; notificationUUID: string | null }
  | { ok: false; reason: ParseFailureReason; detail?: string };

interface ParseOptions {
  rootCertificates: readonly string[];
  /**
   * The bundle identifier this deployment will accept transactions for.
   *
   * ⚠ **Required, and deliberately not defaulted** (IAP-03). A default would be
   * a value somebody could forget to set correctly, and forgetting it would
   * restore the finding silently — the chain still verifies, the product id
   * still maps, and the entitlement is still written. The caller must say which
   * app it is.
   */
  bundleId: string;
  now?: Date;
}

/** The outer envelope, as far as this module cares. */
interface NotificationEnvelope {
  notificationType?: unknown;
  subtype?: unknown;
  notificationUUID?: unknown;
  signedDate?: unknown;
  data?: {
    environment?: unknown;
    signedTransactionInfo?: unknown;
    signedRenewalInfo?: unknown;
  };
}

interface TransactionInfo {
  /**
   * The app this transaction belongs to.
   *
   * ⚠ **This field was not declared, so it was never parsed and never
   * compared** (IAP-03). A repo-wide search for `bundleId` returned exactly one
   * hit — `app.json:11`, the Expo config. Apple's WWDR chain signs transactions
   * for **every app in the store**, so a verified chain proves *"Apple signed
   * this"*, not *"Apple signed this for Well Kept"*.
   *
   * The only thing standing between a signed transaction from an unrelated app
   * and a paid entitlement here was a product-id lookup in `PRODUCT_TIERS` — an
   * accident of naming, not a control.
   */
  bundleId?: unknown;
  transactionId?: unknown;
  originalTransactionId?: unknown;
  productId?: unknown;
  expiresDate?: unknown;
  revocationDate?: unknown;
  environment?: unknown;
  signedDate?: unknown;
}

interface RenewalInfo {
  autoRenewStatus?: unknown;
  gracePeriodExpiresDate?: unknown;
}

/**
 * Verify and flatten an App Store Server Notification V2.
 */
export function parseAppleNotification(
  signedPayload: string,
  { rootCertificates, now, bundleId }: ParseOptions
): ParsedNotification {
  const envelope = verifyAppleSignedPayload<NotificationEnvelope>(signedPayload, {
    rootCertificates,
    now,
  });
  if (!envelope.ok) {
    return { ok: false, reason: `envelope:${envelope.reason}`, detail: envelope.detail };
  }

  const body = envelope.payload;
  const signedTransactionInfo = body.data?.signedTransactionInfo;
  if (typeof signedTransactionInfo !== 'string') {
    return { ok: false, reason: 'missing-transaction-info' };
  }

  const transaction = verifyAppleSignedPayload<TransactionInfo>(signedTransactionInfo, {
    rootCertificates,
    now,
  });
  if (!transaction.ok) {
    return { ok: false, reason: `transaction:${transaction.reason}`, detail: transaction.detail };
  }

  let renewal: RenewalInfo = {};
  const signedRenewalInfo = body.data?.signedRenewalInfo;
  if (typeof signedRenewalInfo === 'string') {
    const verified = verifyAppleSignedPayload<RenewalInfo>(signedRenewalInfo, {
      rootCertificates,
      now,
    });
    if (!verified.ok) {
      /*
        A present-but-unverifiable renewal blob is a hard failure rather than a
        skipped optional. Absent means Apple did not send one; unverifiable
        means something is wrong with a payload that claims to be Apple's, and
        proceeding would apply an event built partly from a rejected signature.
      */
      return { ok: false, reason: `renewal:${verified.reason}`, detail: verified.detail };
    }
    renewal = verified.payload;
  }

  const forAnotherApp = rejectForeignBundle(transaction.payload, bundleId);
  if (forAnotherApp) return forAnotherApp;

  const event = buildEvent({
    notificationType: asString(body.notificationType),
    subtype: asString(body.subtype),
    envelopeSignedDate: asNumber(body.signedDate),
    transaction: transaction.payload,
    renewal,
    fallbackEnvironment: asEnvironment(body.data?.environment),
  });

  if (!event) return { ok: false, reason: 'missing-required-fields' };

  return { ok: true, event, notificationUUID: asString(body.notificationUUID) };
}

/**
 * Refuse a transaction Apple signed for a different app — IAP-03.
 *
 * ⚠ **An absent `bundleId` is refused, not waved through.** Apple has included
 * it in `JWSTransactionDecodedPayload` since StoreKit 2 shipped, so a
 * transaction without one is either malformed or from something that is not
 * Apple — and "the field we check is missing, so skip the check" is how a
 * control becomes optional for exactly the payloads that would fail it.
 */
function rejectForeignBundle(
  transaction: TransactionInfo,
  bundleId: string
): { ok: false; reason: ParseFailureReason; detail?: string } | null {
  const claimed = asString(transaction.bundleId);

  if (claimed === bundleId) return null;

  return {
    ok: false,
    reason: 'transaction-is-for-another-app',
    detail: claimed === null ? 'no bundleId on the transaction' : `bundleId: ${claimed}`,
  };
}

/**
 * Verify a bare StoreKit 2 transaction, as the client hands it over.
 *
 * The purchase path has no envelope: `/api/v1/iap/verify` receives a single
 * `jwsRepresentation` straight from StoreKit, which is the same signed
 * transaction the notification carries inside it.
 *
 * ── Why this synthesises a notification type ────────────────────────────────
 *
 * There is no `notificationType` on a transaction, but the decision layer is
 * written against Apple's vocabulary and should stay that way rather than grow
 * a second entry point. A transaction carrying a `revocationDate` is a refund
 * that the client is, for whatever reason, telling us about; anything else is
 * a live purchase. Mapping here keeps the state machine single-entry.
 */
export function parseAppleTransaction(
  jwsRepresentation: string,
  { rootCertificates, now, bundleId }: ParseOptions
): ParsedNotification {
  const transaction = verifyAppleSignedPayload<TransactionInfo>(jwsRepresentation, {
    rootCertificates,
    now,
  });
  if (!transaction.ok) {
    return { ok: false, reason: `transaction:${transaction.reason}`, detail: transaction.detail };
  }

  const forAnotherApp = rejectForeignBundle(transaction.payload, bundleId);
  if (forAnotherApp) return forAnotherApp;

  const revoked = asNumber(transaction.payload.revocationDate) !== null;

  const event = buildEvent({
    notificationType: revoked ? 'REVOKE' : 'SUBSCRIBED',
    subtype: null,
    envelopeSignedDate: null,
    transaction: transaction.payload,
    renewal: {},
    fallbackEnvironment: null,
  });

  if (!event) return { ok: false, reason: 'missing-required-fields' };

  return { ok: true, event, notificationUUID: null };
}

function buildEvent({
  notificationType,
  subtype,
  envelopeSignedDate,
  transaction,
  renewal,
  fallbackEnvironment,
}: {
  notificationType: string | null;
  subtype: string | null;
  envelopeSignedDate: number | null;
  transaction: TransactionInfo;
  renewal: RenewalInfo;
  fallbackEnvironment: AppleEnvironment | null;
}): AppleSubscriptionEvent | null {
  const originalTransactionId = asString(transaction.originalTransactionId);
  const productId = asString(transaction.productId);
  const environment = asEnvironment(transaction.environment) ?? fallbackEnvironment;

  /*
    These three are the identity, the entitlement and the trust boundary. A
    payload missing any of them is not a subscription event we can act on, and
    guessing a default for `environment` in particular would mean guessing
    whether a sandbox purchase counts.
  */
  if (!originalTransactionId || !productId || !environment || !notificationType) {
    return null;
  }

  /*
    The transaction's own signing time is preferred over the envelope's. Both
    are Apple's, but the transaction is the thing whose state is being recorded,
    and using the envelope would let two notifications describing the same
    transaction order themselves by when they were *announced* rather than by
    when the subscription actually changed.
  */
  const signedDate =
    asNumber(transaction.signedDate) ?? envelopeSignedDate ?? null;
  if (signedDate === null) return null;

  return {
    notificationType,
    subtype,
    signedDate,
    originalTransactionId,
    productId,
    transactionId: asString(transaction.transactionId),
    expiresDate: asNumber(transaction.expiresDate),
    gracePeriodExpiresDate: asNumber(renewal.gracePeriodExpiresDate),
    autoRenewStatus: asAutoRenew(renewal.autoRenewStatus),
    revocationDate: asNumber(transaction.revocationDate),
    environment,
  };
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asEnvironment(value: unknown): AppleEnvironment | null {
  return value === 'Sandbox' || value === 'Production' ? value : null;
}

/**
 * Apple sends `autoRenewStatus` as 0 or 1, not as a boolean.
 *
 * Reading the number as truthy would make `0` false and `1` true by accident
 * rather than by intent, and would silently turn any other value into `false` —
 * which reads as "the customer cancelled" on a screen.
 */
function asAutoRenew(value: unknown): boolean | null {
  if (value === 1 || value === true) return true;
  if (value === 0 || value === false) return false;
  return null;
}
