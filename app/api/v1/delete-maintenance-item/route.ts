import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import type { ApiResponse } from '@/lib/types';
import { checkRateLimit, getClientIdentifier, rateLimitResponse } from '@/lib/rate-limit';
import { authorizeVehicleScopedRow, type VehicleScopedTable } from '@/lib/api-auth';

/**
 * Client-supplied item types map to a fixed set of tables. The map is the
 * allowlist — an unrecognised itemType can never reach a table name.
 */
const TABLE_BY_ITEM_TYPE: Record<string, VehicleScopedTable> = {
  invoice_line_item: 'invoice_line_items',
  service_item: 'service_items',
  maintenance_line_item: 'maintenance_line_items',
  document: 'vehicle_documents',
};

export async function POST(request: NextRequest): Promise<Response> {
  logger.info('API:DELETE_ITEM', 'Delete request received');

  const identifier = getClientIdentifier(request);
  const rateLimit = await checkRateLimit(identifier, 'default');
  if (!rateLimit.allowed) {
    logger.warn('API:DELETE_ITEM', 'Rate limit exceeded', { identifier });
    return rateLimitResponse(rateLimit);
  }

  try {
    const body = await request.json();
    const { itemId, itemType } = body as { itemId?: string; itemType?: string };

    if (!itemId || !itemType) {
      logger.warn('API:DELETE_ITEM', 'Missing required parameters', {
        itemId: !!itemId,
        itemType: !!itemType,
      });
      return NextResponse.json(
        { success: false, error: 'Missing itemId or itemType' } as ApiResponse,
        { status: 400 }
      );
    }

    const tableName = TABLE_BY_ITEM_TYPE[itemType];
    if (!tableName) {
      logger.warn('API:DELETE_ITEM', 'Invalid item type', { itemType });
      return NextResponse.json(
        { success: false, error: 'Invalid item type' } as ApiResponse,
        { status: 400 }
      );
    }

    // Previously this route built an anon client with no session attached, so
    // RLS refused every delete and the route reported success anyway. Ownership
    // is now proven up front and the delete runs with a client that can act.
    const access = await authorizeVehicleScopedRow(tableName, itemId, {
      intent: 'write',
    });
    if (!access.ok) {
      return access.response;
    }

    const { error, count } = await access.client
      .from(tableName)
      .delete({ count: 'exact' })
      .eq('id', itemId);

    if (error) {
      logger.error('API:DELETE_ITEM', new Error(error.message), {
        tableName,
        itemId,
        code: error.code,
      });
      return NextResponse.json(
        { success: false, error: 'Failed to delete item' } as ApiResponse,
        { status: 500 }
      );
    }

    // The bug this route is named for: a delete that matched zero rows is not
    // a success. Never report one.
    if (count === 0) {
      logger.warn('API:DELETE_ITEM', 'Delete matched no rows', { tableName, itemId });
      return NextResponse.json(
        { success: false, error: 'Item not found' } as ApiResponse,
        { status: 404 }
      );
    }

    logger.info('API:DELETE_ITEM', 'Item deleted successfully', { tableName, itemType, itemId });

    return NextResponse.json({
      success: true,
      message: `Successfully deleted ${itemType}`,
    } as ApiResponse);
  } catch (error) {
    logger.error('API:DELETE_ITEM', error as Error);
    return NextResponse.json(
      { success: false, error: 'Delete failed' } as ApiResponse,
      { status: 500 }
    );
  }
}
