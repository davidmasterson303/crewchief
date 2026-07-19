'use client';

import { useRouter } from 'next/navigation';
import DashboardLayout from '@/components/DashboardLayout';
import DashboardContent from '@/components/DashboardContent';
import RecallAlerts from '@/components/RecallAlerts';
import HealthSummary from '@/components/HealthSummary';
import HealthHistoryChart from '@/components/HealthHistoryChart';
import DiagnosticHero from '@/components/DiagnosticHero';
import { getClientSupabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { useQuery } from '@tanstack/react-query';
import { DashboardSkeleton } from '@/components/Skeletons';
import { ErrorBoundary } from '@/components/ErrorBoundary';

export default function DashboardPage({ params }: { params: { vehicleId: string } }) {
  const router = useRouter();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard', params.vehicleId],
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnMount: true,
    refetchOnReconnect: true,
    queryFn: async () => {
      const supabase = getClientSupabase();

      const [vehicleResult, knowledgeResult, nhtsaResult, healthSummaryResult, recallActionsResult] = await Promise.all([
        supabase.from('vehicles').select('*').eq('id', params.vehicleId).maybeSingle(),
        supabase.from('vehicle_knowledge_base').select('*').eq('vehicle_id', params.vehicleId).maybeSingle(),
        supabase.from('nhtsa_data').select('recalls').eq('vehicle_id', params.vehicleId).maybeSingle(),
        supabase.from('vehicle_health_summary').select('*').eq('vehicle_id', params.vehicleId).maybeSingle(),
        supabase.from('recall_actions').select('campaign_number').eq('vehicle_id', params.vehicleId)
      ]);

      if (vehicleResult.error) throw vehicleResult.error;
      if (!vehicleResult.data) throw new Error('Vehicle not found');

      return {
        vehicle: vehicleResult.data,
        knowledge: knowledgeResult.data,
        nhtsa: nhtsaResult.data,
        healthSummary: healthSummaryResult.data,
        addressedCampaigns: (recallActionsResult.data || []).map((r: any) => r.campaign_number)
      };
    },
    enabled: !!params.vehicleId
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-black p-6">
        <DashboardSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-black p-6 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white mb-4">Error Loading Vehicle</h1>
          <p className="text-gray-400 mb-6">{error.message}</p>
          <Button onClick={() => router.back()}>Go Back</Button>
        </div>
      </div>
    );
  }

  if (!data?.vehicle) {
    router.replace('/garage');
    return null;
  }

  return (
    <ErrorBoundary>
      <DashboardLayout vehicle={data.vehicle} currentPage="dashboard" vehicleImage={data.vehicle.custom_image_url || data.vehicle.image_url} healthSummary={data.healthSummary}>
        <div className="space-y-8">
          {(data.vehicle.custom_image_url || data.vehicle.image_url) && (
            <DiagnosticHero
              imageUrl={data.vehicle.custom_image_url || data.vehicle.image_url}
              vehicleName={`${data.vehicle.year} ${data.vehicle.make} ${data.vehicle.model}`}
              healthScore={data.healthSummary?.health_score}
              focalX={data.vehicle.focal_point_x}
              focalY={data.vehicle.focal_point_y}
            />
          )}

          {data.nhtsa?.recalls && data.nhtsa.recalls.length > 0 && (
            <RecallAlerts
              recalls={data.nhtsa.recalls}
              vehicleId={params.vehicleId}
              addressedCampaigns={data.addressedCampaigns}
            />
          )}

          <HealthSummary
            healthSummary={data.healthSummary}
            vehicleId={params.vehicleId}
            recalls={data.nhtsa?.recalls || []}
          />

          <HealthHistoryChart
            vehicleId={params.vehicleId}
            currentScore={data.healthSummary?.health_score}
          />

          <DashboardContent vehicle={data.vehicle} knowledge={data.knowledge} />
        </div>
      </DashboardLayout>
    </ErrorBoundary>
  );
}
