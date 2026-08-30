/**
 * The only thing in this product that writes an entitlement.
 *
 * Phase 6, E8. `apple-subscription.ts` decides what a notification means;
 * `apple-jws.ts` decides whether to believe it came from Apple; this is the
 * part that touches the database, and it is deliberately the thinnest of the
 * three.
 *
 * ── Service role, and why the guard exists rather than the intention ────────
 *
 * `entitlement-not-user-writable.test.ts` fails the build if any file that
 * writes `account_entitlements` does not use `getServiceRoleClient`. That test
 * predates this file and named it in advance — *"today nothing writes it at
 * all; the writer arrives with Apple IAP (E8). This assertion is what makes
 * that arrival deliberate."* This is that arrival.
 *
 * A user-writable entitlement is a free subscription, and the failure has no
 * symptom: revenue goes quietly to zero while every security check stays green.
 *
 * ── ⚠ Refusing to write is a feature of this file ───────────────────────────
 *
 * `20260818120000` adds the five columns a subscription actually needs, and it
 * is **written, not applied** — this repo applies migrations by hand, so the
 * code and the schema are routinely out of step in both directions
 * (`CLAUDE.md` §2). The interesting question is what to do in that window.
 *
 * The tempting answer is to degrade: write what fits and skip the rest. That is
 * wrong here, and specifically because of `last_signed_date`. Without it there
 * is no ordering guard, and Apple does not deliver notifications in order — so
 * a degraded write is not a partial success, it is an entitlement that can be
 * silently rewound by a retry arriving late. Money in both directions, no error
 * anywhere.
 *
 * So a missing column is a **refusal**, reported as `schema-not-ready`. The
 * caller turns that into a 5xx, Apple retries for up to three days, and the
 * notification lands intact once the migration is applied. Nothing is lost, and
 * nothing unguarded is ever stored.
 */

import { logger } from '@wellkept/core/logger';
import {
  applyAppleNotification,
  type AppleSubscriptionEvent,
  type StoredEntitlement,
} from '@wellkept/core/apple-subscription';

import { getServiceRoleClient } from '@/lib/supabase';

/** Postgres `undefined_column`. The cheapest applied/not check there is. */
const UNDEFINED_COLUMN = '42703';
/** PostgREST's own "I cannot see that column in my schema cache". */
const POSTGREST_UNKNOWN_COLUMN = 'PGRST204';

const TABLE = 'account_entitlements';

/**
 * Columns this file reads and writes, in one list so the SELECT and the
 * schema-readiness check cannot disagree about what "ready" means.
 */
const COLUMNS = [
  'user_id',
  'tier',
  'expires_at',
  'original_transaction_id',
  'product_id',
  'environment',
  'auto_renew_status',
  'revoked_at',
  'latest_transaction_id',
  'last_signed_date',
].join(',');

export type EntitlementWriteOutcome =
  | { ok: true; applied: true; tier: string }
  /** Correctly declined — a stale or irrelevant notification. Not an error. */
  | { ok: true; applied: false; reason: string }
  /** The migration has not been applied. Retryable, and Apple will retry. */
  | { ok: false; reason: 'schema-not-ready'; detail: string }
  | { ok: false; reason: 'read-failed' | 'write-failed'; detail: string };

/**
 * Apply one verified Apple event to one account's entitlement.
 *
 * The event must already have been verified — this function does no signature
 * checking and takes its input on trust, which is safe only because its two
 * callers hand it the output of `verifyAppleSignedPayload`. That split is the
 * same one `vehicle-research.ts` documents: a function that authorizes nothing
 * is fine as long as the list of callers that authorize *for* it stays closed.
 */
