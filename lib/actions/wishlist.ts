'use server';

import { authorizeVehicleAccess } from '@/lib/api-auth';
import { logger } from '@crewchief/core/logger';
import { wishlistItemIdentifier } from '@crewchief/core/wishlist-identifier';

/*
 * These are 'use server' exports, which Next.js compiles into POST endpoints
 * whose action IDs ship in the client bundle. That makes each one remotely
 * callable on its own terms, so the guard belongs HERE, at the privileged
 * call — not in the app/actions.ts wrappers that re-export them.
 *
 * That distinction is what went wrong: the wrappers were bare pass-throughs,
 * and the Phase 0 ratchet reads one function body at a time looking for
 * getServiceRoleClient(. A pass-through contains no such call, so every one of
 * these was skipped by the check meant to catch exactly this.
 *
 * The demo path does not come through here — hooks/useWishlist.ts branches to
 * a cache-only toggle for demo vehicles — so 'write' is safe. Reads stay
 * 'read' so the demo garage can still load its pre-seeded items via anon.
 */

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
    const access = await authorizeVehicleAccess(vehicleId, { intent: 'write' });
    if (!access.ok) {
      return { success: false, error: access.error };
    }

    const client = access.client;
    const itemIdentifier = wishlistItemIdentifier(itemType, itemName);

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
    const access = await authorizeVehicleAccess(vehicleId, { intent: 'write' });
    if (!access.ok) {
      return { success: false, error: access.error };
    }

    const client = access.client;

    if (itemType) {
      const itemIdentifier = wishlistItemIdentifier(itemType, itemName);
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
    // 'read', not 'write': the demo garage loads its pre-seeded wishlist on
    // page view, and authorizeVehicleAccess hands back an anon client for that
    // case — RLS-scoped to is_demo rows, which is exactly the access it needs.
    const access = await authorizeVehicleAccess(vehicleId, { intent: 'read' });
    if (!access.ok) {
      return { success: false, data: [] };
    }

    const client = access.client;
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
