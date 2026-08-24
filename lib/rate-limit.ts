import { getServiceRoleClient } from './supabase';
import { logger } from '@crewchief/core/logger';
import { platformClientIp } from '@crewchief/core/client-ip';

export type RateLimitTier = 'ai' | 'upload' | 'default';

interface RateLimitConfig {
  windowSeconds: number;
  maxRequests: number;
}

const TIER_CONFIG: Record<RateLimitTier, RateLimitConfig> = {
  ai: {
    windowSeconds: 60,
    maxRequests: 10,
  },
  upload: {
    windowSeconds: 60,
    maxRequests: 5,
  },
  default: {
    windowSeconds: 60,
    maxRequests: 60,
  },
};

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  retryAfterSeconds: number;
}

export async function checkRateLimit(
  identifier: string,
  tier: RateLimitTier = 'default'
): Promise<RateLimitResult> {
  const config = TIER_CONFIG[tier];
  const now = new Date();
  const windowStart = new Date(
    Math.floor(now.getTime() / (config.windowSeconds * 1000)) * (config.windowSeconds * 1000)
  );
  const resetAt = new Date(windowStart.getTime() + config.windowSeconds * 1000);

  try {
    const client = getServiceRoleClient();

    /*
      ── ⚠ SEC-05 · the atomic path ────────────────────────────────────────────

      `consume_rate_limit` is one statement — `INSERT … ON CONFLICT … DO UPDATE
      SET request_count = request_count + 1 RETURNING` — so there is no interval
      in which two callers can both believe they are first.

      What it replaces was read-then-insert against a table with **no unique
      constraint**, and the consequence was not a lost count. Two concurrent
      requests both inserted; every later `.maybeSingle()` in that window hit two
      rows, PostgREST answered `PGRST116`, and that landed in the `fetchError`
      branch below — which **returns `allowed: true` with a full allowance**.
      The limiter switched off for that identifier for the rest of the window,
      and an attacker triggered it deliberately with two parallel requests at
      each boundary. It defeated the `ai` (10/min) and `upload` (5/min) tiers,
      the two standing in front of Gemini spend.

      ⚠ The fallback below is **not** dead code and must not be deleted as
      such. `CLAUDE.md` §2: the database and the migrations folder disagree in
      both directions, and this function arrives in `20260824110000`. A deploy
      carrying this file can reach production before somebody runs it, and a
      limiter that throws because an RPC is missing is a limiter that takes the
      product down. It is loud and it is temporary — delete it once the
      migration is confirmed applied.
    */
    const { data: atomicCount, error: rpcError } = await client.rpc('consume_rate_limit', {
      p_identifier: identifier,
      p_endpoint: tier,
      p_window_start: windowStart.toISOString(),
    });

    if (!rpcError && typeof atomicCount === 'number') {
      const allowed = atomicCount <= config.maxRequests;

      if (!allowed) {
        logger.warn('RATE_LIMIT:EXCEEDED', 'Rate limit exceeded', {
          identifier,
          tier,
          count: atomicCount,
          limit: config.maxRequests,
        });
      }

      if (atomicCount === 1) cleanupExpiredWindows(client, tier);

      return {
        allowed,
        remaining: Math.max(0, config.maxRequests - atomicCount),
        resetAt,
        retryAfterSeconds: allowed
          ? 0
          : Math.ceil((resetAt.getTime() - now.getTime()) / 1000),
      };
    }

    logger.error(
      'RATE_LIMIT:RPC_MISSING',
      new Error(
        `consume_rate_limit is unavailable (${rpcError?.code ?? 'no result'}) — run migration 20260824110000`
      ),
      { tier }
    );

    /*
      ⚠ **Summed, not `.maybeSingle()`.** Without the unique constraint a window
      can genuinely hold more than one row, and asking for a single one turns
      that into an error which fails *open*. Adding the counts up is the honest
      reading — every row records requests that actually happened — and it makes
      the duplicate-window state costly to the attacker rather than free.
    */
    const { data: rows, error: fetchError } = await client
      .from('api_rate_limits')
      .select('id, request_count')
      .eq('identifier', identifier)
      .eq('endpoint', tier)
      .eq('window_start', windowStart.toISOString())
      .order('id', { ascending: true });

    const existing =
      rows && rows.length > 0
        ? {
            id: rows[0].id,
            request_count: rows.reduce((sum, row) => sum + (row.request_count ?? 0), 0),
          }
        : null;

    if (fetchError) {
      logger.warn('RATE_LIMIT:FETCH', 'Failed to fetch rate limit record, allowing request', {
        identifier,
        tier,
        error: fetchError.message,
      });
      return {
        allowed: true,
        remaining: config.maxRequests,
        resetAt,
        retryAfterSeconds: 0,
      };
    }

    if (existing) {
      const newCount = existing.request_count + 1;
      const allowed = newCount <= config.maxRequests;

      if (allowed) {
        await client
          .from('api_rate_limits')
          .update({ request_count: newCount, updated_at: now.toISOString() })
          .eq('id', existing.id);
      } else {
        logger.warn('RATE_LIMIT:EXCEEDED', 'Rate limit exceeded', {
          identifier,
          tier,
          count: newCount,
          limit: config.maxRequests,
        });
      }

      const retryAfterSeconds = allowed ? 0 : Math.ceil((resetAt.getTime() - now.getTime()) / 1000);

      return {
        allowed,
        remaining: Math.max(0, config.maxRequests - newCount),
        resetAt,
        retryAfterSeconds,
      };
    }

    await client.from('api_rate_limits').insert({
      identifier,
      endpoint: tier,
      window_start: windowStart.toISOString(),
      request_count: 1,
    });

    cleanupExpiredWindows(client, tier);

    return {
      allowed: true,
      remaining: config.maxRequests - 1,
      resetAt,
      retryAfterSeconds: 0,
    };
  } catch (error) {
    logger.warn('RATE_LIMIT:ERROR', 'Rate limit check failed, allowing request', {
      identifier,
      tier,
      error: (error as Error).message,
    });
    return {
      allowed: true,
      remaining: config.maxRequests,
      resetAt,
      retryAfterSeconds: 0,
    };
  }
}

