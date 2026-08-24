import { logger } from '@crewchief/core/logger';
import type { NextRequest } from 'next/server';

import type { ApiResponse } from '@crewchief/core/types';
import { checkRateLimit, getClientIdentifier, rateLimitResponse } from '@/lib/rate-limit';
import { requireSession } from '@/lib/api-auth';
import { getAppleRootCertificates, APPLE_BUNDLE_ID } from '@/lib/apple-root-ca';
import { parseAppleTransaction } from '@/lib/apple-notification';
import {
  applyVerifiedAppleEvent,
  findUserByOriginalTransactionId,
} from '@/lib/entitlement-store';

export const dynamic = 'force-dynamic';

/**
 * `POST /api/v1/iap/verify` — the moment a purchase becomes an entitlement.
 *
 * Phase 6, E8. StoreKit completes a purchase on the device and hands the app a
 * signed transaction. This is where that transaction is checked and, if it is
 * genuine, associated with the account that is signed in.
 *
 * ── ⚠ This route is the only place the association is ever made ─────────────
 *
 * Apple's later notifications carry an `original_transaction_id` and **no
 * user** — Apple has no idea who our accounts are. The link between "this
 * subscription" and "this CrewChief account" exists only because this route saw
 * a signed-in session and a signed transaction at the same moment. Everything
 * the webhook does afterwards is a lookup against what happened here.
 *
 * ── What the client is not trusted for ──────────────────────────────────────
 *
 * Everything except the JWS. The body carries no product id, no tier, no
 * expiry and no user id, because every one of those would be a value the device
 * could choose. The tier comes from the product id *inside Apple's signature*,
 * and the account comes from the session — never from the payload.
 *
 * This is why `applyVerifiedAppleEvent` takes a user id and an already-verified
 * event: the two facts arrive from different places and neither is allowed to
 * assert the other.
 *
 * ── The transaction that belongs to somebody else ───────────────────────────
 *
 * A signed transaction is genuine no matter who replays it. Somebody who
 * obtains another account's `jwsRepresentation` — from a jailbroken device, a
 * proxy, a shared family device — could otherwise present it and be granted the
 * subscription somebody else is paying for, while the real owner's row is
 * silently rewritten to a different `user_id`.
 *
 * `original_transaction_id` is UNIQUE in the schema, so the write would fail;
 * but a foreign-key style error surfacing as a 500 is not an answer, and the
 * failure would be indistinguishable from a database problem. So the ownership
 * check is explicit and it comes first.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const session = await requireSession();
  if (!session.ok) {
    return Response.json({ success: false, error: session.error } as ApiResponse<never>, {
      status: 401,
    });
  }

  /*
    Keyed on the caller's network identity rather than the user id: the abuse
    worth limiting here is somebody replaying a stolen transaction across many
    accounts, and a limit keyed on the account they are attacking limits
    nothing.
  */
  const rateLimit = await checkRateLimit(getClientIdentifier(request), 'default');
  if (!rateLimit.allowed) return rateLimitResponse(rateLimit);

  let body: { jwsRepresentation?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, error: 'Invalid JSON' } as ApiResponse<never>, {
      status: 400,
    });
  }

  const jwsRepresentation = body.jwsRepresentation;
  if (typeof jwsRepresentation !== 'string' || jwsRepresentation.length === 0) {
    return Response.json(
      { success: false, error: 'jwsRepresentation is required' } as ApiResponse<never>,
      { status: 400 }
    );
  }

  const parsed = parseAppleTransaction(jwsRepresentation, {
    rootCertificates: getAppleRootCertificates(),
    /*
      ⚠ IAP-03. Apple's chain signs transactions for **every app in the
      store**, so anchoring proves "Apple signed this", not "Apple signed this
      for CrewChief".
    */
    bundleId: APPLE_BUNDLE_ID,
  });

  if (!parsed.ok) {
    /*
      Warn rather than error. A rejected transaction is the system working, and
      the most likely cause is an outdated client or a sandbox receipt against
      production — not an attack. It is logged with its reason so the difference
      is visible afterwards.
    */
    logger.warn('API:IAP_VERIFY', 'Rejected a transaction', {
      reason: parsed.reason,
      detail: parsed.detail,
      userId: session.userId,
    });
    return Response.json(
      { success: false, error: 'Could not verify that purchase' } as ApiResponse<never>,
      { status: 400 }
    );
  }

  const owner = await findUserByOriginalTransactionId(parsed.event.originalTransactionId);
  if (!owner.ok) {
    logger.error('API:IAP_VERIFY', new Error('Could not check transaction ownership'), {
      detail: owner.detail,
    });
    return Response.json(
      { success: false, error: 'Could not verify that purchase' } as ApiResponse<never>,
      { status: 503 }
    );
  }

  if (owner.userId !== null && owner.userId !== session.userId) {
    /*
      Error level, and one of the few places in this product that deserves it:
      a genuine Apple signature presented by an account that is not the one it
      was issued to is either a replay or family sharing behaving in a way this
      product has not been designed for. Both are worth a human looking.
    */
    logger.error('API:IAP_VERIFY', new Error('Transaction belongs to another account'), {
      presentedBy: session.userId,
    });
    return Response.json(
      { success: false, error: 'That purchase belongs to another account' } as ApiResponse<never>,
      { status: 409 }
    );
  }

  const result = await applyVerifiedAppleEvent(session.userId, parsed.event);

  if (!result.ok) {
    /*
      `schema-not-ready` is a deployment state, not a client error, and the
      client should be told to come back rather than that its purchase failed —
      the money has already left. 503 says exactly that, and the entitlement
      lands on Apple's next notification once the migration is applied.
    */
    const status = result.reason === 'schema-not-ready' ? 503 : 500;
    return Response.json(
      { success: false, error: 'Could not record that purchase yet' } as ApiResponse<never>,
      { status }
    );
  }

  logger.info('API:IAP_VERIFY', 'Purchase verified', {
    applied: result.applied,
    environment: parsed.event.environment,
  });

  /*
    The response says what the account may use, not what Apple sent. The device
    has the transaction already; what it does not have is our verdict on it, and
    that verdict is the only thing it should be rendering.
  */
  return Response.json({
    success: true,
    entitlement: {
      tier: result.applied ? result.tier : null,
      recorded: result.applied,
    },
  });
}
