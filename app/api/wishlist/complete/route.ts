import { NextRequest, NextResponse } from 'next/server';
import { getServiceRoleClient } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { checkRateLimit, getClientIdentifier, rateLimitResponse } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const identifier = getClientIdentifier(request);
  const rateLimit = await checkRateLimit(identifier, 'default');
  if (!rateLimit.allowed) {
    logger.warn('WISHLIST_COMPLETE:RATE_LIMIT', 'Rate limit exceeded', { identifier });
    return rateLimitResponse(rateLimit);
  }

  try {
    const body = await request.json();
    const {
      itemId,
      serviceDate,
      shopName,
      isDIY,
      partsCost,
      laborCost,
      notes,
      invoiceFile,
    } = body;

    if (!itemId) {
      return NextResponse.json(
        { error: 'itemId is required' },
        { status: 400 }
      );
    }

    const client = getServiceRoleClient();

    const { data: wishlistItem, error: fetchError } = await client
      .from('wishlist_items')
      .select('*')
      .eq('id', itemId)
      .maybeSingle();

    if (fetchError || !wishlistItem) {
      logger.error('WISHLIST_COMPLETE:FETCH', fetchError as Error, { itemId });
      return NextResponse.json(
        { error: 'Wishlist item not found' },
        { status: 404 }
      );
    }

    let documentId = null;
    if (invoiceFile) {
      const { data: document, error: docError } = await client
        .from('vehicle_documents')
        .insert({
          vehicle_id: wishlistItem.vehicle_id,
          document_type: 'invoice',
          file_url: invoiceFile.url,
          extraction_status: 'completed',
        })
        .select()
        .single();

      if (docError) {
        logger.error('WISHLIST_COMPLETE:DOC_INSERT', docError as Error, { itemId });
      } else {
        documentId = document.id;
      }
    }

    const totalCost = (partsCost || 0) + (laborCost || 0);

    const { data: maintenanceItem, error: insertError } = await client
      .from('maintenance_line_items')
      .insert({
        vehicle_id: wishlistItem.vehicle_id,
        service_date: serviceDate || new Date().toISOString().split('T')[0],
        shop_name: isDIY ? 'DIY' : shopName || 'Unknown',
        item_description: wishlistItem.item_name,
        category: wishlistItem.category || 'other',
        parts_cost: partsCost || 0,
        labor_cost: laborCost || 0,
        total_cost: totalCost,
        source_document_id: documentId,
        notes: notes || wishlistItem.notes,
        quantity: 1,
        unit_cost: totalCost,
      })
      .select()
      .single();

    if (insertError) {
      logger.error('WISHLIST_COMPLETE:MAINTENANCE_INSERT', insertError as Error, { itemId });
      return NextResponse.json(
        { error: 'Failed to create maintenance record' },
        { status: 500 }
      );
    }

    const { error: deleteError } = await client
      .from('wishlist_items')
      .delete()
      .eq('id', itemId);

    if (deleteError) {
      logger.error('WISHLIST_COMPLETE:DELETE', deleteError as Error, { itemId });
    }

    if (wishlistItem.item_type === 'modification') {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const baseUrl = request.nextUrl.origin;
      fetch(`${baseUrl}/api/performance-stats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicleId: wishlistItem.vehicle_id }),
        signal: controller.signal,
      })
        .then(() => clearTimeout(timeout))
        .catch(err => {
          clearTimeout(timeout);
          logger.error('WISHLIST_COMPLETE:PERF_RECALC', err as Error, { vehicleId: wishlistItem.vehicle_id });
        });
    }

    return NextResponse.json({
      success: true,
      maintenanceItem,
    });
  } catch (error) {
    logger.error('WISHLIST_COMPLETE:EXCEPTION', error as Error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
