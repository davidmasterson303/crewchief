'use client';

import { useRouter } from 'next/navigation';
import DashboardLayout from '@/components/DashboardLayout';
import DashboardContent from '@/components/DashboardContent';
import RecallAlerts from '@/components/RecallAlerts';
import HealthSummary from '@/components/HealthSummary';
import HealthHistoryChart from '@/components/HealthHistoryChart';
import DiagnosticHero from '@/components/DiagnosticHero';
import CollapsibleSection from '@/components/CollapsibleSection';
import { getClientSupabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { useQuery } from '@tanstack/react-query';
import { DashboardSkeleton } from '@/components/Skeletons';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { VehicleResearchStatus } from '@/components/VehicleResearchStatus';
import { useVehicleImage } from '@/hooks/useSignedUrl';
import { getHealthBand } from '@/hooks/use-health-band';

/**
 * The health report's folded state: the score and the band it falls in.
 *
 * Band comes from `getHealthBand`, the same table the ring and DiagnosticHero
 * read, so a collapsed summary can never disagree with the score it is
 * summarising — which is the failure mode of writing "Fair" out by hand here.
 */
function healthSummaryLine(score: number | null | undefined): string | undefined {
  if (score == null) return undefined;
  return `${score} · ${getHealthBand(score).label}`;
}

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

      const [vehicleResult, knowledgeResult, nhtsaResult, healthSummaryResult, recallActionsResult, historyResult] = await Promise.all([
        supabase.from('vehicles').select('*').eq('id', params.vehicleId).maybeSingle(),
        supabase.from('vehicle_knowledge_base').select('*').eq('vehicle_id', params.vehicleId).maybeSingle(),
        supabase.from('nhtsa_data').select('recalls').eq('vehicle_id', params.vehicleId).maybeSingle(),
        supabase.from('vehicle_health_summary').select('*').eq('vehicle_id', params.vehicleId).maybeSingle(),
        supabase.from('recall_actions').select('campaign_number').eq('vehicle_id', params.vehicleId),
        /*
          Score history, fetched here rather than inside HealthHistoryChart.

          Two reasons. The chart renders nothing below two readings — a
          two-point line is not a chart — so the *parent* has to know the count
          to decide whether the collapsed section should exist at all; a fold
          that opens onto emptiness is worse than no fold. And the collapsed
          summary needs the same numbers.

          It joins the round trip that was already happening, so it costs no
          extra latency, and the chart stops running its own duplicate query.

          `vehicle_health_history` is not in ANON_READ_TABLES, so this 401s for
          an anonymous visitor on a demo car and resolves to an empty list. That
          is pre-existing — the chart's own query had the same result — and it
          degrades correctly: no history, no section.
        */
        supabase
          .from('vehicle_health_history')
          .select('health_score, recorded_at')
          .eq('vehicle_id', params.vehicleId)
          .order('recorded_at', { ascending: true })
          .limit(12)
      ]);

      if (vehicleResult.error) throw vehicleResult.error;
      if (!vehicleResult.data) throw new Error('Vehicle not found');

      return {
        vehicle: vehicleResult.data,
        knowledge: knowledgeResult.data,
        nhtsa: nhtsaResult.data,
        healthSummary: healthSummaryResult.data,
        // Errors resolve to empty rather than throwing: a missing score history
        // is a normal state for a new vehicle, not a broken dashboard.
        history: (historyResult.data || []) as { health_score: number; recorded_at: string }[],
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
      <div className="min-h-screen bg-black p-4 sm:p-6">
        <DashboardSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-black p-4 sm:p-6 flex items-center justify-center">
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

          {/*
            Everything below the recalls folds away, and remembers.

            The page was seven expanded sections deep, most of it reference
            material you consult occasionally and scroll past constantly. What
            opens by default is what answers "does this car need attention":
            the health report. The dossier, the score history and the wishlist
            start folded, each carrying a one-line summary so the fold still
            says what is inside.

            Keyed per vehicle — collapsing the dossier on one car must not
            collapse it on another.
          */}
          <div className="space-y-3">
            <CollapsibleSection
              title="Health report"
              storageKey={`dash:health:${params.vehicleId}`}
              defaultOpen
              summary={healthSummaryLine(data.healthSummary?.health_score)}
            >
              <HealthSummary
                healthSummary={data.healthSummary}
                vehicleId={params.vehicleId}
                recalls={data.nhtsa?.recalls || []}
              />
            </CollapsibleSection>

            {/*
              Absent, not empty, below two readings — see the query above. The
              chart itself also returns null in that case, so rendering the
              section would put a header on a void.
            */}
            {data.history.length >= 2 && (
              <CollapsibleSection
                title="Score history"
                storageKey={`dash:history:${params.vehicleId}`}
                defaultOpen={false}
                summary={`${data.history.length} readings · ${data.history[0].health_score} → ${
                  data.history[data.history.length - 1].health_score
                }`}
              >
                <HealthHistoryChart
                  history={data.history}
                  currentScore={data.healthSummary?.health_score}
                />
              </CollapsibleSection>
            )}

            <DashboardContent
              vehicle={data.vehicle}
              knowledge={data.knowledge}
              vehicleId={params.vehicleId}
            />
          </div>
        </div>
      </DashboardLayout>
    </ErrorBoundary>
  );
}
