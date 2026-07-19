'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Car, ArrowRight } from 'lucide-react';
import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { VehicleCard } from '@/components/VehicleCard';
import { supabase } from '@/lib/supabase';

const LandingHero = dynamic(() => import('@/components/LandingHero'), { ssr: false });

const INTERIOR_URL = '/dark-roomb.jpeg';

export default function DemoPage() {
  const [isGarageOpen, setIsGarageOpen] = useState(false);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDemoVehicles();
    const timer = setTimeout(() => setIsGarageOpen(true), 600);
    return () => clearTimeout(timer);
  }, []);

  const loadDemoVehicles = async () => {
    try {
      const { data } = await supabase
        .from('vehicles')
        .select(`
          id,year,make,model,trim,color,current_mileage,image_url,custom_image_url,performance_goal,ownership_objective,
          nhtsa_data(recalls),
          vehicle_health_summary(health_score,summary,red_flags)
        `)
        .eq('is_demo', true)
        .order('created_at', { ascending: true });

      setVehicles(data || []);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative w-full min-h-screen">
      <div
        className="absolute inset-0 z-0"
        style={{
          backgroundImage: `linear-gradient(rgba(0, 0, 0, 0.15), rgba(0, 0, 0, 0.15)), url('${INTERIOR_URL}')`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundAttachment: 'fixed'
        }}
      />

      <nav className="relative z-20 border-b border-white/10 bg-black/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 lg:px-12 py-4">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center space-x-2.5 group">
              <Car className="h-6 w-6 text-cyan-400 transition-transform group-hover:scale-105" />
              <span className="text-lg font-semibold text-white tracking-tight">CrewChief</span>
            </Link>
            <Link href="/onboard?from=demo">
              <Button className="bg-cyan-600 hover:bg-cyan-500 text-white font-semibold rounded-xl text-sm h-9 px-4 gap-2">
                Add Your Vehicle
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      <main className="relative z-20 max-w-7xl mx-auto px-6 lg:px-12 py-16">
        <div className="mb-12">
          <h1 className="text-4xl lg:text-5xl font-bold text-white mb-3 tracking-tight">
            Demo Garage
          </h1>
          <p className="text-base text-white/50">
            {loading ? 'Loading demo vehicles...' : `Exploring ${vehicles.length} demo vehicle${vehicles.length !== 1 ? 's' : ''}`}
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          {loading ? (
            <>
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-96 bg-white/5 rounded-2xl animate-pulse border border-white/8" />
              ))}
            </>
          ) : vehicles.length > 0 ? (
            vehicles.map((vehicle) => (
              <VehicleCard
                key={vehicle.id}
                vehicle={vehicle}
                activeRecalls={vehicle.nhtsa_data?.[0]?.recalls?.length || 0}
                healthSummary={vehicle.vehicle_health_summary?.[0]}
              />
            ))
          ) : (
            <div className="col-span-full text-center py-12 text-white/40">
              <Car className="h-16 w-16 mx-auto mb-4 opacity-50" />
              <p className="text-lg font-medium">Demo vehicles not available</p>
              <p className="text-sm mt-2">Please check back later</p>
            </div>
          )}
        </div>
      </main>

      <LandingHero isOpen={isGarageOpen} onEnter={() => setIsGarageOpen(true)} />
    </div>
  );
}
