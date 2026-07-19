import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getClientSupabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { logger } from '@/lib/logger';
import { queryClient as singletonQueryClient } from '@/lib/query-client';

export function useQuotes(vehicleId: string | null | undefined) {
  return useQuery({
    queryKey: ['quotes', vehicleId],
    queryFn: async () => {
      if (!vehicleId) throw new Error('Vehicle ID is required');

      const supabase = getClientSupabase();
      const { data, error } = await supabase
        .from('quotes')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data || [];
    },
    enabled: !!vehicleId,
    staleTime: 1000 * 60 * 5,
  });
}

export function useAddQuote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (quote: any) => {
      const supabase = getClientSupabase();
      const { data, error } = await supabase
        .from('quotes')
        .insert([quote])
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quotes'] });
      singletonQueryClient.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('Quote created');
    },
    onError: (error) => {
      toast.error('Failed to create quote');
      logger.error('USE_QUOTES:MUTATION', error as Error);
    },
  });
}
