'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ArrowRight } from 'lucide-react';
import Logo from '@/components/brand/Logo';
import { VehicleCard } from '@/components/VehicleCard';
import GarageDoor, { useIntroRevealed } from '@/components/GarageDoor';
import LandingHero from '@/components/LandingHero';
import { AppStoreCTA } from '@/components/AppStoreCTA';
import { useAuth } from '@/components/AuthProvider';
import { useDemoVehicles, type GarageVehicle } from '@/hooks/useVehicles';

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
 *
 * ── 8 Aug: the filled slot is the app, not sign-up ──────────────────────────
 *
 * The hero carries the same CTA, but the hero is *behind the lifted door* — a
 * visitor who presses "Enter demo" and browses the three cars never sees it
 * again. This nav is the only surface that stays with them, so it is where the
 * pitch has to survive. Sign-up is still reachable via `/login`'s "Sign up
 * free" link; it does not need the loudest slot on a page whose product is on
 * the App Store.
 */
function PublicNavActions() {
  const { user, loading } = useAuth();

  if (!loading && user) {
    return (
      <Link href="/garage">
        <Button className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-xl transition-all text-sm h-9 px-4">
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
        className="px-2 sm:px-3 py-2 text-sm font-medium text-white/60 hover:text-white transition-colors rounded-xl whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
      >
        Sign in
      </Link>
      <AppStoreCTA variant="nav" />
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
        The room is built, not photographed — see `.service-bay` in
        globals.css for why, and public/CREDITS.md for what it replaced.

        The scrim went with the photograph. It existed to stop a picture of a
        garage from fighting the type, and there is no longer a picture: every
        value in the plate was chosen against white text on this page. Its own
        vignette layer also makes the separate `.vignette-frame` overlay
        redundant, so two fixed divs collapse into one.
      */}
      <div className="fixed inset-0 z-0 service-bay" aria-hidden="true" />

      <div className="relative z-10">
        <nav className="relative bay-batten border-b border-white/8 bg-black/80 backdrop-blur-xl">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-12 py-4">
            <div className="flex items-center justify-between">
              <Link href="/" className="flex items-center group">
                {/* 21px mark — the small cut, switched inside the component. */}
                <Logo variant="horizontal" size={21} />
              </Link>
              <PublicNavActions />
            </div>
          </div>
        </nav>

        {/* RB0 rule 1 pairs four-up at `2xl` with a wider shell, and the pair is
            not optional: four columns inside `max-w-7xl` yields ~290px cards,
            narrower than the 338px the same card gets at 700px in two-up. The
            shell has to widen or the fourth column is a regression. */}
        <main className="max-w-7xl 2xl:max-w-[96rem] mx-auto px-4 sm:px-6 lg:px-12 py-14">
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
              {/*
                ⚠ "demo" removed from the transient states on 21 Aug, and the
                reason is not tone. This page is served by **both** deployments,
                and on `crewchief.davidmasterson.co` it is the hostname in the
                App Store listing — where copy calling the product a demo is the
                Guideline 4.2 argument made in our own words. Same class as the
                og:description fixed on 20 Aug.

                Not gated per-site, because these two strings are honest on both
                and a gate here would need a client-readable flag this component
                does not otherwise want. The demo host still says what it is —
                loudly, in the masthead above.
              */}
              <p className="text-base text-white/50">
                {isLoading
                  ? 'Loading…'
                  : queryError
                  ? 'Unable to load vehicles'
                  : vehicles.length === 0
                  ? 'Vehicles unavailable'
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

          {/* One grid, shared with /garage — RB0 rule 1. Two-up arrives at
              `sm`, not `md`: skipping it rendered a single 600px-wide card
              across 640-767px, where a landscape phone and a small tablet both
              land. `2xl` takes the fourth column that `max-w-7xl` was
              otherwise leaving as gutter. */}
          <div className="grid gap-5 sm:gap-6 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
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
                {/* Resting glyph: mark alone, one colour, --text-muted-40. */}
                <Logo variant="mark" size={40} mono color="var(--text-muted-40)" className="mx-auto mb-5" />
                <h2 className="text-xl font-semibold text-white mb-2">
                  Demo vehicles unavailable
                </h2>
                <p className="text-white/50 text-sm max-w-md mx-auto mb-7">
                  The demo garage could not be loaded just now. This is usually
                  temporary &mdash; try again in a moment.
                </p>
                <Button
                  onClick={() => window.location.reload()}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-xl transition-all h-10 px-5"
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
