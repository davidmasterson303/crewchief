import { logger } from '@crewchief/core/logger';
import type { NextRequest } from 'next/server';

import { getAppleRootCertificates } from '@/lib/apple-root-ca';
import { parseAppleNotification } from '@/lib/apple-notification';
import {
  applyVerifiedAppleEvent,
  findUserByOriginalTransactionId,
} from '@/lib/entitlement-store';

export const dynamic = 'force-dynamic';

/**
 * `POST /api/internal/apple-notifications` — App Store Server Notifications V2.
 *
 * Phase 6, E8. Apple tells us here about everything that happens to a
 * subscription after the purchase: renewals, failed renewals, cancellations,
 * refunds, and lapses. Without it an entitlement would be written once and
 * never corrected, so a cancelled subscription would keep working until its
 * stored expiry and a refunded one would work forever.
 *
 * ── Why this is not under /api/v1, and has no shared secret ─────────────────
 *
 * `/api/v1` is the mobile client's surface and every route there must accept a
 * bearer token (`v1-accepts-bearer.test.ts`). This route accepts no user
 * credential at all, because there is no user: Apple is the caller.
 *
 * It also has no `CRON_SECRET`-style shared secret, and that is a deliberate
 * difference from `/api/internal/notify-sweep` rather than an omission.
 * **The signature is the authentication.** A shared secret would be a second,
 * weaker credential guarding an endpoint that already refuses anything not
 * signed by Apple's root — and it would have to be given to Apple through a
 * URL, which puts it in a dashboard field and in every log line of the request.
 *
 * The URL being public is fine. Nothing here acts on an unverified payload.
 *
 * ── ⚠ Status codes are load-bearing: Apple retries every non-2xx ────────────
 *
 * For up to three days, with backoff. That makes the response code a control
 * signal rather than a formality, and each one below is chosen for what a
 * retry would accomplish:
 *
 *   200  handled, or knowably not ours — never retry
 *   401  not signed by Apple — retrying cannot fix a signature
 *   503  our schema is not ready — retry, and it will succeed once applied
 *   500  something unexpected broke — retry, it may be transient
 *
 * The one worth the most care is **a notification for a transaction we have
 * never seen**. It is tempting to treat that as an error, and a 5xx would make
 * Apple retry it for three days and then give up. But it is not an error: it is
 * a purchase whose `/api/v1/iap/verify` call has not landed yet, or a sandbox
 * purchase made against this bundle id by somebody who never signed in. Neither
 * is fixed by retrying, and one of them is App Review. So it is acknowledged
 * with a 200 and a log line.
 */
export async function POST(request: NextRequest): Promise<Response> {
  let body: { signedPayload?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const signedPayload = body.signedPayload;
  if (typeof signedPayload !== 'string' || signedPayload.length === 0) {
    return Response.json({ error: 'signedPayload is required' }, { status: 400 });
  }

  const parsed = parseAppleNotification(signedPayload, {
    rootCertificates: getAppleRootCertificates(),
  });

  if (!parsed.ok) {
    /*
      Error level. Unlike the purchase route — where a rejection is usually an
      outdated client — anything arriving at this URL claims to be Apple, so a
      rejected payload is either someone probing the endpoint or a genuine
      notification we have become unable to verify. The second would silently
      stop every subscription being updated, so it must not be quiet.
    */
    logger.error('API:APPLE_NOTIFY', new Error('Rejected a notification'), {
      reason: parsed.reason,
      detail: parsed.detail,
    });
    return Response.json({ error: 'Unverified payload' }, { status: 401 });
  }

  const { event, notificationUUID } = parsed;

  const owner = await findUserByOriginalTransactionId(event.originalTransactionId);
  if (!owner.ok) {
    logger.error('API:APPLE_NOTIFY', new Error('Could not look up the subscriber'), {
      detail: owner.detail,
      notificationUUID,
    });
    return Response.json({ error: 'Lookup failed' }, { status: 500 });
  }

  if (owner.userId === null) {
    // Acknowledged, not retried — see the docblock.
    logger.info('API:APPLE_NOTIFY', 'Notification for an unknown transaction', {
      notificationType: event.notificationType,
      environment: event.environment,
      notificationUUID,
    });
    return Response.json({ received: true, applied: false, reason: 'unknown-transaction' });
  }

  const result = await applyVerifiedAppleEvent(owner.userId, event);

  if (!result.ok) {
    const status = result.reason === 'schema-not-ready' ? 503 : 500;
    logger.error('API:APPLE_NOTIFY', new Error('Could not apply a notification'), {
      reason: result.reason,
      notificationType: event.notificationType,
      notificationUUID,
      status,
    });
    return Response.json({ error: result.reason }, { status });
  }

  logger.info('API:APPLE_NOTIFY', 'Notification applied', {
    notificationType: event.notificationType,
    applied: result.applied,
    notificationUUID,
  });

  return Response.json({ received: true, applied: result.applied });
}
