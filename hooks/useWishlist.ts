import { useState, useCallback, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { addIssueToWishlist, addMaintenanceItemToWishlist, addModificationToWishlist, removeFromWishlist } from '@/app/actions';
import { toast } from 'sonner';
import { invalidateDashboardCache } from '@wellkept/core/query-invalidation';
import { isDemoVehicleId } from '@wellkept/core/demo';

type ItemType = 'issue' | 'maintenance' | 'modification';

interface UseWishlistProps {
  vehicleId: string;
  itemName: string;
  itemType: ItemType;
  initialIsSaved: boolean;
  onToggleComplete?: () => Promise<void>;
}

export function useWishlist({
  vehicleId,
  itemName,
  itemType,
  initialIsSaved,
  onToggleComplete,
}: UseWishlistProps) {
  const isDemo = isDemoVehicleId(vehicleId);
  const queryClient = useQueryClient();
  const [isSaved, setIsSaved] = useState(initialIsSaved);
  const [isDemoLoading, setIsDemoLoading] = useState(false);

  // Stay in sync when parent re-derives state from the query cache
  useEffect(() => {
    setIsSaved(initialIsSaved);
  }, [initialIsSaved]);

  // Real-vehicle mutation via server actions
  const mutation = useMutation({
    mutationFn: async (shouldAdd: boolean) => {
      if (shouldAdd) {
        switch (itemType) {
          case 'issue': return await addIssueToWishlist(vehicleId, itemName);
          case 'maintenance': return await addMaintenanceItemToWishlist(vehicleId, itemName);
          case 'modification': return await addModificationToWishlist(vehicleId, itemName);
        }
      } else {
        return await removeFromWishlist(vehicleId, itemName, itemType);
      }
    },
    onMutate: (shouldAdd: boolean) => {
      setIsSaved(shouldAdd);
    },
    onSuccess: (result, shouldAdd) => {
      if (result?.success) {
        if (shouldAdd && 'alreadyExisted' in result && result.alreadyExisted) {
          toast.success('Already in wishlist');
        } else {
          toast.success(shouldAdd ? 'Added to wishlist' : 'Removed from wishlist');
        }
        invalidateDashboardCache(vehicleId);
        onToggleComplete?.();
      } else {
        setIsSaved(!shouldAdd);
        toast.error(result?.error || 'Failed to update wishlist');
      }
    },
    onError: (_error, shouldAdd) => {
      setIsSaved(!shouldAdd);
      toast.error('An error occurred');
    },
  });

  // Demo toggle: update query cache only (no DB write — service role unavailable in preview).
  // Pre-seeded items load from DB via anon key on page load, so initialIsSaved is correct.
  // Changes persist for the session only, which is fine for a demo experience.
  const toggleDemoWishlist = useCallback(() => {
    const next = !isSaved;
    setIsDemoLoading(true);

    setTimeout(() => {
      const itemIdentifier = `dossier:${itemType}:${itemName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
      const categoryMap: Record<ItemType, string> = {
        issue: 'repair',
        maintenance: 'maintenance',
        modification: 'modification',
      };

      if (next) {
        const newItem = {
          id: Math.random().toString(36).slice(2, 11),
          vehicle_id: vehicleId,
          item_type: itemType,
          item_name: itemName,
          item_identifier: itemIdentifier,
          description: null,
          category: categoryMap[itemType],
          estimated_cost_parts: 0,
          estimated_cost_labor: 0,
          estimated_labor_hours: 0,
          notes: null,
          source: 'dossier',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        queryClient.setQueryData(['wishlist', vehicleId], (old: any[] = []) => {
          // Avoid duplicates
          const filtered = old.filter((i: any) => i.item_name !== itemName);
          return [newItem, ...filtered];
        });
      } else {
        queryClient.setQueryData(['wishlist', vehicleId], (old: any[] = []) =>
          old.filter((i: any) => i.item_name !== itemName)
        );
      }

      setIsSaved(next);
      setIsDemoLoading(false);
      toast.success(next ? 'Added to wishlist' : 'Removed from wishlist');
      onToggleComplete?.();
    }, 150);
  }, [isSaved, vehicleId, itemName, itemType, queryClient, onToggleComplete]);

  const toggleWishlist = useCallback(() => {
    if (isDemo) {
      toggleDemoWishlist();
      return;
    }
    mutation.mutate(!isSaved);
  }, [isDemo, isSaved, mutation, toggleDemoWishlist]);

  return {
    isSaved,
    isLoading: isDemo ? isDemoLoading : mutation.isPending,
    toggleWishlist,
  };
}
