import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@wellkept/core/logger';
import { checkRateLimit, getClientIdentifier, rateLimitResponse } from '@/lib/rate-limit';
import { authorizeVehicleScopedRow } from '@/lib/api-auth';
import { recomputePerformanceStats } from '@/lib/performance-stats';

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

    // Resolves the item's parent vehicle and proves the caller owns it before
    // any privileged client is handed back. Demo items are rejected outright —
    // demo data is shared, so a write would corrupt it for every visitor.
    const access = await authorizeVehicleScopedRow('wishlist_items', itemId, {
      intent: 'write',
    });
    if (!access.ok) {
      return access.response;
    }

    const client = access.client;

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
        /*
          Attributed, because the history screen shows provenance per row and an
          unattributed one is indistinguishable from a record that predates the
          column. `'manual'` is the right value: a person in the app said this
          happened. Not `'vision'` — no document was read — and not
          `'owner-onboarding'`, which `20260808150000` reserved for a
          recollection given during sign-up.
        */
        source: 'manual',
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
      /*
        Completing a mod changes the vehicle's service history, so its
        performance stats are now stale. Recomputed in process.

        This used to POST to `${request.nextUrl.origin}/api/performance-stats`
        with the caller's session cookie forwarded, so the inner route could
        authorize the hop. `nextUrl.origin` comes from the request's host
        headers, which made the destination of a request carrying a user's
        session cookie depend on a header the caller influences and on whether
        the platform in front of the app normalises it — a safety property
        owned by someone else's proxy config, invisible to every test here,
        and able to change without this code changing.

        Calling directly removes the question. `access` above already proved
        write access to this item's parent vehicle, which is strictly better
        evidence than a re-derived cookie, and `intent: 'write'` means a demo
        vehicle never reaches here.

        Best-effort and deliberately not awaited: the stats are derived display
        data, the dashboard recomputes on next view because the mod hash will
        differ, and marking an item complete should not wait on Gemini.
      */
      const rateLimit = await checkRateLimit(access.userId ?? identifier, 'ai');
      if (rateLimit.allowed) {
        recomputePerformanceStats({
          vehicleId: wishlistItem.vehicle_id,
          client,
          isDemo: false,
        }).catch(err => {
          logger.error('WISHLIST_COMPLETE:PERF_RECALC', err as Error, { vehicleId: wishlistItem.vehicle_id });
        });
      } else {
        logger.warn('WISHLIST_COMPLETE:PERF_RECALC_RATE_LIMIT', 'Skipped stat recompute', {
          vehicleId: wishlistItem.vehicle_id,
        });
      }
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
