import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getClientSupabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { logger } from '@crewchief/core/logger';
import { queryClient as singletonQueryClient } from '@crewchief/core/query-client';

export function useServiceItems(vehicleId: string | null | undefined) {
  return useQuery({
    queryKey: ['serviceItems', vehicleId],
    queryFn: async () => {
      if (!vehicleId) throw new Error('Vehicle ID is required');

      const supabase = getClientSupabase();
      const { data, error } = await supabase
        .from('service_items')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data || [];
    },
    enabled: !!vehicleId,
    staleTime: 1000 * 60 * 2,
  });
}

export function useDeleteServiceItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (itemId: string) => {
      const supabase = getClientSupabase();
      const { error } = await supabase
        .from('service_items')
        .delete()
        .eq('id', itemId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['serviceItems'] });
      singletonQueryClient.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('Item deleted');
    },
    onError: (error) => {
      toast.error('Failed to delete item');
      logger.error('USE_SERVICE_ITEMS:DELETE', error as Error);
    },
  });
}

export function useAddServiceItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (item: any) => {
      const supabase = getClientSupabase();
      const { data, error } = await supabase
        .from('service_items')
        .insert([item])
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['serviceItems'] });
      singletonQueryClient.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('Item added');
    },
    onError: (error) => {
      toast.error('Failed to add item');
      logger.error('USE_SERVICE_ITEMS:ADD', error as Error);
    },
  });
}