function cleanupExpiredWindows(client: ReturnType<typeof getServiceRoleClient>, tier: RateLimitTier) {
  const config = TIER_CONFIG[tier];
  const cutoff = new Date(Date.now() - config.windowSeconds * 10 * 1000);

  client
    .from('api_rate_limits')
    .delete()
    .eq('endpoint', tier)
    .lt('window_start', cutoff.toISOString())
    .then(({ error }) => {
      if (error) {
        logger.warn('RATE_LIMIT:CLEANUP', 'Failed to clean up expired rate limit records', {
          error: error.message,
        });
      }
    });
}

/**
 * A bucket key for a request.
 *
 * ── The platform address is preferred, and it is the only unspoofable one ───
 *
 * `cc-tech-0003` at high confidence, and erratum T1: `X-Forwarded-For` is a
 * request header, so a caller can write a fresh value per request and land in a
 * fresh bucket every time. A limiter keyed on it counts to one forever while
 * reporting that it works. `platformClientIp` reads only headers the edge
 * *sets* from the connection rather than forwards — see that module for the
 * trust assumption, which is about the host and not about the transport.
 *
 * ── Why the spoofable fallback is still here ────────────────────────────────
 *
 * Because removing it could be worse than the weakness. If the platform header
 * is ever absent in production — and that could not be verified from a
 * development machine without deploying something that echoes request headers —
 * then a platform-only version collapses **all** traffic onto `'unknown'`, one
 * shared 60/minute bucket, and the first bot takes the demo down for every real
 * visitor. That is a live outage traded for a hardening.
 *
 * So the order is: platform address, then the old behaviour unchanged. This is
 * **strictly no worse than before anywhere, and strictly better wherever the
 * platform supplies an address** — which on Netlify is every externally
 * originated request, since the edge sets it from the peer address. The
 * fallback is then reached only in local development.
 *
 * ── What this deliberately does not fix ─────────────────────────────────────
 *
 * It is still an IP bucket, and IP buckets are a secondary control. The six
 * callers are all authenticated routes where this is not the security
 * boundary — RLS and `lib/api-auth.ts` are — and all six call it *before*
 * authenticating, so the account id that would be the correct key is not
 * available yet. Reordering those handlers is a real change with real
 * behavioural risk and is not smuggled in here.
 *
 * **The anonymous front door must not use this function.** Its primary control
 * is the spend ceiling in `lib/ai-budget.ts`, and its secondary bucket keys on
 * `platformClientIp` directly, with `null` meaning the bucket does not apply
 * rather than meaning `'unknown'`.
 */
