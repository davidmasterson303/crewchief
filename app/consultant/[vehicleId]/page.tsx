'use client';

import { useRouter } from 'next/navigation';
import DashboardLayout from '@/components/DashboardLayout';
import ConsultantChat from '@/components/ConsultantChat';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { getClientSupabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useVehicleImage } from '@/hooks/useSignedUrl';

export default function ConsultantPage({ params }: { params: { vehicleId: string } }) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const cachedData = queryClient.getQueryData<any>(['dashboard', params.vehicleId]);
  const vehicleData = cachedData?.vehicle ?? (cachedData?.id ? cachedData : undefined);

  const { data, isLoading, error } = useQuery({
    queryKey: ['consultant', params.vehicleId],
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    enabled: !!params.vehicleId,
    queryFn: async () => {
      const supabase = getClientSupabase();

      const [
        vehicleResult, knowledgeResult, sessionsResult,
        allServiceResult, maintenanceLineItemsResult,
        documentsResult, issueTrackingResult, nhtsaResult, healthResult,
        modWishlistResult, modTrackingResult
      ] = await Promise.all([
        supabase.from('vehicles').select('*').eq('id', params.vehicleId).maybeSingle(),
        supabase.from('vehicle_knowledge_base').select('*').eq('vehicle_id', params.vehicleId).maybeSingle(),
        supabase.from('consultant_conversations').select('id,title,created_at,updated_at').eq('vehicle_id', params.vehicleId).order('updated_at', { ascending: false }),
        supabase.from('service_items').select('*').eq('vehicle_id', params.vehicleId).order('date_completed', { ascending: false }),
        supabase.from('maintenance_line_items').select('*').eq('vehicle_id', params.vehicleId).order('service_date', { ascending: false }),
        supabase.from('vehicle_documents').select('*').eq('vehicle_id', params.vehicleId),
        supabase.from('known_issue_tracking').select('*').eq('vehicle_id', params.vehicleId),
        supabase.from('nhtsa_data').select('recalls').eq('vehicle_id', params.vehicleId).maybeSingle(),
        supabase.from('vehicle_health_summary').select('*').eq('vehicle_id', params.vehicleId).maybeSingle(),
        supabase.from('wishlist_items').select('*').eq('vehicle_id', params.vehicleId).order('created_at', { ascending: false }),
        supabase.from('modification_tracking').select('*').eq('vehicle_id', params.vehicleId)
      ]);

      if (vehicleResult.error) throw vehicleResult.error;
      if (!vehicleResult.data) throw new Error('Vehicle not found');

      const allServiceItems = allServiceResult.data || [];

      return {
        vehicle: vehicleResult.data,
        knowledge: knowledgeResult.data,
        sessions: sessionsResult.data || [],
        allServiceItems,
        maintenanceLineItems: maintenanceLineItemsResult.data || [],
        documents: documentsResult.data || [],
        issueTracking: issueTrackingResult.data || [],
        nhtsaData: nhtsaResult.data,
        healthSummary: healthResult.data,
        modWishlistItems: modWishlistResult.data || [],
        modTracking: modTrackingResult.data || [],
      };
    },
  });

  const shellVehicle = data?.vehicle ?? vehicleData;
  // One resolution for every branch below — the shell and the loaded vehicle
  // are the same car, and a hook cannot be called per branch.
  const vehicleImage = useVehicleImage(shellVehicle);

  if (isLoading && !shellVehicle) {
    return (
      <div className="min-h-screen bg-[#080808] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-2 border-info-border border-t-info rounded-full animate-spin" />
          <p className="text-sm text-white/40">Loading consultant...</p>
        </div>
      </div>
    );
  }

  if (isLoading && shellVehicle) {
    return (
      <DashboardLayout vehicle={shellVehicle} currentPage="consultant" vehicleImage={vehicleImage}>
        <div className="flex items-center justify-center py-32">
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 border-2 border-info-border border-t-info rounded-full animate-spin" />
            <p className="text-sm text-white/40">Loading consultant...</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  if (error) {
    const isNotFound = error.message === 'Vehicle not found';
    if (isNotFound) {
      router.replace('/garage');
      return null;
    }
    if (shellVehicle) {
      return (
        <DashboardLayout vehicle={shellVehicle} currentPage="consultant" vehicleImage={vehicleImage}>
          <div className="bg-red-500/10 border border-red-400/25 rounded-2xl p-6">
            <h2 className="text-red-300 font-semibold mb-2">Error Loading Consultant</h2>
            <p className="text-red-200/60 mb-5 text-sm">{error.message}</p>
            <Button onClick={() => router.push('/garage')} variant="outline" className="border-white/15 text-white/70 hover:bg-white/8">
              Back to Garage
            </Button>
          </div>
        </DashboardLayout>
      );
    }
    return (
      <div className="min-h-screen bg-[#080808] flex items-center justify-center">
        <div className="max-w-md w-full mx-auto px-6">
          <div className="bg-red-500/10 border border-red-400/25 rounded-2xl p-6">
            <h2 className="text-red-300 font-semibold mb-2">Error Loading Consultant</h2>
            <p className="text-red-200/60 mb-5 text-sm">{error.message}</p>
            <Button onClick={() => router.push('/garage')} variant="outline" className="border-white/15 text-white/70 hover:bg-white/8">
              Back to Garage
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!data?.vehicle) return null;

  const { vehicle, knowledge, sessions, allServiceItems, maintenanceLineItems, documents, issueTracking, modTracking, nhtsaData, healthSummary, modWishlistItems } = data;
  const mostRecentSessionId = sessions.length > 0 ? sessions[0].id : undefined;
  const wishlistItems = allServiceItems.filter((i: any) => i.status === 'wishlist');
  const completedItems = allServiceItems.filter((i: any) => i.status === 'completed');

  return (
    <ErrorBoundary context="CONSULTANT_PAGE">
      <DashboardLayout vehicle={vehicle} knowledge={knowledge} currentPage="consultant" vehicleImage={vehicleImage}>
        <ConsultantChat
          vehicleId={params.vehicleId}
          vehicle={vehicle}
          knowledge={knowledge}
          wishlistItems={wishlistItems}
          allServiceItems={allServiceItems}
          completedItems={completedItems}
          maintenanceLineItems={maintenanceLineItems}
          documents={documents}
          issueTracking={issueTracking}
          modTracking={modTracking}
          sessions={sessions}
          initialSessionId={mostRecentSessionId}
          nhtsaData={nhtsaData}
          healthSummary={healthSummary}
          modWishlistItems={modWishlistItems}
        />
      </DashboardLayout>
    </ErrorBoundary>
  );
}