export async function applyVerifiedAppleEvent(
  userId: string,
  event: AppleSubscriptionEvent
): Promise<EntitlementWriteOutcome> {
  const supabase = getServiceRoleClient();

  const { data, error: readError } = await supabase
    .from(TABLE)
    .select(COLUMNS)
    .eq('user_id', userId)
    .maybeSingle();

  if (readError) {
    if (isMissingColumn(readError)) {
      /*
        Loud on purpose. This is a deployment state, not a user problem, and
        the only thing that fixes it is somebody applying the migration.
      */
      logger.error(
        'ENTITLEMENT:APPLE',
        new Error('account_entitlements is missing E8 columns; refusing an unguarded write'),
        { code: readError.code, message: readError.message }
      );
      return { ok: false, reason: 'schema-not-ready', detail: readError.message };
    }

    logger.error('ENTITLEMENT:APPLE', new Error('failed to read entitlement'), {
      code: readError.code,
      message: readError.message,
    });
    return { ok: false, reason: 'read-failed', detail: readError.message };
  }

  const decision = applyAppleNotification(toStored(data), event);

  if (decision.action === 'ignore') {
    /*
      Info, not warn. Every one of these is the system working: a duplicate
      delivery, a notification type that says nothing about access, or a
      sandbox event correctly refused. Logging them as problems would train
      whoever reads this to skip them, and one of them — the sandbox refusal —
      is worth being able to find.
    */
    logger.info('ENTITLEMENT:APPLE', 'entitlement notification ignored', {
      reason: decision.reason,
      detail: decision.detail,
      notificationType: event.notificationType,
    });
    return { ok: true, applied: false, reason: decision.reason };
  }

  if (decision.warning) {
    logger.error('ENTITLEMENT:APPLE', new Error(decision.warning), {
      productId: event.productId,
    });
  }

  const record = decision.record;
  const { error: writeError } = await supabase.from(TABLE).upsert(
    {
      user_id: userId,
      tier: record.tier,
      expires_at: record.expiresAt,
      original_transaction_id: record.originalTransactionId,
      product_id: record.productId,
      environment: record.environment,
      auto_renew_status: record.autoRenewStatus,
      revoked_at: record.revokedAt,
      latest_transaction_id: record.latestTransactionId,
      last_signed_date: record.lastSignedDate,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  );

  if (writeError) {
    if (isMissingColumn(writeError)) {
      logger.error(
        'ENTITLEMENT:APPLE',
        new Error('account_entitlements is missing E8 columns; refusing an unguarded write'),
        { code: writeError.code, message: writeError.message }
      );
      return { ok: false, reason: 'schema-not-ready', detail: writeError.message };
    }

    logger.error('ENTITLEMENT:APPLE', new Error('failed to write entitlement'), {
      code: writeError.code,
      message: writeError.message,
    });
    return { ok: false, reason: 'write-failed', detail: writeError.message };
  }

  logger.info('ENTITLEMENT:APPLE', 'entitlement updated from Apple', {
    tier: record.tier,
    notificationType: event.notificationType,
    environment: record.environment,
  });

  return { ok: true, applied: true, tier: record.tier };
}

/**
 * Find the account a notification belongs to.
 *
 * Apple's notifications carry an `original_transaction_id` and no user — the
 * association is one **we** made at purchase time, through
 * `/api/v1/iap/verify`, which is the only place a signed-in session and a
 * transaction are both present.
 *
 * A notification for a transaction we have never seen is therefore not an
 * error and not an attack: it is a purchase whose verify call has not landed
 * yet, or one made against this bundle id by a sandbox account that never
 * signed in. The caller acknowledges it rather than retrying forever.
 */
export async function findUserByOriginalTransactionId(
  originalTransactionId: string
): Promise<{ ok: true; userId: string | null } | { ok: false; detail: string }> {
  const supabase = getServiceRoleClient();

  const { data, error } = await supabase
    .from(TABLE)
    .select('user_id')
    .eq('original_transaction_id', originalTransactionId)
    .maybeSingle();

  if (error) {
    return { ok: false, detail: error.message };
  }

  return { ok: true, userId: (data as { user_id?: string } | null)?.user_id ?? null };
}

function isMissingColumn(error: { code?: string | null } | null | undefined): boolean {
  const code = error?.code;
  return code === UNDEFINED_COLUMN || code === POSTGREST_UNKNOWN_COLUMN;
}

/** PostgREST row → the camelCase shape the decision layer reads. */
function toStored(row: unknown): StoredEntitlement | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  return {
    tier: (r.tier as string) ?? null,
    expiresAt: (r.expires_at as string) ?? null,
    originalTransactionId: (r.original_transaction_id as string) ?? null,
    productId: (r.product_id as string) ?? null,
    environment: (r.environment as string) ?? null,
    autoRenewStatus: (r.auto_renew_status as boolean) ?? null,
    revokedAt: (r.revoked_at as string) ?? null,
    latestTransactionId: (r.latest_transaction_id as string) ?? null,
    lastSignedDate: (r.last_signed_date as string) ?? null,
  };
}
