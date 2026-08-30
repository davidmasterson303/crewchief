import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@wellkept/core/logger';
import { checkRateLimit, getClientIdentifier, rateLimitResponse } from '@/lib/rate-limit';
import { authorizeVehicleAccess } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const identifier = getClientIdentifier(request);
  const rateLimit = await checkRateLimit(identifier, 'default');
  if (!rateLimit.allowed) {
    logger.warn('WISHLIST_CHECK_API:RATE_LIMIT', 'Rate limit exceeded', { identifier });
    return rateLimitResponse(rateLimit);
  }

  try {
    const body = await request.json();
    const { vehicleId, itemIdentifiers } = body;

    if (!vehicleId || !Array.isArray(itemIdentifiers)) {
      return NextResponse.json(
        { error: 'vehicleId and itemIdentifiers array are required' },
        { status: 400 }
      );
    }

    const access = await authorizeVehicleAccess(vehicleId, { intent: 'read' });
    if (!access.ok) {
      return access.response;
    }

    const client = access.client;

    const { data: wishlistItems, error } = await client
      .from('wishlist_items')
      .select('item_identifier, id')
      .eq('vehicle_id', vehicleId)
      .in('item_identifier', itemIdentifiers);

    if (error) {
      logger.error('WISHLIST_CHECK_API:POST', error as Error, { vehicleId });
      return NextResponse.json({ error: 'Failed to check wishlist' }, { status: 500 });
    }

    const wishlistMap: Record<string, string> = {};
    wishlistItems?.forEach((item) => {
      wishlistMap[item.item_identifier] = item.id;
    });

    return NextResponse.json({ wishlistMap });
  } catch (error) {
    logger.error('WISHLIST_CHECK_API:POST_EXCEPTION', error as Error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
