'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Car, Plus } from 'lucide-react';
import { VehicleCard } from '@/components/VehicleCard';
import { useMyVehicles } from '@/hooks/useVehicles';
import { useAuth } from '@/components/AuthProvider';
import { AccountMenu } from '@/components/AccountMenu';
import { RevealOnScroll } from '@/components/RevealOnScroll';

export default function GaragePage() {
  const { loading: authLoading } = useAuth();
  const { data: vehicles = [], isLoading, error: queryError } = useMyVehicles();

  // The vehicle query is disabled until the session resolves, and a disabled
  // query is not "loading" as far as TanStack Query is concerned. Without
  // folding the auth state in, a user with a full garage sees "Your Garage is
  // Empty" for the moment before their session lands.
  const loading = authLoading || isLoading;

  const error = queryError?.message || null;

  return (
    <div className="relative w-full min-h-screen">
      {/*
        CC-142 §5 — flat, not photographic. The garage is now a grid of
        identity plates, each carrying its own make-derived field; a
        photographic backdrop behind them put a second, unrelated image
        underneath every one of those and tinted the lot. It also fetched
        470 KB of `dark-roomb.jpeg` to sit at low opacity behind opaque cards.

        Image backgrounds stay on landing and auth, which are not in scope.
      */}
      <div className="absolute inset-0 z-0 bg-black" />
      {/* Signature vignette — see app/demo/page.tsx. */}
      <div
        className="fixed inset-0 z-0 vignette-frame pointer-events-none"
        aria-hidden="true"
      />

      <nav className="relative z-20 border-b border-info-border" style={{ backgroundColor: '#000000', backdropFilter: 'blur(12px)' }}>
        <div className="max-w-7xl mx-auto px-6 lg:px-12 py-5">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center space-x-3 group">
              <Car className="h-7 w-7 text-cyan-400 transition-transform group-hover:scale-105" />
              <span className="text-xl font-semibold text-white tracking-tight">CrewChief</span>
            </Link>
            <div className="flex items-center gap-3">
              {/*
                `from=garage` marks this as a deliberate visit. /onboard now
                redirects a user who already has vehicles, and without this
                marker that guard would make adding a second car impossible —
                see lib/onboarding.ts.
              */}
              <Link href="/onboard?from=garage">
                <Button className="bg-black border-2 border-cyan-400 hover:bg-cyan-400/10 text-cyan-400 font-semibold">
                  <Plus className="mr-2 h-4 w-4" />
                  Add Vehicle
                </Button>
              </Link>
              <AccountMenu />
            </div>
          </div>
        </div>
      </nav>

      <main className="relative z-20 max-w-7xl mx-auto px-6 lg:px-12 py-16">
        <div className="mb-12">
          <h1 className="text-4xl lg:text-5xl font-bold text-white mb-3 tracking-tight">
            My Garage
          </h1>
          <p className="text-lg text-gray-400">
            {loading ? 'Loading...' : `Managing ${vehicles.length} vehicle${vehicles.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        {loading ? (
          <div className="text-white">Loading your vehicles...</div>
        ) : error ? (
          <div className="border border-red-500/30 rounded-3xl text-center py-16 px-12 bg-gradient-to-b from-red-950/20 to-black/40 backdrop-blur-sm">
            <h2 className="text-2xl font-bold mb-4 text-red-400">Error Loading Vehicles</h2>
            <p className="text-gray-300 mb-4">{error}</p>
            <p className="text-sm text-gray-400">Check console for more details</p>
          </div>
        ) : vehicles.length === 0 ? (
          <div className="border border-info-border rounded-3xl text-center py-32 px-12 bg-gradient-to-b from-black/60 to-black/40 backdrop-blur-sm">
            <div className="mb-8">
              <div className="h-24 w-24 bg-gradient-to-br from-cyan-500/20 to-cyan-500/20 rounded-2xl flex items-center justify-center mx-auto">
                <Car className="h-12 w-12 text-info" />
              </div>
            </div>
            <h2 className="text-4xl font-bold mb-4 text-white tracking-tight">Your Garage is Empty</h2>
            <p className="text-lg text-gray-300 mb-10 max-w-md mx-auto leading-relaxed">
              Add your first vehicle and unlock AI-powered maintenance insights, cost optimization, and repair bundling strategies.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href="/onboard?from=garage">
                <Button size="lg" className="bg-cyan-500 hover:bg-cyan-400 text-black h-14 px-10 rounded-full text-base font-semibold transition-all hover:scale-105">
                  Add Your First Vehicle
                </Button>
              </Link>
              <Link href="/">
                <Button size="lg" variant="outline" className="h-14 px-10 rounded-full text-base font-medium border-cyan-500/50 text-cyan-400 hover:bg-cyan-500/10">
                  Learn More
                </Button>
              </Link>
            </div>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {vehicles.map((vehicle, i) => (
              // Index is per-grid, so the stagger restarts here rather than
              // continuing a count from elsewhere on the page.
              <RevealOnScroll key={vehicle.id} index={i} className="h-full">
                <VehicleCard
                  vehicle={vehicle}
                  activeRecalls={vehicle.nhtsa_data?.[0]?.recalls?.length || 0}
                  healthSummary={vehicle.vehicle_health_summary?.[0]}
                />
              </RevealOnScroll>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
