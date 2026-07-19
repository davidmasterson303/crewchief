'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Car, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { VehicleCard } from '@/components/VehicleCard';
import { useVehicles } from '@/hooks/useVehicles';

const INTERIOR_URL = 'https://images.unsplash.com/photo-1605810230434-7631ac76ec81?auto=format&fit=crop&w=1920&q=80';

const STAGGER_CLASSES = [
  'animate-slide-up',
  'animate-slide-up-delay-1',
  'animate-slide-up-delay-2',
  'animate-slide-up-delay-3',
  'animate-slide-up-delay-4',
  'animate-slide-up-delay-5',
  'animate-slide-up-delay-6',
];

function VehicleCardSkeleton() {
  return (
    <div className="border border-white/8 rounded-2xl overflow-hidden bg-slate-950/80">
      <div className="aspect-[3/2] skeleton-shimmer" />
      <div className="p-5 space-y-4">
        <div className="space-y-2">
          <div className="h-5 w-3/5 skeleton-shimmer rounded-lg" />
          <div className="h-3 w-2/5 skeleton-shimmer rounded-lg" />
        </div>
        <div className="h-16 skeleton-shimmer rounded-xl" />
        <div className="h-12 skeleton-shimmer rounded-xl" />
        <div className="h-11 skeleton-shimmer rounded-xl" />
      </div>
    </div>
  );
}

export default function GaragePage() {
  const { data: vehicles = [], isLoading, error: queryError } = useVehicles();
  const [makeFilter, setMakeFilter] = useState<string | null>(null);

  const uniqueMakes = useMemo(() => {
    const makes = Array.from(new Set(vehicles.map((v: any) => v.make))).sort();
    return (makes as string[]).length > 1 ? (makes as string[]) : [];
  }, [vehicles]);

  const filteredVehicles = useMemo(() => {
    if (!makeFilter) return vehicles;
    return vehicles.filter((v: any) => v.make === makeFilter);
  }, [vehicles, makeFilter]);

  return (
    <div className="relative w-full min-h-screen">
      <div
        className="fixed inset-0 z-0"
        style={{
          backgroundImage: `linear-gradient(rgba(15,23,42,0.85), rgba(15,23,42,0.95)), url('${INTERIOR_URL}')`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      />

      <div className="relative z-10">
        <nav className="border-b border-white/8 bg-black/80 backdrop-blur-xl">
          <div className="max-w-7xl mx-auto px-6 lg:px-12 py-4">
            <div className="flex items-center justify-between">
              <Link href="/" className="flex items-center space-x-2.5 group">
                <Car className="h-6 w-6 text-white transition-transform group-hover:scale-105" />
                <span className="text-lg font-semibold text-white tracking-tight">CrewChief</span>
              </Link>
              <div className="flex items-center gap-3">
                <Link href="/onboard">
                  <Button className="bg-cyan-600 hover:bg-cyan-500 text-white font-semibold rounded-xl transition-all text-sm h-9 px-4">
                    <Plus className="mr-2 h-4 w-4" />
                    Add Vehicle
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </nav>

        <main className="max-w-7xl mx-auto px-6 lg:px-12 py-14">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8">
            <div>
              <h1 className="text-4xl lg:text-5xl font-bold text-white mb-2 tracking-tight">
                My Garage
              </h1>
              <p className="text-base text-white/50">
                {isLoading
                  ? 'Loading vehicles...'
                  : queryError
                  ? 'Unable to load vehicles'
                  : vehicles.length === 0
                  ? 'No vehicles yet'
                  : `${vehicles.length} vehicle${vehicles.length !== 1 ? 's' : ''} tracked`}
              </p>
            </div>
          </div>

          {uniqueMakes.length > 0 && !isLoading && (
            <div className="flex items-center gap-2 mb-6 flex-wrap">
              <button
                onClick={() => setMakeFilter(null)}
                className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition-all border ${
                  makeFilter === null
                    ? 'bg-cyan-600 text-white border-cyan-600'
                    : 'bg-white/5 text-white/60 border-white/10 hover:bg-white/10 hover:text-white'
                }`}
              >
                All
              </button>
              {uniqueMakes.map((make) => (
                <button
                  key={make}
                  onClick={() => setMakeFilter(makeFilter === make ? null : make)}
                  className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition-all border ${
                    makeFilter === make
                      ? 'bg-cyan-600 text-white border-cyan-600'
                      : 'bg-white/5 text-white/60 border-white/10 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  {make}
                </button>
              ))}
              {makeFilter && (
                <span className="text-xs text-white/40 ml-1">
                  {filteredVehicles.length} of {vehicles.length}
                </span>
              )}
            </div>
          )}

          {queryError && (
            <div className="mb-8 p-4 border border-red-500/30 rounded-xl bg-red-500/8 flex items-center justify-between gap-4">
              <p className="text-red-400 text-sm">Failed to load vehicles. Please try refreshing.</p>
              <Button
                onClick={() => window.location.reload()}
                size="sm"
                variant="outline"
                className="border-red-500/30 text-red-400 hover:bg-red-500/10 shrink-0"
              >
                Refresh
              </Button>
            </div>
          )}

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {isLoading ? (
              [1, 2, 3].map((i) => <VehicleCardSkeleton key={i} />)
            ) : filteredVehicles.length > 0 ? (
              filteredVehicles.map((vehicle: any, index: number) => (
                <div key={vehicle.id} className={STAGGER_CLASSES[Math.min(index, STAGGER_CLASSES.length - 1)]}>
                  <VehicleCard
                    vehicle={vehicle}
                    activeRecalls={vehicle.nhtsa_data?.[0]?.recalls?.length || 0}
                    healthSummary={vehicle.vehicle_health_summary?.[0]}
                  />
                </div>
              ))
            ) : makeFilter ? (
              <div className="col-span-full text-center py-12">
                <p className="text-white/50 text-base">No {makeFilter} vehicles in the garage.</p>
                <button onClick={() => setMakeFilter(null)} className="text-cyan-400 text-sm mt-2 hover:text-cyan-300 transition-colors">
                  Show all vehicles
                </button>
              </div>
            ) : null}
          </div>
        </main>
      </div>
    </div>
  );
}
