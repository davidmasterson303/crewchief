'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Check, CircleCheck as CheckCircle, ThumbsDown, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import ModificationDetailsCard from '@/components/ModificationDetailsCard';
import ModWishlistButton from '@/components/ModWishlistButton';
import TierProgressCard, { type TierProgress, type Tier } from '@/components/TierProgressCard';

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
  earnedTier: Tier;
  tierProgress: TierProgress | null;
  tierProgressLoading: boolean;
  onModStatusUpdate: (modName: string, status: 'pending' | 'completed' | 'not_interested', tier: Tier) => Promise<void>;
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
  earnedTier,
  tierProgress,
  tierProgressLoading,
  onModStatusUpdate,
  onWishlistToggleComplete,
}: ModificationsTabProps) {
  const [showCompleted, setShowCompleted] = useState(false);

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

  return (
    <div className="space-y-4">
      <TierProgressCard progress={tierProgress} loading={tierProgressLoading} />

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
              {activeMods.map((mod) => {
                const details = modDetails[mod.name];

                return (
                  <div key={mod.name}>
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
                        onClick={() => onModStatusUpdate(mod.name, 'completed', earnedTier)}
                        disabled={loading}
                      >
                        <Check className="h-3 w-3 mr-1" />
                        Mark Installed
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs text-white/60"
                        onClick={() => onModStatusUpdate(mod.name, 'not_interested', earnedTier)}
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

          {doneMods.length > 0 && (
            <div className="mt-2">
              <button
                className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white/60 transition-colors"
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
