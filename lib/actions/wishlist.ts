'use server';

import { getServiceRoleClient } from '@/lib/supabase';
import { logger } from '@/lib/logger';

type WishlistItemType = 'issue' | 'maintenance' | 'modification';

const CATEGORY_MAP: Record<WishlistItemType, string> = {
  issue: 'repair',
  maintenance: 'maintenance',
  modification: 'modification',
};

export async function addItemToWishlist(
  vehicleId: string,
  itemName: string,
  itemType: WishlistItemType
): Promise<{ success: boolean; error?: string; data?: unknown; alreadyExisted?: boolean }> {
  try {
    const client = getServiceRoleClient();
    const itemIdentifier = `dossier:${itemType}:${itemName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;

    const { data, error } = await client
      .from('wishlist_items')
      .insert({
        vehicle_id: vehicleId,
        item_type: itemType,
        item_name: itemName,
        item_identifier: itemIdentifier,
        category: CATEGORY_MAP[itemType],
        source: 'dossier',
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return { success: true, alreadyExisted: true };
      }
      logger.error('WISHLIST:ADD_ERROR', error as Error, { vehicleId, itemType });
      return { success: false, error: 'Failed to add to wishlist' };
    }

    return { success: true, data };
  } catch (error) {
    logger.error('WISHLIST:ADD_EXCEPTION', error as Error, { vehicleId, itemType });
    return { success: false, error: 'Failed to add to wishlist' };
  }
}

export async function addModificationToWishlist(
  vehicleId: string,
  modName: string
): Promise<{ success: boolean; error?: string; data?: unknown; alreadyExisted?: boolean }> {
  return addItemToWishlist(vehicleId, modName, 'modification');
}

export async function addIssueToWishlist(
  vehicleId: string,
  issueName: string
): Promise<{ success: boolean; error?: string; data?: unknown; alreadyExisted?: boolean }> {
  return addItemToWishlist(vehicleId, issueName, 'issue');
}

export async function addMaintenanceItemToWishlist(
  vehicleId: string,
  itemName: string
): Promise<{ success: boolean; error?: string; data?: unknown; alreadyExisted?: boolean }> {
  return addItemToWishlist(vehicleId, itemName, 'maintenance');
}

export async function removeFromWishlist(
  vehicleId: string,
  itemName: string,
  itemType?: WishlistItemType
): Promise<{ success: boolean; error?: string }> {
  try {
    const client = getServiceRoleClient();

    if (itemType) {
      const itemIdentifier = `dossier:${itemType}:${itemName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
      const { error } = await client
        .from('wishlist_items')
        .delete()
        .eq('vehicle_id', vehicleId)
        .eq('item_identifier', itemIdentifier);

      if (error) {
        logger.error('WISHLIST:REMOVE_ERROR', error as Error, { vehicleId, itemType });
        return { success: false, error: `Database error: ${error.message}` };
      }
    } else {
      const { error } = await client
        .from('wishlist_items')
        .delete()
        .eq('vehicle_id', vehicleId)
        .eq('item_name', itemName);

      if (error) {
        logger.error('WISHLIST:REMOVE_LEGACY_ERROR', error as Error, { vehicleId });
        return { success: false, error: `Database error: ${error.message}` };
      }
    }

    return { success: true };
  } catch (error) {
    logger.error('WISHLIST:REMOVE_EXCEPTION', error as Error, { vehicleId });
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function getWishlistItems(vehicleId: string) {
  try {
    const client = getServiceRoleClient();
    const { data, error } = await client
      .from('wishlist_items')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('WISHLIST:GET_ERROR', error as Error, { vehicleId });
      return { success: false, data: [] };
    }

    return { success: true, data: data || [] };
  } catch (error) {
    logger.error('WISHLIST:GET_EXCEPTION', error as Error, { vehicleId });
    return { success: false, data: [] };
  }
}
