import { apiRequest } from './client';
import type { DeletionCounts } from '@crewchief/core/account-deletion';

/**
 * Account operations. Currently one, and it is the one Apple reviews.
 *
 * App Store guideline 5.1.1(v) requires account deletion to be initiated from
 * inside the app. `DELETE /api/v1/account` is the route built for exactly this
 * — `deleteAccount` is a Next.js server action, and a React Native app cannot
 * call one, which is the same gap that made `/api/v1/consultant` necessary in
 * Phase 3.0.
 */

export interface DeleteAccountResult {
  deleted: DeletionCounts;
}

export interface AccountSubscription {
  /** Whether an App Store subscription is still running. */
  live: boolean;
  /**
   * False when the server could not read the entitlement and defaulted to
   * warning. The screen shows the same notice either way — a warning withheld
   * from a subscriber is a charge they cannot stop, where a warning shown to a
   * non-subscriber is a confusing sentence — but the flag is carried so a log
   * or a support conversation can tell the two apart.
   */
  certain: boolean;
}

/**
 * What the delete screen needs to know before it asks.
 *
 * Deliberately fails to `live: false` on a network error rather than throwing:
 * the account screen's job is deletion, and blocking it because a secondary
 * read failed would obstruct the one flow Apple requires to work. The tradeoff
 * is stated where it is made — see `AccountScreen`.
 */
export async function getSubscription(): Promise<AccountSubscription> {
  try {
    const response = await apiRequest<{ subscription?: AccountSubscription }>('/account', {
      method: 'GET',
    });
    return response.subscription ?? { live: false, certain: false };
  } catch {
    return { live: false, certain: false };
  }
}

/**
 * Delete the signed-in account and everything belonging to it.
 *
 * **The caller must clear the local session afterwards.** The bearer token
 * names an auth user that no longer exists, so nothing will ever come back and
 * tell the app it is signed out — a later request simply 401s. The route's own
 * docblock says the same thing and names `signOut` as the mobile half.
 *
 * Errors surface as `ApiRequestError` with the server's message, which those
 * routes write to be shown.
 */
export async function deleteAccount(): Promise<DeleteAccountResult> {
  const response = await apiRequest<{ success: boolean; deleted?: DeletionCounts }>('/account', {
    method: 'DELETE',
  });

  return {
    // A successful delete with no counts is possible — an account with nothing
    // in it — and is not an error. `describeDeletion` handles the zero case.
    deleted: response.deleted ?? { vehicles: 0, storageObjects: 0 },
  };
}
