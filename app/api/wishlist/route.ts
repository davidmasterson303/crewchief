import { NextRequest, NextResponse } from 'next/server';
import { getServiceRoleClient, getServerClient, createServerActionClient } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { checkRateLimit, getClientIdentifier, rateLimitResponse } from '@/lib/rate-limit';
import { isDemoVehicleId } from '@/lib/demo';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const identifier = getClientIdentifier(request);
  const rateLimit = await checkRateLimit(identifier, 'default');
  if (!rateLimit.allowed) {
    logger.warn('WISHLIST_API:RATE_LIMIT', 'Rate limit exceeded', { identifier });
    return rateLimitResponse(rateLimit);
  }

  try {
    const { searchParams } = new URL(request.url);
    const vehicleId = searchParams.get('vehicleId');

    if (!vehicleId) {
      return NextResponse.json({ error: 'vehicleId is required' }, { status: 400 });
    }

    if (!isDemoVehicleId(vehicleId)) {
      const authClient = createServerActionClient();
      const { data: { user }, error: authError } = await authClient.auth.getUser();
      if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      const { data: ownership } = await authClient
        .from('vehicles').select('id').eq('id', vehicleId).eq('user_id', user.id).maybeSingle();
      if (!ownership) {
        return NextResponse.json({ error: 'Vehicle not found' }, { status: 404 });
      }
    }

    // Demo vehicles: use anon client — SELECT policy allows public reads for is_demo=true rows.
    // Real vehicles: use service role (auth already verified above).
    const client = isDemoVehicleId(vehicleId) ? getServerClient() : getServiceRoleClient();

    const { data: wishlistItems, error } = await client
      .from('wishlist_items')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('WISHLIST_API:GET', error as Error, { vehicleId });
      return NextResponse.json({ error: 'Failed to fetch wishlist items' }, { status: 500 });
    }

    return NextResponse.json({ wishlistItems });
  } catch (error) {
    logger.error('WISHLIST_API:GET_EXCEPTION', error as Error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      vehicleId,
      itemType,
      itemName,
      itemIdentifier,
      description,
      category,
      estimatedCostParts,
      estimatedCostLabor,
      estimatedLaborHours,
      notes,
      source,
      sourceData,
    } = body;

    if (!vehicleId || !itemType || !itemName || !itemIdentifier) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (!['issue', 'maintenance', 'modification'].includes(itemType)) {
      return NextResponse.json({ error: 'Invalid item type' }, { status: 400 });
    }

    const client = getServiceRoleClient();

    const { data: existingItem } = await client
      .from('wishlist_items')
      .select('id')
      .eq('vehicle_id', vehicleId)
      .eq('item_identifier', itemIdentifier)
      .maybeSingle();

    if (existingItem) {
      return NextResponse.json(
        { error: 'Item already in wishlist', itemId: existingItem.id },
        { status: 409 }
      );
    }

    const { data: wishlistItem, error } = await client
      .from('wishlist_items')
      .insert({
        vehicle_id: vehicleId,
        item_type: itemType,
        item_name: itemName,
        item_identifier: itemIdentifier,
        description: description || null,
        category: category || null,
        estimated_cost_parts: estimatedCostParts || 0,
        estimated_cost_labor: estimatedCostLabor || 0,
        estimated_labor_hours: estimatedLaborHours || 0,
        notes: notes || null,
        source: source || 'manual',
        source_data: sourceData || {},
      })
      .select()
      .single();

    if (error) {
      logger.error('WISHLIST_API:POST', error as Error, { vehicleId, itemType });
      return NextResponse.json({ error: 'Failed to add item to wishlist' }, { status: 500 });
    }

    return NextResponse.json({ wishlistItem }, { status: 201 });
  } catch (error) {
    logger.error('WISHLIST_API:POST_EXCEPTION', error as Error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const itemId = searchParams.get('itemId');

    if (!itemId) {
      return NextResponse.json({ error: 'itemId is required' }, { status: 400 });
    }

    const client = getServiceRoleClient();

    const { error } = await client
      .from('wishlist_items')
      .delete()
      .eq('id', itemId);

    if (error) {
      logger.error('WISHLIST_API:DELETE', error as Error, { itemId });
      return NextResponse.json({ error: 'Failed to delete wishlist item' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('WISHLIST_API:DELETE_EXCEPTION', error as Error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
