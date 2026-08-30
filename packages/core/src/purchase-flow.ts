/**
 * What to do, and what to say, after a purchase attempt.
 *
 * Phase 6, E8 — the client half. StoreKit reports what happened on the device;
 * `/api/v1/iap/verify` reports what the server was willing to believe. This
 * turns that pair into a single answer the screen can render, and it is pure so
 * that every combination can be exercised without a device, a sandbox account
 * or a network.
 *
 * ── ⚠ The invariant, and the reason this file exists at all ─────────────────
 *
 * **A successful StoreKit purchase does not entitle anybody.** Access is
 * granted only when the *server* says so, because only the server has checked
 * Apple's signature — and the device is exactly the party that benefits from
 * lying about it. `grantsAccess` is true for one input combination and one
 * only, and `purchase-flow.test.ts` enumerates the whole matrix to keep it
 * that way rather than trusting this sentence.
 *
 * The tempting shortcut is to unlock on StoreKit success and let verification
 * catch up. It reads as good UX — the customer paid, why make them wait — and
 * it means a jailbroken device or a replayed transaction gets the paid tier for
 * as long as the app is open. There is no error and no log line; the feature
 * simply works for someone who did not buy it.
 *
 * ── Three outcomes that are not failures, and are easy to render as ones ────
 *
 * **Cancelled.** The customer changed their mind. An error dialog here reads as
 * the app arguing with them.
 *
 * **Pending.** Ask to Buy sends the purchase to a parent for approval, and
 * bank authentication can defer one the same way. Nothing has failed and
 * nothing has been charged yet; the entitlement may arrive hours later through
 * the notification webhook, with the app closed.
 *
 * **Already owned.** Usually a reinstall or a second device. The answer is to
 * restore, not to buy again — and App Store guidelines require a restore path
 * to exist for exactly this reason.
 */

/** What StoreKit reported on the device. */
export type StoreOutcome =
  /** A completed purchase, with Apple's signed transaction to verify. */
  | { kind: 'purchased'; jwsRepresentation: string }
  | { kind: 'cancelled' }
  /** Ask to Buy, or a bank authentication step. Not charged, not failed. */
  | { kind: 'pending' }
  | { kind: 'already-owned' }
  | { kind: 'failed'; message?: string | null }
  /** Restore found nothing to restore. Distinct from a failed restore. */
  | { kind: 'nothing-to-restore' };

/** What `/api/v1/iap/verify` said about it. */
export type VerifyOutcome =
  /** The server recorded it and the account is on a paid tier. */
  | { kind: 'entitled'; tier: string }
  /**
   * The server accepted the transaction but the account is not paid — an
   * unrecognised product, or a transaction that was already stale. Rare, and
   * deliberately not reported as success.
   */
  | { kind: 'recorded-not-entitled' }
  /** 409 — a genuine transaction presented by the wrong account. */
  | { kind: 'belongs-to-another-account' }
  /** 503 — the server cannot store it safely yet. Nothing is lost. */
  | { kind: 'retry-later' }
  /** 400 — the server would not verify the signature. */
  | { kind: 'rejected' }
  | { kind: 'network' };

export interface PurchaseResolution {
  status: 'entitled' | 'waiting' | 'declined' | 'error';
  /**
   * **The only thing that may unlock a paid feature.** True for exactly one
   * combination: StoreKit purchased *and* the server returned `entitled`.
   */
  grantsAccess: boolean;
  /** What to show. `null` means say nothing — see `cancelled`. */
  message: string | null;
  /** Whether "Restore purchases" is the useful next action. */
  offerRestore: boolean;
}

/**
 * Combine the device's report and the server's verdict into one answer.
 *
 * `verify` is `null` whenever StoreKit produced no transaction to send, which
 * is every outcome except `purchased`.
 */
