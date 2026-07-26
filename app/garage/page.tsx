'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Car, Plus } from 'lucide-react';
import { VehicleCard } from '@/components/VehicleCard';
import { useVehicles } from '@/hooks/useVehicles';
import { AccountMenu } from '@/components/AccountMenu';

export default function GaragePage() {
  const { data: vehicles = [], isLoading: loading, error: queryError } = useVehicles();

  const error = queryError?.message || null;

  return (
    <div className="relative w-full min-h-screen">
      <div
        className="absolute inset-0 z-0"
        style={{
          backgroundImage: `linear-gradient(135deg, rgba(0, 0, 0, 0.4) 0%, rgba(0, 0, 0, 0.3) 50%, rgba(0, 0, 0, 0.45) 100%), url('/dark-roomb.jpeg')`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundAttachment: 'fixed'
        }}
      />
      {/* Signature vignette — see app/demo/page.tsx. */}
      <div
        className="fixed inset-0 z-0 vignette-frame pointer-events-none"
        aria-hidden="true"
      />

      <nav className="relative z-20 border-b border-cyan-500/30" style={{ backgroundColor: '#000000', backdropFilter: 'blur(12px)' }}>
        <div className="max-w-7xl mx-auto px-6 lg:px-12 py-5">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center space-x-3 group">
              <Car className="h-7 w-7 text-cyan-400 transition-transform group-hover:scale-105" />
              <span className="text-xl font-semibold text-white tracking-tight">CrewChief</span>
            </Link>
            <div className="flex items-center gap-3">
              <Link href="/onboard">
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
          <div className="border border-cyan-500/30 rounded-3xl text-center py-32 px-12 bg-gradient-to-b from-black/60 to-black/40 backdrop-blur-sm">
            <div className="mb-8">
              <div className="h-24 w-24 bg-gradient-to-br from-cyan-500/20 to-cyan-500/20 rounded-2xl flex items-center justify-center mx-auto">
                <Car className="h-12 w-12 text-cyan-400" />
              </div>
            </div>
            <h2 className="text-4xl font-bold mb-4 text-white tracking-tight">Your Garage is Empty</h2>
            <p className="text-lg text-gray-300 mb-10 max-w-md mx-auto leading-relaxed">
              Add your first vehicle and unlock AI-powered maintenance insights, cost optimization, and repair bundling strategies.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href="/onboard">
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
            {vehicles.map((vehicle) => (
              <VehicleCard
                key={vehicle.id}
                vehicle={vehicle}
                activeRecalls={vehicle.nhtsa_data?.[0]?.recalls?.length || 0}
                healthSummary={vehicle.vehicle_health_summary?.[0]}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
