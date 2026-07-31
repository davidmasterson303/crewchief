'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ArrowRight, Car } from 'lucide-react';
import { VehicleCard } from '@/components/VehicleCard';
import GarageDoor, { useIntroRevealed } from '@/components/GarageDoor';
import LandingHero from '@/components/LandingHero';
import { useAuth } from '@/components/AuthProvider';
import { useDemoVehicles, type GarageVehicle } from '@/hooks/useVehicles';

/*
 * Self-hosted (was hot-linked from Unsplash — a third-party outage or rate
 * limit would grey out the landing visual).
 *
 * Points at the 1920-wide derivative rather than the 3333×2000 master: this is
 * a full-bleed background, so it was serving about three times the pixels any
 * viewport asked for. 480 KB → 142 KB.
 *
 * `public/CREDITS.md` records what is known about this file, and — unlike every
 * other image on the site — that includes not knowing its photographer or
 * licence. Worth reading before it appears in a store capture.
 */
const INTERIOR_URL = '/garage-interior-1920.jpg';

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
  return (
    <GarageDoor panel={(enter) => <LandingHero onEnter={enter} />}>
      <GarageContents />
    </GarageDoor>
  );
}

/**
 * The nav actions on a page anyone can reach.
 *
 * This slot used to hold "Add Vehicle" pointing at `/onboard`, which is in
 * `PROTECTED_ROUTES` — so the first thing an anonymous visitor could click on
 * the public demo bounced them to `/login?redirect=/onboard`. For an audience
 * that arrives from a portfolio link, that is an auth wall as a first
 * impression, and it was the only CTA in the nav.
 *
 * While the session is still resolving, the signed-out pair is rendered rather
 * than a gap: `/` is public and most of its traffic is anonymous, so that is
 * both the likely answer and the one that avoids a hole in the nav.
 */
function PublicNavActions() {
  const { user, loading } = useAuth();

  if (!loading && user) {
    return (
      <Link href="/garage">
        <Button className="bg-cyan-600 hover:bg-cyan-500 text-white font-semibold rounded-xl transition-all text-sm h-9 px-4">
          My Garage
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-1 sm:gap-3">
      <Link
        href="/login"
        className="px-3 py-2 text-sm font-medium text-white/60 hover:text-white transition-colors rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
      >
        Sign in
      </Link>
      <Link href="/signup">
        <Button className="bg-cyan-600 hover:bg-cyan-500 text-white font-semibold rounded-xl transition-all text-sm h-9 px-4">
          Sign up
        </Button>
      </Link>
    </div>
  );
}

/*
 * Split out so the page below the door is an ordinary component that mounts
 * once and knows nothing about the intro. The predecessor threaded an `isOpen`
 * boolean through the page and passed it back down to the curtain, which is
 * how the two got out of step; there is nothing to thread here.
 */
function GarageContents() {
  const { data: vehicles = [], isLoading, error: queryError } = useDemoVehicles();
  const revealed = useIntroRevealed();

  return (
    <div className="relative w-full min-h-screen">
      {/*
        The scrim was rgba(15,23,42,0.85) → 0.95, which let 5–15% of the
        photograph through. It read as flat near-black with a couple of faint
        smudges, and the garage it is a photograph *of* was not legible at any
        point — 480 KB doing almost no visual work, which is the exact fault
        DiagnosticHero's comment records ("roughly a tenth of each 700 KB
        photograph did any visual work").

        Opened up to 0.58 → 0.88. Still a dark room, still comfortably behind
        white text, but now a room. The gradient stays top-heavier at the bottom
        so the cards keep their contrast where they actually sit.
      */}
      <div
        className="fixed inset-0 z-0"
        style={{
          backgroundImage: `linear-gradient(rgba(15,23,42,0.58), rgba(15,23,42,0.88)), url('${INTERIOR_URL}')`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      />

      {/* The signature photography treatment, as every other photo surface
          gets it. This one was hand-rolling a scrim and skipping the vignette,
          which is the drift `.vignette-frame` exists to stop. */}
      <div className="fixed inset-0 z-0 vignette-frame pointer-events-none" aria-hidden="true" />

      <div className="relative z-10">
        <nav className="border-b border-white/8 bg-black/80 backdrop-blur-xl">
          <div className="max-w-7xl mx-auto px-6 lg:px-12 py-4">
            <div className="flex items-center justify-between">
              <Link href="/" className="flex items-center space-x-2.5 group">
                <Car className="h-6 w-6 text-white transition-transform group-hover:scale-105" />
                <span className="text-lg font-semibold text-white tracking-tight">CrewChief</span>
              </Link>
              <PublicNavActions />
            </div>
          </div>
        </nav>

        <main className="max-w-7xl mx-auto px-6 lg:px-12 py-14">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8">
            <div>
              {/*
                Not "My Garage" any more. These are the three seeded demo cars
                and this page is public, so the possessive was telling every
                anonymous visitor that somebody else's vehicles were theirs.

                And no longer "three *real* cars". public/vehicles/CREDITS.md
                records that the Accord is an 8th-generation car standing in for
                a 2018 tenth-gen, the WRX is a VB standing in for a 2020, and the
                M3 may be an F30 with the M-Sport package rather than an F80.
                "Real" invites exactly the one inspection the photographs fail,
                on a page whose audience is people paid to look closely. What is
                genuinely real is the research, so the claim moved onto that.
              */}
              <h1 className="text-4xl lg:text-5xl font-bold text-white mb-2 tracking-tight">
                A Live Garage
              </h1>
              <p className="text-base text-white/50">
                {isLoading
                  ? 'Loading the demo garage…'
                  : queryError
                  ? 'Unable to load vehicles'
                  : vehicles.length === 0
                  ? 'Demo vehicles unavailable'
                  : 'Three cars, researched end to end — open any one for its dossier'}
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
                /*
                  The stagger waits for the door.

                  It used to run on mount, behind a closed curtain, and finish
                  about a second later — so on any load that played the intro
                  the cards had already settled before the visitor pressed the
                  opener, and the door lifted onto a static grid.

                  `revealed` is true immediately when there is no intro, so a
                  returning visitor still gets the entrance on page load.
                */
                <div
                  key={vehicle.id}
                  className={revealed ? 'animate-slide-up' : 'opacity-0'}
                  style={revealed ? { animationDelay: `${Math.min(index * 90, 700)}ms` } : undefined}
                >
                  <VehicleCard
                    vehicle={vehicle}
                    activeRecalls={vehicle.nhtsa_data?.[0]?.recalls?.length || 0}
                    healthSummary={vehicle.vehicle_health_summary?.[0]}
                  />
                </div>
              ))
            ) : (
              /*
                An empty result here is a data failure, not an empty garage.
                This page always shows the three seeded demo cars, so zero rows
                means the query came back empty — and the old copy responded by
                inviting an anonymous visitor to add their first vehicle via a
                protected route. Offering a retry is the honest answer.
              */
              <div className="col-span-full text-center py-20">
                <Car className="h-10 w-10 text-white/25 mx-auto mb-5" />
                <h2 className="text-xl font-semibold text-white mb-2">
                  Demo vehicles unavailable
                </h2>
                <p className="text-white/50 text-sm max-w-md mx-auto mb-7">
                  The demo garage could not be loaded just now. This is usually
                  temporary &mdash; try again in a moment.
                </p>
                <Button
                  onClick={() => window.location.reload()}
                  className="bg-cyan-600 hover:bg-cyan-500 text-white font-semibold rounded-xl transition-all h-10 px-5"
                >
                  Retry
                </Button>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
