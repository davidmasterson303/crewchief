'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Check, CircleCheck as CheckCircle, ThumbsDown, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import { nextRungs, progressionSummary } from '@crewchief/core/mod-progression';
import { buildPosition, buildSummary } from '@crewchief/core/build-progress';
import { BuildGauge } from '@/components/BuildGauge';
import ModificationDetailsCard from '@/components/ModificationDetailsCard';
import ModWishlistButton from '@/components/ModWishlistButton';

interface Mod {
  name: string;
  details?: unknown;
  [key: string]: unknown;
}

interface ModTracking {
  mod_name: string;
  status: string;
  tier?: string;
  is_backfill?: boolean;
}

interface ModificationsTabProps {
  vehicle: { id: string; [key: string]: unknown };
  performanceMods: Mod[];
  modDetails: Record<string, unknown>;
  modTracking: ModTracking[];
  savedItemNames: Set<string>;
  loading: boolean;
  loadingModNames: boolean;
  onModStatusUpdate: (modName: string, status: 'pending' | 'completed' | 'not_interested') => Promise<void>;
  onWishlistToggleComplete: () => Promise<void>;
}

export default function ModificationsTab({
  vehicle,
  performanceMods,
  modDetails,
  modTracking,
  savedItemNames,
  loading,
  loadingModNames,
  onModStatusUpdate,
  onWishlistToggleComplete,
}: ModificationsTabProps) {
  const [showCompleted, setShowCompleted] = useState(false);
  const [showRest, setShowRest] = useState(false);

  const getModStatus = (modName: string) =>
    modTracking.find(t => t.mod_name === modName);

  const activeMods = performanceMods.filter((mod) => {
    const tracking = getModStatus(mod.name);
    return !tracking || tracking.status === 'pending';
  });

  const doneMods = performanceMods.filter((mod) => {
    const tracking = getModStatus(mod.name);
    return tracking && (tracking.status === 'completed' || tracking.status === 'not_interested');
  });

  /*
    ── The next rungs, rather than everything at once ────────────────────────

    David, 7 Aug: "we don't have to show 100% of the available mods for the car,
    just an assortment of next logical progression kind of thing."

    `nextRungs` orders by role — foundation, then control, then the parts that
    only exist to enable a bigger step — and returns a handful. The rest is not
    thrown away: it sits behind "Show the rest", because hiding a part the
    owner's own knowledge base offered would be a different complaint about the
    same screen.

    Only `completed` counts as done for the ladder. `not_interested` is in
    `doneMods` for display, but treating a declined mod as a completed step
    would advance the build on the strength of a refusal.
  */
  const completedNames = modTracking
    .filter((t) => t.status === 'completed')
    .map((t) => t.mod_name);

  const rungs = nextRungs({
    mods: activeMods,
    completed: completedNames,
    mindedness: vehicle.performance_mindedness as string | undefined,
  });

  /*
    Where this build sits, on the same instrument the health score uses.

    Weighted by the difficulty the vehicle's own knowledge base assigned, and
    counted only from mods actually marked installed — a dial that moved when
    someone *considered* a turbo would be measuring intent and calling it a
    build.
  */
  const position = buildPosition(
    performanceMods
      .filter((m) => completedNames.includes(m.name))
      /*
        `Mod` carries an index signature, so `difficulty` widens to `unknown`.
        Narrowed here rather than loosening `effortOf` — an unrecognised value
        already scores as Moderate, and a signature that accepted `unknown`
        would hide the day this field stops being a string.
      */
      .map((m) => ({ difficulty: typeof m.difficulty === 'string' ? m.difficulty : null }))
  );

  const rungNames = new Set(rungs.map((r) => r.name));
  const restMods = activeMods.filter((mod) => !rungNames.has(mod.name));
  const shownMods = showRest ? activeMods : activeMods.filter((mod) => rungNames.has(mod.name));

  return (
    <div className="space-y-4">
      {/*
        The build dial. Sits above the ladder because it answers "where am I"
        before "what next" — the same order the dashboard puts the health score
        above its recommendations.
      */}
      <div className="flex items-center gap-5 rounded-xl border border-white/8 bg-white/4 p-4">
        <BuildGauge position={position} size={140} />
        <p className="flex-1 text-sm text-white/70">
          {buildSummary(position, restMods.length + rungs.length)}
        </p>
      </div>

      {/*
        `TierProgressCard` used to sit here. The dial replaces it: it showed
        progress toward a *next tier*, which is the end-state framing the
        continuum removed. Its props are still accepted so the parent needs no
        change in the same commit, and they are unused on purpose — see the
        interface.
      */}

      {loadingModNames && activeMods.length === 0 ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 bg-white/5 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : activeMods.length === 0 && doneMods.length === 0 ? (
        <p className="text-sm text-white/60 text-center py-8 italic">
          No modifications available for your current tier.
        </p>
      ) : (
        <>
          {activeMods.length === 0 && doneMods.length > 0 ? (
            <p className="text-sm text-white/60 text-center py-4 italic">
              All mods for this tier are completed or skipped.
            </p>
          ) : (
            <div className="space-y-3">
              {rungs.length > 0 && (
                <p className="text-xs text-white/60">
                  {progressionSummary(rungs, completedNames)}
                </p>
              )}

              {shownMods.map((mod) => {
                const details = modDetails[mod.name];
                const rung = rungs.find((r) => r.name === mod.name);

                return (
                  <div key={mod.name}>
                    {/*
                      Why this one is next, in the owner's terms. Only on the
                      rungs — a card under "Show the rest" has no claim to being
                      the next step and should not carry a sentence saying it is.
                    */}
                    {rung && (
                      <p className="text-xs text-cyan-300/70 mb-1.5">{rung.rationale}</p>
                    )}
                    <ModificationDetailsCard
                      vehicleId={vehicle.id as string}
                      modName={mod.name}
                      vehicle={vehicle}
                      details={details}
                    />
                    <div className="mt-2 ml-1 flex gap-2 flex-wrap">
                      <ModWishlistButton
                        vehicleId={vehicle.id as string}
                        modName={mod.name}
                        isInWishlist={savedItemNames.has(mod.name)}
                        onWishlistToggleComplete={onWishlistToggleComplete}
                        loading={loading}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => onModStatusUpdate(mod.name, 'completed')}
                        disabled={loading}
                      >
                        <Check className="h-3 w-3 mr-1" />
                        Mark Installed
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs text-white/60"
                        onClick={() => onModStatusUpdate(mod.name, 'not_interested')}
                        disabled={loading}
                      >
                        <ThumbsDown className="h-3 w-3 mr-1" />
                        Not Interested
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {restMods.length > 0 && !showRest && (
            <button
              className="flex items-center gap-1.5 text-xs text-white/60 hover:text-white/75 transition-colors"
              onClick={() => setShowRest(true)}
            >
              <ChevronDown className="h-3 w-3" />
              Show the other {restMods.length} {restMods.length === 1 ? 'modification' : 'modifications'} for this car
            </button>
          )}

          {doneMods.length > 0 && (
            <div className="mt-2">
              <button
                className="flex items-center gap-1.5 text-xs text-white/50 hover:text-white/60 transition-colors"
                onClick={() => setShowCompleted((v) => !v)}
              >
                {showCompleted ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {showCompleted ? 'Hide' : 'Show'} {doneMods.length} completed / skipped
              </button>

              {showCompleted && (
                <div className="space-y-3 mt-3 opacity-60">
                  {doneMods.map((mod) => {
                    const tracking = getModStatus(mod.name);
                    const isCompleted = tracking?.status === 'completed';
                    const details = modDetails[mod.name];

                    return (
                      <div key={mod.name}>
                        <ModificationDetailsCard
                          vehicleId={vehicle.id as string}
                          modName={mod.name}
                          vehicle={vehicle}
                          details={details}
                        />
                        <div className="mt-2 ml-1">
                          {isCompleted ? (
                            <Badge className="bg-gradient-to-r from-green-500/30 to-emerald-500/30 text-green-200 border-green-400/50 px-3 py-1 text-xs font-semibold">
                              <CheckCircle className="h-3 w-3 mr-1.5" />
                              Installed
                            </Badge>
                          ) : (
                            <Badge className="bg-white/10 text-white/50 border-white/20 text-xs">
                              Skipped
                            </Badge>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
