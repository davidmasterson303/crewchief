import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import type { ApiResponse } from '@/lib/types';
import { checkRateLimit, getClientIdentifier, rateLimitResponse } from '@/lib/rate-limit';

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

    logger.debug('API:DELETE_ITEM', 'Parsed request body', { itemType });

    if (!itemId || !itemType) {
      logger.warn('API:DELETE_ITEM', 'Missing required parameters', { itemId: !!itemId, itemType: !!itemType });
      return NextResponse.json(
        { success: false, error: 'Missing itemId or itemType' } as ApiResponse,
        { status: 400 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !anonKey) {
      logger.error('API:DELETE_ITEM', new Error('Missing environment variables'));
      return NextResponse.json(
        { success: false, error: 'Server configuration error' } as ApiResponse,
        { status: 500 }
      );
    }

    logger.debug('API:DELETE_ITEM', 'Creating Supabase client');

    const client = createClient(supabaseUrl, anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });

    let tableName: string;

    switch (itemType) {
      case 'invoice_line_item':
        tableName = 'invoice_line_items';
        break;
      case 'service_item':
        tableName = 'service_items';
        break;
      case 'maintenance_line_item':
        tableName = 'maintenance_line_items';
        break;
      case 'document':
        tableName = 'vehicle_documents';
        break;
      default:
        logger.warn('API:DELETE_ITEM', 'Invalid item type', { itemType });
        return NextResponse.json(
          { success: false, error: 'Invalid item type' } as ApiResponse,
          { status: 400 }
        );
    }

    logger.debug('API:DELETE_ITEM', 'Deleting item', { tableName, itemId });

    const { error } = await client
      .from(tableName)
      .delete()
      .eq('id', itemId);

    if (error) {
      logger.error('API:DELETE_ITEM', new Error(error.message), {
        tableName,
        itemId,
        details: error.details,
        hint: error.hint,
        code: error.code,
      });
      return NextResponse.json(
        {
          success: false,
          error: `Failed to delete: ${error.message}`,
          details: error.details,
          hint: error.hint
        } as ApiResponse,
        { status: 500 }
      );
    }

    logger.info('API:DELETE_ITEM', 'Item deleted successfully', { tableName, itemType, itemId });

    return NextResponse.json({
      success: true,
      message: `Successfully deleted ${itemType}`
    } as ApiResponse);
  } catch (error) {
    logger.error('API:DELETE_ITEM', error as Error);
    return NextResponse.json(
      {
        success: false,
        error: `Delete failed: ${(error as Error).message || 'Unknown error'}`
      } as ApiResponse,
      { status: 500 }
    );
  }
}
