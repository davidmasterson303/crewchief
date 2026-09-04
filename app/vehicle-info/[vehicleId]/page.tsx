'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import DashboardLayout from '@/components/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Droplets, Lightbulb, Loader as Loader2, RefreshCw } from 'lucide-react';
import ResearchButton from '@/components/ResearchButton';
import { getClientSupabase } from '@/lib/supabase';
import { logger } from '@wellkept/core/logger';
import TCOCard from '@/components/TCOCard';
import TCOInputsModal from '@/components/TCOInputsModal';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useVehicleImage } from '@/hooks/useSignedUrl';

const ENABLE_TCO = false;

function cleanPowertrain(value: string | null | undefined): string {
  if (!value) return '\u2014';
  if (value.toLowerCase().includes(' or ')) {
    const firstOption = value.split(' or ')[0].trim();
    return `${firstOption} (multiple options available)`;
  }
  return value;
}

function EmptySpec({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/8 flex items-center justify-center mb-3">
        <Loader2 className="h-5 w-5 text-white/20" />
      </div>
      <p className="text-sm text-white/50 leading-relaxed max-w-xs">
        {label} will be available after vehicle research is complete.
      </p>
    </div>
  );
}

export default function VehicleInfoPage({ params }: { params: { vehicleId: string } }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [perfOverrides, setPerfOverrides] = useState<Record<string, any>>({});
  const [perfLoading, setPerfLoading] = useState(false);
  const [perfChecked, setPerfChecked] = useState(false);
  const [tcoModalOpen, setTcoModalOpen] = useState(false);

  const cachedData = queryClient.getQueryData<any>(['dashboard', params.vehicleId]);
  const cachedVehicle = cachedData?.vehicle ?? (cachedData?.id ? cachedData : undefined);

  const { data, isLoading, error } = useQuery({
    queryKey: ['vehicle-info', params.vehicleId],
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    enabled: !!params.vehicleId,
    queryFn: async () => {
      const supabase = getClientSupabase();
      const [vehicleResult, knowledgeResult] = await Promise.all([
        supabase.from('vehicles').select('*').eq('id', params.vehicleId).maybeSingle(),
        supabase.from('vehicle_knowledge_base').select('*').eq('vehicle_id', params.vehicleId).maybeSingle()
      ]);

      if (vehicleResult.error) throw vehicleResult.error;
      if (!vehicleResult.data) throw new Error('Vehicle not found');

      return {
        vehicle: vehicleResult.data,
        knowledge: knowledgeResult.data,
      };
    },
  });

  const fetchPerformanceStats = useCallback(async (forceRefresh = false) => {
    if (!data?.vehicle) return;
    setPerfLoading(true);
    try {
      const response = await fetch('/api/v1/performance-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicleId: params.vehicleId, forceRefresh }),
      });
      const json = await response.json();
      if (json.success && json.stats) {
        setPerfOverrides((prev) => ({
          ...prev,
          stock_hp: json.stats.stock_hp ?? prev.stock_hp,
          stock_torque: json.stats.stock_torque ?? prev.stock_torque,
          stock_zero_to_sixty: json.stats.stock_zero_to_sixty ?? prev.stock_zero_to_sixty,
          modified_hp: json.stats.modified_hp !== undefined ? json.stats.modified_hp : prev.modified_hp,
          modified_torque: json.stats.modified_torque !== undefined ? json.stats.modified_torque : prev.modified_torque,
          modified_zero_to_sixty: json.stats.modified_zero_to_sixty !== undefined ? json.stats.modified_zero_to_sixty : prev.modified_zero_to_sixty,
        }));
      }
    } catch (err) {
      logger.error('VEHICLE_INFO:PERF_STATS', err as Error);
    } finally {
      setPerfLoading(false);
    }
  }, [data?.vehicle?.id, params.vehicleId]);

  useEffect(() => {
    if (data?.vehicle && !perfChecked) {
      setPerfChecked(true);
      fetchPerformanceStats();
    }
  }, [data?.vehicle?.id, perfChecked]);

  // Above the loading and error branches: the cached vehicle and the fetched
  // one are the same car, and a hook cannot be called inside a branch.
  const vehicleImage = useVehicleImage(data?.vehicle ?? cachedVehicle);

  if (isLoading) {
    if (cachedVehicle) {
      return (
        <DashboardLayout vehicle={cachedVehicle} currentPage="vehicle-info" vehicleImage={vehicleImage}>
          <div className="flex items-center justify-center py-32">
            <div className="flex flex-col items-center gap-3">
              <div className="w-10 h-10 border-2 border-info-border border-t-info rounded-full animate-spin" />
              <p className="text-sm text-white/50">Loading vehicle info...</p>
            </div>
          </div>
        </DashboardLayout>
      );
    }
    return (
      <div className="min-h-screen bg-[#080808] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-2 border-info-border border-t-info rounded-full animate-spin" />
          <p className="text-sm text-white/50">Loading vehicle info...</p>
        </div>
      </div>
    );
  }

  if (error) {
    if (error.message === 'Vehicle not found') {
      router.replace('/garage');
      return null;
    }
    return (
      <div className="min-h-screen bg-[#080808] flex items-center justify-center">
        <div className="max-w-md w-full mx-auto px-4 sm:px-6">
          <div className="bg-red-500/10 border border-red-400/25 rounded-2xl p-4 sm:p-6">
            <h2 className="text-red-300 font-semibold mb-2">Error Loading Vehicle Info</h2>
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

  const { knowledge } = data;
  // Merge cached vehicle with any live perf overrides
  const vehicle = { ...data.vehicle, ...perfOverrides };

  const fluidSpecs = knowledge?.fluid_specs || {};
  const interestingFacts = knowledge?.interesting_facts || [];

  const displayHP = vehicle.modified_hp || vehicle.stock_hp;
  const displayTorque = vehicle.modified_torque || vehicle.stock_torque;
  const displayZeroToSixty = vehicle.modified_zero_to_sixty || vehicle.stock_zero_to_sixty;

  const hasModifications = vehicle.modified_hp || vehicle.modified_torque || vehicle.modified_zero_to_sixty;
  const hasPerformanceData = vehicle.stock_hp || vehicle.stock_torque || vehicle.stock_zero_to_sixty;
  const hasInterestingFacts = interestingFacts.length > 0;
  const hasPowertrainData = knowledge?.engine_type || knowledge?.transmission_type || knowledge?.drivetrain;

  return (
    <DashboardLayout
      vehicle={vehicle}
      knowledge={knowledge}
      currentPage="vehicle-info"
      vehicleImage={vehicleImage}
      /*
        Every child here is a bordered card already, so the layout's panel was
        a third rounded rectangle around them — the nesting two critiques
        counted on this page.
      */
      contentSurface="bare"
    >
      <div className="space-y-5">
        {/*
          ── ⚠ The research action belongs to a section, not to a dead band ───

          It sat in a `flex justify-end` of its own: a lone pill right-aligned
          in an otherwise empty row — about 90px of a phone's screen, and on a
          desktop a button with 1000px of nothing to its left. A design critique
          named it precisely: "a section-level action with no section header to
          belong to… as-is it reads as an unfinished layout region."

          It belongs to this card, which is where the research lands. Giving the
          card a header gives the button somewhere to be and gives the first
          block on the page a name.
        */}
        <Card className="bg-slate-900/60 border-white/10">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between gap-4">
              <CardTitle className="display-serif text-white text-lg">Specification</CardTitle>
              <ResearchButton
                vehicleId={vehicle.id}
                year={vehicle.year}
                make={vehicle.make}
                model={vehicle.model}
                hasData={hasPerformanceData || hasInterestingFacts || hasPowertrainData}
              />
            </div>
          </CardHeader>
          <CardContent className="pb-5">
            {/*
              ── ⚠ Three rows, not three cards with circled glyphs ────────────

              This was page → panel → this card → three bordered tiles, each
              with an icon in its own bordered circle: four levels of rounded
              rectangle to show three key/value pairs. A design critique called
              it the page's worst offence and "the classic AI tell", and it was
              right about the glyphs too — a waveform meant Transmission, a
              lightning bolt meant Drivetrain on a petrol car, and the same bolt
              headed Performance Stats a few hundred pixels below. One glyph,
              two meanings, one screen.

              A studio sets this as table rows with a hairline. So it is rows,
              stacked on a phone and three-up from `sm`, and the labels do the
              work the circles were doing.
            */}
            <div className="divide-y divide-white/8 sm:grid sm:grid-cols-3 sm:divide-y-0 sm:divide-x">
              {[
                { label: 'Engine', value: cleanPowertrain(knowledge?.engine_type) },
                { label: 'Transmission', value: cleanPowertrain(knowledge?.transmission_type) },
                { label: 'Drivetrain', value: cleanPowertrain(knowledge?.drivetrain) },
              ].map(({ label, value }) => (
                <div key={label} className="py-3 first:pt-0 last:pb-0 sm:px-4 sm:py-0 sm:first:pl-0 sm:last:pr-0">
                  <p className="label-uppercase mb-1">{label}</p>
                  <p className="text-sm font-semibold text-white leading-snug">{value}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900/60 border-white/10">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <CardTitle className="display-serif text-white text-lg">Performance</CardTitle>
              <button
                onClick={() => fetchPerformanceStats(true)}
                disabled={perfLoading}
                className="tap-target-44 w-8 h-8 flex items-center justify-center rounded-lg text-white/35 hover:text-cyan-400 hover:bg-cyan-400/8 transition-colors disabled:opacity-40"
                aria-label="Refresh performance stats"
              >
                <RefreshCw className={`h-4 w-4 ${perfLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </CardHeader>
          <CardContent>
            {perfLoading && !hasPerformanceData ? (
              <div className="flex flex-col items-center justify-center py-12">
                <div className="w-8 h-8 border-2 border-info-border border-t-info rounded-full animate-spin mb-3" />
                <p className="text-sm text-white/50">Analyzing performance specs...</p>
              </div>
            ) : (
              <>
                {/*
                  ── ⚠ Three columns on a phone, not three stacked tiles ──────

                  Each figure was a full-width centred card with its own border,
                  radius, icon and padding — about 500px of screen for one
                  number, so three numbers cost roughly four screens of thumb
                  travel. A design critique called it the single largest failure
                  on the page, and it is a mobile-first product.

                  They are three readings of one thing and they belong on one
                  line. An instrument panel is dense; that density *is* the
                  luxury register this page is reaching for.

                  ⚠ The glyphs are gone with the tiles. `Zap` was doing duty for
                  Torque here, for Drivetrain above and for Performance Stats in
                  the header — an icon that means three things means none, and
                  these were chosen to fill circles rather than to say anything.
                */}
                <div className="grid grid-cols-3 divide-x divide-white/8 rounded-xl border border-white/10 bg-white/[0.02]">
                  {[
                    {
                      /*
                        ⚠ "Power", not "Horsepower". At 12px with the house
                        label tracking the longer word measures 97px into an
                        80px cell — measured, not estimated — and overflowed.
                        "Power" is what the figure is called next to torque,
                        and `hp` is printed beside the number anyway.
                      */
                      label: 'Power',
                      value: displayHP,
                      unit: 'hp',
                      delta: hasModifications && vehicle.stock_hp ? `+${(displayHP || 0) - vehicle.stock_hp} from stock` : null,
                    },
                    {
                      label: 'Torque',
                      value: displayTorque,
                      unit: 'lb-ft',
                      delta: hasModifications && vehicle.stock_torque ? `+${(displayTorque || 0) - vehicle.stock_torque} from stock` : null,
                    },
                    {
                      label: '0-60 mph',
                      value: displayZeroToSixty,
                      unit: 's',
                      delta: hasModifications && vehicle.stock_zero_to_sixty && displayZeroToSixty
                        ? `-${(vehicle.stock_zero_to_sixty - displayZeroToSixty).toFixed(2)}s faster`
                        : null,
                    },
                  ].map(({ label, value, unit, delta }) => (
                    <div key={label} className="px-2 py-4 text-center sm:px-4 sm:py-5">
                      <div className="num text-2xl sm:text-3xl font-bold text-white">
                        {value || '\u2014'}
                        {value && <span className="text-sm font-normal text-white/50 ml-0.5">{unit}</span>}
                      </div>
                      <p className="label-uppercase mt-1.5">{label}</p>
                      {/*
                        ⚠ Not green. "+52 from stock" is a fact about a
                        modification, not a good or a bad one, and the health
                        ramp's green is this product's word for "fine" — a
                        figure borrowing it claims a judgement nothing made.
                      */}
                      {delta && <p className="mt-1 text-xs text-white/55">{delta}</p>}
                    </div>
                  ))}
                </div>

                {/*
                  ⚠ The second loading indicator is gone.

                  A "Checking for updates…" line sat under the figures while the
                  refresh control in this card's own header spun at the same
                  time — two indicators for one fetch, and a critique read the
                  line as permanent furniture: "a perpetual loading affordance
                  under the hero stats is the opposite of well kept".

                  The spinning glyph is the indicator, and it is attached to the
                  control that started the work. Nothing is lost but the
                  duplicate.
                */}
              </>
            )}
          </CardContent>
        </Card>

        {ENABLE_TCO && (
          <>
            <TCOCard
              vehicle={vehicle}
              vehicleId={params.vehicleId}
              onEditInputs={() => setTcoModalOpen(true)}
            />
            <TCOInputsModal
              open={tcoModalOpen}
              onOpenChange={setTcoModalOpen}
              vehicleId={params.vehicleId}
              vehicle={vehicle}
              onSaved={(updated) => setPerfOverrides((prev) => ({ ...prev, ...updated }))}
            />
          </>
        )}

        <Card className="bg-slate-900/60 border-white/10">
          <CardHeader className="pb-4">
            <CardTitle className="display-serif flex items-center gap-2 text-white text-lg">
              <Droplets className="h-5 w-5 text-white/45" />
              Fluid specifications
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/*
              ⚠ Capped width on a desktop. Full-bleed in a 1130px card put
              "Coolant" hard left and its value hard right with about 900px of
              void between them — a critique called it the "classic
              justified-table mistake at wide viewports", and the eye travel is
              the whole cost. A measure the eye can cross keeps the pair
              readable as a pair.
            */}
            {Object.keys(fluidSpecs).length > 0 ? (
              <div className="divide-y divide-white/6 sm:max-w-3xl">
                {/*
                  ── ⚠ Label above value on a phone, side by side above `sm` ──

                  The row was label-left / value-right at every width, so
                  "0W-30 or 0W-40 Full Synthetic (BMW LL-01 spec)" wrapped to
                  three lines of **right-aligned** body copy in a 60% column —
                  ragged-left, which is the hardest alignment to read, four rows
                  running. A design critique named it, and at the other end the
                  same pattern put 900px of empty table between "Coolant" and
                  its value on a desktop.

                  Stacked, the value gets the full column and reads left to
                  right like everything else.
                */}
                {Object.entries(fluidSpecs).map(([key, value]: [string, any]) => (
                  <div
                    key={key}
                    className="py-3 first:pt-0 last:pb-0 sm:flex sm:items-baseline sm:justify-between sm:gap-8"
                  >
                    <span className="label-uppercase block sm:mb-0">{key.replace(/_/g, ' ')}</span>
                    <span className="mt-1 block text-sm font-medium text-white sm:mt-0 sm:max-w-[60%] sm:text-right">
                      {value}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptySpec label="Fluid specifications" />
            )}
          </CardContent>
        </Card>

        <Card className="bg-slate-900/60 border-white/10">
          <CardHeader className="pb-4">
            <CardTitle className="display-serif flex items-center gap-2 text-white text-lg">
              {/*
                ── ⚠ It said "Five" and rendered three ─────────────────────

                The prompt asks the model for five facts; the model returned
                three for this car, and the heading counted anyway. For a
                product whose stated position is that it makes no claim the
                data cannot support, a title that miscounts the list beneath it
                is a credibility wound rather than a nitpick — and it is the
                same defect class as a score computed from no evidence, in
                copy.

                So the heading stops counting. "Worth knowing" is true at three
                facts and at five, which is the only wording that can be.
              */}
              <Lightbulb className="h-5 w-5 text-white/45" />
              Worth knowing
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/*
              ⚠ A hairline-divided list, not one bordered tile per fact inside a
              bordered card inside a bordered page panel. Three levels of
              rounded rectangle for a sentence apiece is the nesting two
              critiques named as this page's most generated-looking habit — and
              the numerals in circles implied a ranking that nothing computes.
            */}
            {interestingFacts.length > 0 ? (
              <div className="divide-y divide-white/8">
                {interestingFacts.map((fact: string, index: number) => (
                  <p
                    key={`fact-${index}`}
                    className="py-3 text-sm leading-normal text-white/70 first:pt-0 last:pb-0"
                  >
                    {fact}
                  </p>
                ))}
              </div>
            ) : (
              <EmptySpec label="Interesting facts" />
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
