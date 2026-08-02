'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import DashboardLayout from '@/components/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Gauge, Zap, Timer, Droplets, Lightbulb, Cog, Activity, Loader as Loader2, RefreshCw } from 'lucide-react';
import ResearchButton from '@/components/ResearchButton';
import { getClientSupabase } from '@/lib/supabase';
import { logger } from '@crewchief/core/logger';
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
      <p className="text-sm text-white/35 leading-relaxed max-w-xs">
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
              <p className="text-sm text-white/40">Loading vehicle info...</p>
            </div>
          </div>
        </DashboardLayout>
      );
    }
    return (
      <div className="min-h-screen bg-[#080808] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-2 border-info-border border-t-info rounded-full animate-spin" />
          <p className="text-sm text-white/40">Loading vehicle info...</p>
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
        <div className="max-w-md w-full mx-auto px-6">
          <div className="bg-red-500/10 border border-red-400/25 rounded-2xl p-6">
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
    <DashboardLayout vehicle={vehicle} knowledge={knowledge} currentPage="vehicle-info" vehicleImage={vehicleImage}>
      <div className="space-y-5">
        <div className="flex justify-end">
          <ResearchButton
            vehicleId={vehicle.id}
            year={vehicle.year}
            make={vehicle.make}
            model={vehicle.model}
            hasData={hasPerformanceData || hasInterestingFacts || hasPowertrainData}
          />
        </div>

        <Card className="bg-slate-900/60 border-white/10">
          <CardContent className="pt-5 pb-5">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
              {[
                { icon: Cog, label: 'Engine', value: cleanPowertrain(knowledge?.engine_type) },
                { icon: Activity, label: 'Transmission', value: cleanPowertrain(knowledge?.transmission_type) },
                { icon: Zap, label: 'Drivetrain', value: cleanPowertrain(knowledge?.drivetrain) },
              ].map(({ icon: Icon, label, value }) => (
                <div key={label} className="flex items-start gap-3 p-4 bg-white/4 rounded-xl border border-white/8">
                  <div className="w-8 h-8 rounded-lg bg-info-wash border border-info-border flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Icon className="h-4 w-4 text-info" />
                  </div>
                  <div className="min-w-0">
                    <p className="label-uppercase mb-1">{label}</p>
                    <p className="text-sm font-semibold text-white leading-snug">{value}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900/60 border-white/10">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-white text-base">
                <Zap className="h-5 w-5 text-info" />
                Performance Stats
              </CardTitle>
              <button
                onClick={() => fetchPerformanceStats(true)}
                disabled={perfLoading}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-white/35 hover:text-cyan-400 hover:bg-cyan-400/8 transition-colors disabled:opacity-40"
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
                <p className="text-sm text-white/40">Analyzing performance specs...</p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
                  {[
                    {
                      icon: Gauge,
                      label: 'Horsepower',
                      value: displayHP,
                      unit: 'hp',
                      delta: hasModifications && vehicle.stock_hp ? `+${(displayHP || 0) - vehicle.stock_hp} from stock` : null,
                    },
                    {
                      icon: Zap,
                      label: 'Torque',
                      value: displayTorque,
                      unit: 'lb-ft',
                      delta: hasModifications && vehicle.stock_torque ? `+${(displayTorque || 0) - vehicle.stock_torque} from stock` : null,
                    },
                    {
                      icon: Timer,
                      label: '0-60 mph',
                      value: displayZeroToSixty,
                      unit: 's',
                      delta: hasModifications && vehicle.stock_zero_to_sixty && displayZeroToSixty
                        ? `-${(vehicle.stock_zero_to_sixty - displayZeroToSixty).toFixed(2)}s faster`
                        : null,
                    },
                  ].map(({ icon: Icon, label, value, unit, delta }) => (
                    <div key={label} className="flex flex-col items-center justify-center p-5 bg-white/4 rounded-xl border border-white/8">
                      <Icon className="h-6 w-6 text-info mb-3" />
                      <div className="text-center">
                        <div className="text-3xl font-bold text-white tabular-nums">
                          {value || '\u2014'}
                          {value && <span className="text-base font-normal text-white/50 ml-1">{unit}</span>}
                        </div>
                        <p className="text-xs text-white/40 mt-1">{label}</p>
                        {delta && (
                          <p className="text-xs text-green-400 font-medium mt-1">{delta}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {perfLoading && hasPerformanceData && (
                  <div className="flex items-center justify-center gap-2 mt-4 text-xs text-white/35">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-info" />
                    Checking for updates...
                  </div>
                )}
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
            <CardTitle className="flex items-center gap-2 text-white text-base">
              <Droplets className="h-5 w-5 text-info" />
              Fluid Specifications
            </CardTitle>
          </CardHeader>
          <CardContent>
            {Object.keys(fluidSpecs).length > 0 ? (
              <div className="divide-y divide-white/6">
                {Object.entries(fluidSpecs).map(([key, value]: [string, any]) => (
                  <div key={key} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                    <span className="text-sm text-white/60 capitalize">{key.replace(/_/g, ' ')}</span>
                    <span className="text-sm font-medium text-white text-right max-w-[60%]">{value}</span>
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
            <CardTitle className="flex items-center gap-2 text-white text-base">
              <Lightbulb className="h-5 w-5 text-info" />
              Five Interesting Facts
            </CardTitle>
          </CardHeader>
          <CardContent>
            {interestingFacts.length > 0 ? (
              <div className="space-y-3">
                {interestingFacts.map((fact: string, index: number) => (
                  <div key={`fact-${index}`} className="flex gap-4 p-3.5 bg-white/3 rounded-xl border border-white/6">
                    <div className="flex-shrink-0 w-6 h-6 rounded-lg bg-info-wash border border-info-border flex items-center justify-center text-xs font-bold text-info">
                      {index + 1}
                    </div>
                    <p className="text-sm text-white/70 leading-relaxed flex-1">{fact}</p>
                  </div>
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
