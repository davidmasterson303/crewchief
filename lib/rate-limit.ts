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

    const { data: existing, error: fetchError } = await client
      .from('api_rate_limits')
      .select('id, request_count')
      .eq('identifier', identifier)
      .eq('endpoint', tier)
      .eq('window_start', windowStart.toISOString())
      .maybeSingle();

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
export function getClientIdentifier(request: Request): string {
  const headers = request.headers as Headers;

  const platform = platformClientIp((name) => headers.get(name));
  if (platform) return platform;

  const forwarded = headers.get('x-forwarded-for');
  const realIp = headers.get('x-real-ip');

  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  if (realIp) {
    return realIp;
  }
  return 'unknown';
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
