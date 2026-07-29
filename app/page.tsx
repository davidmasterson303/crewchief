'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Car, Plus } from 'lucide-react';
import { VehicleCard } from '@/components/VehicleCard';
import { useDemoVehicles, type GarageVehicle } from '@/hooks/useVehicles';

// Self-hosted (was hot-linked from Unsplash — a third-party outage or
// rate limit would grey out the landing visual).
const INTERIOR_URL = '/dark-roomb.jpeg';

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
  const { data: vehicles = [], isLoading, error: queryError } = useDemoVehicles();

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
                  ? 'Loading your garage…'
                  : queryError
                  ? 'Unable to load vehicles'
                  : vehicles.length === 0
                  ? 'No vehicles yet — add one and CrewChief builds its dossier'
                  : `${vehicles.length} vehicle${vehicles.length !== 1 ? 's' : ''} tracked`}
              </p>
            </div>
          </div>

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
            ) : vehicles.length > 0 ? (
              vehicles.map((vehicle: GarageVehicle, index: number) => (
                <div
                  key={vehicle.id}
                  className="animate-slide-up"
                  style={{ animationDelay: `${Math.min(index * 90, 700)}ms` }}
                >
                  <VehicleCard
                    vehicle={vehicle}
                    activeRecalls={vehicle.nhtsa_data?.[0]?.recalls?.length || 0}
                    healthSummary={vehicle.vehicle_health_summary?.[0]}
                  />
                </div>
              ))
            ) : (
              <div className="col-span-full text-center py-20">
                <Car className="h-10 w-10 text-white/25 mx-auto mb-5" />
                <h2 className="text-xl font-semibold text-white mb-2">Your garage is empty</h2>
                <p className="text-white/50 text-sm max-w-md mx-auto mb-7">
                  Add a vehicle and CrewChief builds its dossier &mdash; known issues,
                  factory maintenance schedule, fluid specs, and an AI consultant that
                  knows your car.
                </p>
                <Link href="/onboard">
                  <Button className="bg-cyan-600 hover:bg-cyan-500 text-white font-semibold rounded-xl transition-all h-10 px-5">
                    <Plus className="mr-2 h-4 w-4" />
                    Add Your First Vehicle
                  </Button>
                </Link>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
