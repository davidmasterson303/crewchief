import { ApiRequestError, apiRequest } from './client';
import {
  verifyOutcomeFromStatus,
  type VerifyOutcome,
} from '@crewchief/core/purchase-flow';

/**
 * Turning a completed StoreKit purchase into an entitlement.
 *
 * Phase 6, E8. StoreKit hands the app a signed transaction; this sends it to
 * `POST /api/v1/iap/verify`, which is the only place the association between a
 * subscription and a CrewChief account is ever made.
 *
 * ── Why this returns an outcome instead of throwing ─────────────────────────
 *
 * Every other call in this folder throws `ApiRequestError` and lets the screen
 * decide. That is right when the failure means "the thing did not happen".
 * Here the money has already left the customer's account before this function
 * is called, so *every* status is a state the screen has to handle carefully —
 * a 503 is not an error to surface, it is "we have your purchase and are still
 * writing it down".
 *
 * Collapsing those into a thrown error would push that distinction into a
 * `catch` block, where the difference between "declined" and "paid but not yet
 * recorded" is exactly the difference between a customer who buys again and one
 * who does not.
 *
 * The mapping itself lives in `@crewchief/core/purchase-flow` beside the route
 * contract it mirrors, so the two cannot drift in separate files.
 */
export async function verifyPurchase(jwsRepresentation: string): Promise<VerifyOutcome> {
  try {
    const body = await apiRequest<{
      entitlement?: { tier?: string | null; recorded?: boolean } | null;
    }>('/iap/verify', {
      method: 'POST',
      body: { jwsRepresentation },
    });

    return verifyOutcomeFromStatus(200, body);
  } catch (error) {
    if (error instanceof ApiRequestError) {
      /*
        A device-origin 401 means the app decided it was signed out without
        sending anything — the token was missing. That is not Apple rejecting
        the transaction, and reporting it as `rejected` would tell somebody
        their purchase could not be confirmed when it was never presented.
      */
      if (error.status === 401 && error.origin === 'device') {
        return { kind: 'network' };
      }
      return verifyOutcomeFromStatus(error.status);
    }

    /*
      A timeout or a thrown non-HTTP failure. `network` rather than `rejected`
      for the same reason: nothing has been decided, so nothing should be
      reported as decided.
    */
    return { kind: 'network' };
  }
}
