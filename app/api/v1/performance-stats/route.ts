import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@crewchief/core/logger';
import { checkRateLimit, getClientIdentifier, rateLimitResponse } from '@/lib/rate-limit';
import { authorizeVehicleAccess } from '@/lib/api-auth';
import { recomputePerformanceStats } from '@/lib/performance-stats';

export const dynamic = 'force-dynamic';

/**
 * HTTP wrapper. The work is in `lib/performance-stats.ts` so that in-process
 * callers — `app/api/wishlist/complete/route.ts` — can reach it without an
 * internal HTTP request that had to carry a forwarded session cookie.
 */
export async function POST(request: NextRequest) {
  try {
    const { vehicleId, forceRefresh } = await request.json();

    // Authorize before spending anything: this route invokes Gemini, so an
    // unauthenticated caller must not get as far as the model.
    const access = await authorizeVehicleAccess(vehicleId, { intent: 'read' });
    if (!access.ok) {
      return access.response;
    }

    // Meter AI spend per user rather than per IP — IP is the wrong unit for a
    // cost control, since one user can hold many and many users share one.
    const identifier = access.userId ?? getClientIdentifier(request, 'ai');
    const rateLimit = await checkRateLimit(identifier, 'ai');
    if (!rateLimit.allowed) {
      logger.warn('PERF_STATS:RATE_LIMIT', 'Rate limit exceeded', { identifier });
      return rateLimitResponse(rateLimit) as NextResponse;
    }

    const result = await recomputePerformanceStats({
      vehicleId,
      client: access.client,
      isDemo: access.isDemo,
      forceRefresh,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      success: true,
      cached: result.cached,
      stats: result.stats,
    });
  } catch (error) {
    logger.error('PERF_STATS:EXCEPTION', error as Error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