export function getClientIdentifier(
  request: Request,
  /**
   * Which allowance this identifier will be spent against.
   *
   * Optional and defaulting to `default` so every existing call site keeps the
   * behaviour it was written with. The two that gate spend pass it — see the
   * note below on why a caller-supplied address may not buy a private bucket
   * there.
   */
  tier: RateLimitTier = 'default'
): string {
  const headers = request.headers as Headers;

  const platform = platformClientIp((name) => headers.get(name));
  if (platform) return platform;

  /*
    ── ⚠ SEC-15 · a caller-supplied header may not buy a private allowance ────

    `x-forwarded-for` and `x-real-ip` are **set by the caller**. A limiter keyed
    on them is a limiter whose bucket the caller chooses: send a fresh one per
    request and every request is a new identity with a full allowance.
    `packages/core/src/client-ip.ts` says exactly this and forbids the fallback:

      *"an attacker can **cause** the platform header to be missing by not being
      behind the edge."*

    ⚠ **The fallback is kept anyway, and that is not an oversight.** The
    decision is recorded in `front-door-controls.test.ts:222-235` with its
    reasoning: a platform-only version collapses every request onto one shared
    bucket if `x-nf-client-connection-ip` is ever absent in production, which
    trades a hardening for a live outage on the recruiter-facing demo — and
    could not be verified from a development machine. That argument still holds
    and I could not settle it from here either.

    So the fallback narrows instead of disappearing. **The tier decides whether
    a caller-supplied identity is trusted**, because the two questions have
    different answers:

      `default`          browsing traffic, 60/min, nothing spent. A per-caller
                         bucket here is worth more than the abuse it permits,
                         and this is the tier the outage argument is about.

      `ai` / `upload`    the two standing in front of Gemini spend. An
                         unverifiable caller gets a **shared** bucket, so
                         claiming a new identity buys nothing. Worst case a
                         genuinely un-attributable user waits — which costs them
                         a minute, not us a bill.

    ⚠ The check that would let the fallback go entirely: confirm
    `x-nf-client-connection-ip` is present on **every** request to a deployed
    function, on both Netlify sites. If it is, delete everything below the
    platform lookup and this comment with it.
  */
  const forwarded = headers.get('x-forwarded-for');
  const realIp = headers.get('x-real-ip');
  const claimed = forwarded ? forwarded.split(',')[0].trim() : realIp;

  if (!claimed) return 'unknown';

  return tier === 'default' ? claimed : `unverified:${tier}`;
}

export function rateLimitResponse(result: RateLimitResult): Response {
  return Response.json(
    {
      success: false,
      error: 'Too many requests. Please slow down.',
      retryAfterSeconds: result.retryAfterSeconds,
    },
    {
      status: 429,
      headers: {
        'Retry-After': String(result.retryAfterSeconds),
        'X-RateLimit-Remaining': String(result.remaining),
        'X-RateLimit-Reset': result.resetAt.toISOString(),
      },
    }
  );
}
