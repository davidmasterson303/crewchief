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
import { VehicleResearchStatus } from '@/components/VehicleResearchStatus';
import { useVehicleImage } from '@/hooks/useSignedUrl';

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

  // Before the loading and error branches: this is a hook, and it has to run
  // on every render regardless of which one this render takes.
  const vehicleImage = useVehicleImage(data?.vehicle);

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
      <DashboardLayout vehicle={data.vehicle} currentPage="dashboard" vehicleImage={vehicleImage} healthSummary={data.healthSummary}>
        <div className="space-y-8">
          {/*
            Unconditional now. The hero used to render only when a photo
            resolved, which meant a vehicle without one had no hero at all and
            the page opened on a recall banner. The no-photo state is CC-142's
            primary design, so there is always something to show.
          */}
          <DiagnosticHero
            photo={vehicleImage}
            vehicleName={`${data.vehicle.year} ${data.vehicle.make} ${data.vehicle.model}`}
            year={data.vehicle.year}
            make={data.vehicle.make}
            model={data.vehicle.model}
            trim={data.vehicle.trim}
            healthScore={data.healthSummary?.health_score}
            reason={data.healthSummary?.summary}
          />

          {data.nhtsa?.recalls && data.nhtsa.recalls.length > 0 && (
            <RecallAlerts
              recalls={data.nhtsa.recalls}
              vehicleId={params.vehicleId}
              addressedCampaigns={data.addressedCampaigns}
            />
          )}

          {/*
            Above the fold on purpose. A vehicle whose research has not landed
            renders an empty dossier below, and the user needs to know that is
            a pending state rather than the truth about their car.
          */}
          <VehicleResearchStatus
            vehicleId={params.vehicleId}
            status={data.knowledge?.research_status}
            onComplete={refetch}
          />

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
