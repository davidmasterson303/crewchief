import { logger } from '@crewchief/core/logger';
import { type NextRequest } from 'next/server';
import type { ApiResponse } from '@crewchief/core/types';
import { checkRateLimit, getClientIdentifier, rateLimitResponse } from '@/lib/rate-limit';
import { deleteAccount } from '@/lib/account-data';
import { requireSession } from '@/lib/api-auth';
import { getServiceRoleClient } from '@/lib/supabase';
import { hasLiveEntitlement, readFailureMeansNoSubscription } from '@crewchief/core/entitlement';

export const dynamic = 'force-dynamic';

/**
 * `DELETE /api/v1/account` — App Store guideline 5.1.1(v).
 *
 * ── Why this route exists at all ────────────────────────────────────────────
 *
 * Apple requires account deletion to be initiated **from inside the app being
 * reviewed**, and routinely rejects "delete your account on our website". The
 * deletion itself has been built and tested since Phase 1 and has now executed
 * end to end against the live database — account, vehicle, profile and storage
 * all verified gone on 1 Aug.
 *
 * What it was not, was *reachable*. `deleteAccount` is a Next.js server action,
 * and a server action is an internal RPC whose client half the bundler
 * generates — a React Native app is not a Next.js client and cannot call one.
 * Exactly the gap that made `/api/v1/consultant` necessary in Phase 3.0.
 *
 * ── The scope of this file is deliberately one call ─────────────────────────
 *
 * `requireSession` already accepts a bearer token: it delegates to
 * `requireCaller` → `resolveCaller`, which resolves either credential type.
 * So `deleteAccount` was already bearer-capable and nothing about the deletion
 * logic needed changing or duplicating.
 *
 * That matters more than it sounds. The ordering inside `deleteAccount` is
 * load-bearing — storage objects have no foreign key, so purging them *before*
 * the cascade is the only thing standing between a deleted account and files
 * orphaned in the bucket forever. A route that reimplemented any of it would be
 * a second answer to "what does deletion mean", and the second answer is the
 * one that drifts.
 *
 * ── Method ─────────────────────────────────────────────────────────────────
 *
 * DELETE, not POST. The action is idempotent in the way that matters — a second
 * call from the same caller cannot succeed, because the credential it
 * authenticated with no longer resolves to a user.
 */
/**
 * `GET /api/v1/account` — what the delete screen has to know before it asks.
 *
 * Phase 6, E5. The only thing it reports is whether an App Store subscription
 * is still running, because **deleting an account while Apple keeps charging is
 * a documented rejection reason** and the screen cannot warn about a state it
 * cannot see.
 *
 * ── Why the client is told a boolean and not the row ────────────────────────
 *
 * `expires_at`, `original_transaction_id` and `product_id` are all things the
 * client could render, and none of them are things it needs in order to say
 * "cancel this first". Shipping the transaction id to a device puts Apple's
 * billing identifier somewhere it can be read off a jailbroken phone or a proxy
 * for no benefit at all. The decision — is it live *right now* — is made here,
 * against the server's clock, by the same function the budget path uses.
 *
 * The server's clock matters: a device with a wound-forward date could
 * otherwise talk itself out of the warning.
 */
export async function GET(): Promise<Response> {
  const session = await requireSession();
  if (!session.ok) {
    return Response.json({ success: false, error: session.error } as ApiResponse<never>, {
      status: 401,
    });
  }

  const client = getServiceRoleClient();
  const { data, error } = await client
    .from('account_entitlements')
    .select('tier, expires_at')
    .eq('user_id', session.userId)
    .maybeSingle();

  if (error && !readFailureMeansNoSubscription((error as { code?: string }).code)) {
    /*
      Fail toward showing the warning, which is the opposite of how the budget
      path treats the same read failure — and for the same reason inverted.

      There, an unreadable entitlement must not cost a paying user their
      allowance, so it resolves to the free ceiling. Here, an unreadable
      entitlement must not cost someone a subscription they keep paying for
      after their account is gone. A warning shown to a non-subscriber is a
      confusing sentence; a warning withheld from a subscriber is a recurring
      charge they cannot stop.
    */
    logger.warn('API:ACCOUNT_GET', 'Could not read entitlement; warning anyway', {
      message: error.message,
    });
    return Response.json({ success: true, subscription: { live: true, certain: false } });
  }

  const live = hasLiveEntitlement(
    data ? { tier: data.tier as string | null, expiresAt: data.expires_at as string | null } : null
  );

  return Response.json({ success: true, subscription: { live, certain: true } });
}

export async function DELETE(request: NextRequest): Promise<Response> {
  logger.info('API:ACCOUNT_DELETE', 'Account deletion requested');

  /*
    Rate limited on the caller's network identity rather than their user id,
    because the interesting abuse here is unauthenticated: an attacker probing
    the endpoint has no user id, and one keyed on a value they do not have
    limits nobody.
  */
  const identifier = getClientIdentifier(request);
  const rateLimit = await checkRateLimit(identifier, 'default');
  if (!rateLimit.allowed) {
    logger.warn('API:ACCOUNT_DELETE', 'Rate limit exceeded', { identifier });
    return rateLimitResponse(rateLimit);
  }

  try {
    /*
      No confirmation token, no body, no `?confirm=true`. The confirmation is
      the user's, and it belongs in the interface where they can read what they
      are about to lose — `DeleteAccountDialog` on web does exactly that. A
      server-side echo check would be security theatre: any caller able to
      construct this request can construct the confirmation too.
    */
    const result = await deleteAccount();

    if (!result.success) {
      /*
        `deleteAccount` returns its own 'Unauthorized' when no credential
        resolves, so an anonymous caller is refused here rather than reaching
        the service role. Distinguished from a genuine failure by status: 401
        means "we do not know who you are", 500 means "we knew, and it broke".
      */
      const unauthorized = result.error === 'Unauthorized';

      if (!unauthorized) {
        logger.error('API:ACCOUNT_DELETE', new Error(result.error ?? 'unknown'));
      }

      return Response.json(
        { success: false, error: result.error } as ApiResponse,
        { status: unauthorized ? 401 : 500 }
      );
    }

    logger.info('API:ACCOUNT_DELETE', 'Account deleted');

    /*
      `deleted` carries what went with it, because a client that has just
      destroyed someone's data should be able to say what it destroyed rather
      than "done". The web dialog already shows this; the mobile one will want
      the same numbers.

      Note the caller's token is now dead — the auth user it names is gone — so
      a client must clear its session locally rather than expecting a later
      request to tell it. `signOutAndClearCache` is what the web path calls, and
      the mobile equivalent is `signOut` in apps/mobile/src/auth/session.ts.
    */
    return Response.json({ success: true, deleted: result.deleted } as ApiResponse);
  } catch (error) {
    logger.error('API:ACCOUNT_DELETE', error as Error);
    return Response.json(
      { success: false, error: 'Failed to delete account' } as ApiResponse,
      { status: 500 }
    );
  }
}
