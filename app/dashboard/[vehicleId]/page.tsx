'use client';

import { useState } from 'react';

import dynamic from 'next/dynamic';
import { recallsAreKnown } from '@wellkept/core/nhtsa-lookup';
import { selectNhtsaRow } from '@/lib/nhtsa-row';
import { driversForVehicle, driversSupportAScore } from '@wellkept/core/health-drivers';
import type { ServiceHistoryRow } from '@wellkept/core/service-history';
import { useRouter } from 'next/navigation';
import DashboardLayout from '@/components/DashboardLayout';
import DashboardContent from '@/components/DashboardContent';
import RecallAlerts from '@/components/RecallAlerts';
import HealthSummary from '@/components/HealthSummary';
import DiagnosticHero from '@/components/DiagnosticHero';
import CollapsibleSection from '@/components/CollapsibleSection';
import { getClientSupabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { useQuery } from '@tanstack/react-query';
import { DashboardSkeleton } from '@/components/Skeletons';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { VehicleResearchStatus } from '@/components/VehicleResearchStatus';
import { useVehicleImage } from '@/hooks/useSignedUrl';
import { VehiclePhotoUploadDialog } from '@/components/VehiclePhotoUploadDialog';
import { getHealthBand } from '@/hooks/use-health-band';

/*
  The score history is `defaultOpen={false}`, so it loads when it is unfolded.

  Same reasoning as the two sections in `DashboardContent` — see the note there
  — and it is the last closed-by-default tree that was still being downloaded
  on every dashboard load. Smaller than those two, because the chart is
  hand-rolled SVG rather than a charting library, but it is on the same side of
  the same line.

  `ssr: false` costs nothing here: with the fold closed this never renders on
  the server anyway.
*/
const HealthHistoryChart = dynamic(() => import('@/components/HealthHistoryChart'), {
  ssr: false,
  loading: () => <div className="h-32" aria-hidden="true" />,
});

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

      const [vehicleResult, knowledgeResult, nhtsaResult, healthSummaryResult, recallActionsResult, recordsResult, historyResult] = await Promise.all([
        supabase.from('vehicles').select('*').eq('id', params.vehicleId).maybeSingle(),
        supabase.from('vehicle_knowledge_base').select('*').eq('vehicle_id', params.vehicleId).maybeSingle(),
        /*
          ⚠ `lookup_status` travels — FN-03. Without it this page can only ask
          "is there a row", which is true for a lookup NHTSA did not recognise
          and is how a green tick lands on a truck with open campaigns.

          ⚠ And it travels through `selectNhtsaRow`, not a bare `select`. The
          column is not applied in production, and naming it in a select makes
          PostgREST reject the entire query — so this read was returning `null`
          for every vehicle and the recall banner below had never rendered for
          anyone. See that helper for the full account.
        */
        selectNhtsaRow(supabase, params.vehicleId),
        supabase.from('vehicle_health_summary').select('*').eq('vehicle_id', params.vehicleId).maybeSingle(),
        supabase.from('recall_actions').select('campaign_number').eq('vehicle_id', params.vehicleId),
        /*
          The vehicle's maintenance records, serving two things at once — D10
          and D13.

          The rows feed `driversForVehicle`, which needs the descriptions and
          dates to work out what has actually been serviced; their count is what
          the hero's caption names. One query rather than a count query plus a
          row query, and the same columns `app/api/v1/load-vehicle` selects, so
          the two clients compute the drivers from identical input.

          ⚠ A failed read must resolve to `null` rather than `0`. Zero is a
          statement about the car ("no invoices on file"); null is a statement
          about us ("we could not look"). `work-narration.ts` renders them
          differently on purpose, and collapsing them here is how "no records"
          would come to mean "read failed" on the one screen written to stop
          absence reading as fact.
        */
        supabase
          .from('maintenance_line_items')
          .select('item_description, service_date, mileage_at_service, source')
          .eq('vehicle_id', params.vehicleId),
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
        nhtsa: nhtsaResult,
        healthSummary: healthSummaryResult.data,
        // Errors resolve to empty rather than throwing: a missing score history
        // is a normal state for a new vehicle, not a broken dashboard.
        history: (historyResult.data || []) as { health_score: number; recorded_at: string }[],
        addressedCampaigns: (recallActionsResult.data || []).map((r: any) => r.campaign_number),
        /*
          `null` on failure, never `[]`. The drivers degrade correctly from an
          empty list — every mileage-driven service still evaluates — but the
          *caption* must not say "no service records on file" because a read
          errored. Two consumers, two different tolerances, one honest absence.
        */
        serviceRows: recordsResult.error
          ? null
          : ((recordsResult.data || []) as ServiceHistoryRow[])
      };
    },
    enabled: !!params.vehicleId
  });

  // Before the loading and error branches: this is a hook, and it has to run
  // on every render regardless of which one this render takes.
  const vehicleImage = useVehicleImage(data?.vehicle);
  const [showPhotoDialog, setShowPhotoDialog] = useState(false);

  /*
    ── ⚠ D10 · the drivers reach the web at last ─────────────────────────────

    `healthDrivers` had exactly one caller — the mobile API route — so every
    computed statement about this car ("No service schedule on record", "Recalls
    have not been checked") existed and was rendered on the phone and nowhere on
    the web. The dashboard drew a dial and three model-written tiles.

    `recallsChecked` is not consulted here on purpose: `recallDriver` wants the
    raw `recalls` value and distinguishes `undefined` from `[]` itself. Passing
    it a pre-digested boolean would put that judgement in two places.
  */
  const drivers =
    data === undefined
      ? []
      : driversForVehicle({
          schedule: data.knowledge?.maintenance_schedule,
          historyRows: data.serviceRows ?? [],
          recalls: recallsAreKnown(data.nhtsa?.lookup_status, data.nhtsa?.recalls)
            ? data.nhtsa?.recalls ?? []
            : undefined,
          currentMileage: data.vehicle?.current_mileage ?? null,
          year: data.vehicle?.year ?? null,
        });

  /*
    ── ⚠ D10 · refuse to band a score nothing computable supports ────────────

    The score comes from the model; the drivers are computed from rows. When
    *every* driver is null — no schedule or no records against it, no recall
    lookup, no odometer-and-year — there is nothing checkable underneath the
    number, and banding it would present a judgement about nothing as a reading.
    That is the hardcoded 70 arriving by a longer route.

    `driversSupportAScore` is `some`, not `every`: one null driver is the normal,
    honest case the drivers exist to report, and refusing on it would blank the
    dial for most real cars and train everyone to ignore the rule.
  */
  const scoreIsSupported = driversSupportAScore(drivers);

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
      {/*
        ⚠ **UX-21 · `knowledge` was not passed, so the reliability reading was
        missing from the dashboard alone.** `DashboardLayout` renders
        "RELIABILITY 7/10" from `knowledge.reliability_score`, and the consultant
        and vehicle-info pages both supply it — this one fetched the row (it is
        `knowledgeResult` above, used for `research_status` twice on this very
        page) and did not hand it over. One prop, and the effect was a fact that
        appears on two screens and vanishes on the third.
      */}
      <DashboardLayout
        vehicle={data.vehicle}
        knowledge={data.knowledge}
        currentPage="dashboard"
        vehicleImage={vehicleImage}
        healthSummary={data.healthSummary}
        /* Every child below is a bordered section already — see the prop. */
        contentSurface="bare"
      >
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
            /*
              ⚠ `?? null` is deliberate and load-bearing, and the two absences
              differ. No `vehicle_health_summary` row at all → `undefined` → no
              dial, because nothing has ever been generated. A row whose
              `health_score` is `null` → the unknown dial, because the model was
              asked and declined to score.

              Before D10 both arrived at `DiagnosticHero`'s `healthScore ?? 0`
              and the second one drew a red dial reading 0.
            */
            healthScore={
              data.healthSummary
                ? scoreIsSupported
                  ? data.healthSummary.health_score ?? null
                  : null
                : undefined
            }
            /*
              ⚠ The model's summary used to be passed here as `reason`, and
              `HealthSummary` prints the same string in "What's driving the
              score" a few hundred pixels below. One paragraph, twice, in one
              screen. It stays there — that is where the disclosure saying a
              model wrote it lives — and the hero links to it instead.
            */
            driversHref="#health-report"
            work={{
              serviceRecords: data.serviceRows === null ? null : data.serviceRows.length,
              /*
                ⚠ Recalls are `null` unless the lookup is known to have run.
                `recallsAreKnown` is the only thing that answers this — an
                `nhtsa_data` row exists for lookups NHTSA did not recognise, so
                `recalls?.length ?? 0` would report "0 recall campaigns" for a
                truck nobody successfully checked. FN-03, again.
              */
              recalls: recallsAreKnown(data.nhtsa?.lookup_status, data.nhtsa?.recalls)
                ? data.nhtsa?.recalls?.length ?? 0
                : null,
            }}
            /*
              D10's primary action. `/documents/[vehicleId]` is the Maintenance
              page and its own button says "Upload Invoice" — the one place on
              the web where a record actually gets added. Sending someone to a
              screen that cannot do the thing is worse than offering nothing.
            */
            onAddRecord={() => router.push(`/documents/${params.vehicleId}`)}
            addRecordLabel="Upload an invoice"
            /*
              The empty plate's own action. `VehicleCard` has offered this from
              the garage since CC-142; the dashboard — the screen where the
              plate is largest and emptiest — had no way to add a photograph at
              all, so an owner had to go back to the garage to fix what this
              page was pointing at.
            */
            onAddPhoto={() => setShowPhotoDialog(true)}
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
              /*
                The section's header is the only heading for this content now —
                the card inside used to carry "What's driving the score" as a
                second one, and the hero links here with the same words. One
                heading, and the link's text is its destination's name.
              */
              title="What's driving the score"
              storageKey={`dash:health:${params.vehicleId}`}
              /* The hero's "What's driving this score" link points here, and
                 the section opens itself when the hash names it. */
              anchorId="health-report"
              defaultOpen
              summary={healthSummaryLine(
                scoreIsSupported ? data.healthSummary?.health_score : null
              )}
            >
              {/*
                ⚠ `recallsChecked` is whether the lookup **matched**, not
                whether a row exists. Three facts, not one, and conflating them
                is what put a green "No active recalls" tick on a 2003 Accord
                whose lookup had never run — and, once that was fixed, would
                have put the same tick on any car whose make NHTSA does not
                recognise. `recallsAreKnown` is the one place that question
                is answered; see `packages/core/src/nhtsa-lookup.ts`.
              */}
              <HealthSummary
                healthSummary={data.healthSummary}
                drivers={drivers}
                vehicleId={params.vehicleId}
                recalls={data.nhtsa?.recalls || []}
                recallsChecked={recallsAreKnown(data.nhtsa?.lookup_status, data.nhtsa?.recalls)}
                researchComplete={data.knowledge?.research_status === 'completed'}
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
        {/*
          Mounted beside the layout rather than inside the hero: the hero draws
          a plate and offers an action, and a modal that owns a file input, a
          crop step and a router refresh is not a thing a presentational band
          should be holding.
        */}
        <VehiclePhotoUploadDialog
          vehicleId={params.vehicleId}
          vehicleName={`${data.vehicle.year} ${data.vehicle.make} ${data.vehicle.model}`}
          currentPhotoUrl={vehicleImage ?? undefined}
          hasCustomPhoto={!!data.vehicle.custom_image_url}
          open={showPhotoDialog}
          onOpenChange={setShowPhotoDialog}
        />
      </DashboardLayout>
    </ErrorBoundary>
  );
}