export function resolvePurchase(
  store: StoreOutcome,
  verify: VerifyOutcome | null
): PurchaseResolution {
  switch (store.kind) {
    case 'cancelled':
      /*
        Silence, deliberately. The customer took an action and it did exactly
        what they asked; a dialog confirming that they did not buy something is
        the app arguing with them.
      */
      return { status: 'declined', grantsAccess: false, message: null, offerRestore: false };

    case 'pending':
      return {
        status: 'waiting',
        grantsAccess: false,
        /*
          Careful wording. It has not been approved, it has not been charged,
          and it may never be — so this says what is true and what happens next
          without promising either outcome. `advice-range.ts` argues the general
          case: no claim the data cannot support.
        */
        message:
          'This purchase needs approval before it can go through. If it is approved, your subscription starts automatically — you do not need to buy it again.',
        offerRestore: false,
      };

    case 'already-owned':
      return {
        status: 'declined',
        grantsAccess: false,
        message: 'You already have a subscription on this Apple ID. Restore it to use it here.',
        offerRestore: true,
      };

    case 'nothing-to-restore':
      return {
        status: 'declined',
        grantsAccess: false,
        message: 'No previous subscription was found on this Apple ID.',
        offerRestore: false,
      };

    case 'failed':
      return {
        status: 'error',
        grantsAccess: false,
        /*
          StoreKit's own message is preferred when there is one — it is
          localised and it is usually specific ("payment method declined")
          where anything written here would be a guess.
        */
        message: store.message?.trim()
          ? store.message.trim()
          : 'That purchase could not be completed. You have not been charged.',
        offerRestore: false,
      };

    case 'purchased':
      return resolveVerified(verify);
  }
}

function resolveVerified(verify: VerifyOutcome | null): PurchaseResolution {
  /*
    A purchase with no verdict is not a success. This is reachable when the
    verify call throws before producing an outcome, and the safe reading is the
    same as every other ambiguous case in this product: not entitled.
  */
  if (!verify) {
    return {
      status: 'error',
      grantsAccess: false,
      message: retryMessage,
      offerRestore: true,
    };
  }

  switch (verify.kind) {
    case 'entitled':
      // The one place in this file that returns true.
      return {
        status: 'entitled',
        grantsAccess: true,
        message: 'Your subscription is active.',
        offerRestore: false,
      };

    case 'recorded-not-entitled':
      return {
        status: 'error',
        grantsAccess: false,
        message:
          'Your purchase went through, but we could not match it to a subscription. Get in touch and we will sort it out.',
        offerRestore: true,
      };

    case 'belongs-to-another-account':
      return {
        status: 'error',
        grantsAccess: false,
        /*
          Named plainly rather than softened. Someone hitting this is either
          signed in as the wrong account or sharing a device, and both are
          fixed by knowing which it is.
        */
        message:
          'That purchase belongs to a different Well Kept account. Sign in as that account to use it.',
        offerRestore: false,
      };

    case 'retry-later':
      return { status: 'waiting', grantsAccess: false, message: retryMessage, offerRestore: true };

    case 'rejected':
      return {
        status: 'error',
        grantsAccess: false,
        message: 'We could not confirm that purchase with Apple. You have not been charged again.',
        offerRestore: true,
      };

    case 'network':
      return { status: 'waiting', grantsAccess: false, message: retryMessage, offerRestore: true };
  }
}

/**
 * Shared by every "we have your money and not yet your entitlement" case.
 *
 * It must not read as a failure, because it is not one: the purchase is
 * complete on Apple's side and the entitlement arrives either on a retry or on
 * Apple's own notification. Telling somebody a completed payment failed invites
 * them to buy it twice.
 */
const retryMessage =
  'Your purchase went through. We are still setting up your subscription — it will appear shortly, and you will not be charged twice.';

/**
 * Map an HTTP status from `/api/v1/iap/verify` to a verdict.
 *
 * Kept beside the outcomes it produces so the route's contract and the client's
 * reading of it cannot drift apart in separate files.
 */
export function verifyOutcomeFromStatus(
  status: number,
  body?: { entitlement?: { tier?: string | null; recorded?: boolean } | null } | null
): VerifyOutcome {
  if (status === 200) {
    const tier = body?.entitlement?.tier;
    /*
      `tier` is null when the server recorded nothing — a stale or ignored
      event. Reading a 200 as entitlement regardless would grant access on the
      strength of the server merely having answered.
    */
    return typeof tier === 'string' && tier !== 'free'
      ? { kind: 'entitled', tier }
      : { kind: 'recorded-not-entitled' };
  }
  if (status === 409) return { kind: 'belongs-to-another-account' };
  if (status === 503) return { kind: 'retry-later' };
  if (status === 400 || status === 401) return { kind: 'rejected' };
  return { kind: 'network' };
}
