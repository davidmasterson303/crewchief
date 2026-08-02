'use client';

import { Gauge, Zap, Rocket, Lock, ChevronRight, Loader as Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export type Tier = 'mild' | 'moderate' | 'aggressive';

export interface TierProgress {
  currentTier: Tier;
  completed: number;
  skipped: number;
  total: number;
  backfillsRequired: number;
  backfillsPending: number;
  canAdvance: boolean;
}

interface TierConfig {
  label: string;
  icon: React.ElementType;
  color: string;
  bgColor: string;
  borderColor: string;
  ringColor: string;
  description: string;
  nextLabel?: string;
}

const TIER_CONFIG: Record<Tier, TierConfig> = {
  mild: {
    label: 'Mild Builder',
    icon: Gauge,
    color: 'text-info',
    bgColor: 'bg-info-wash',
    borderColor: 'border-cyan-500/40',
    ringColor: 'ring-cyan-500/30',
    description: 'Bolt-on improvements, OEM+ reliability',
    nextLabel: 'Moderate',
  },
  moderate: {
    label: 'Moderate Builder',
    icon: Zap,
    color: 'text-yellow-400',
    bgColor: 'bg-yellow-500/15',
    borderColor: 'border-yellow-500/40',
    ringColor: 'ring-yellow-500/30',
    description: 'Balanced performance and reliability',
    nextLabel: 'Aggressive',
  },
  aggressive: {
    label: 'Aggressive Builder',
    icon: Rocket,
    color: 'text-red-400',
    bgColor: 'bg-red-500/15',
    borderColor: 'border-red-500/40',
    ringColor: 'ring-red-500/30',
    description: 'Track-focused, always evolving',
  },
};

interface TierProgressCardProps {
  progress: TierProgress | null;
  loading?: boolean;
}

export default function TierProgressCard({ progress, loading }: TierProgressCardProps) {
  if (loading || !progress) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-4 mb-4 animate-pulse">
        <div className="h-5 w-32 bg-white/10 rounded mb-2" />
        <div className="h-3 w-48 bg-white/10 rounded mb-3" />
        <div className="h-1.5 w-full bg-white/10 rounded-full" />
      </div>
    );
  }

  const config = TIER_CONFIG[progress.currentTier];
  const Icon = config.icon;

  const actionableDone = progress.completed + progress.skipped;
  const pct = progress.total > 0 ? Math.min(100, Math.round((actionableDone / progress.total) * 100)) : 0;

  const isAggressive = progress.currentTier === 'aggressive';
  const hasPendingBackfills = progress.backfillsPending > 0;

  return (
    <div className={`rounded-xl border ${config.borderColor} ${config.bgColor} p-4 mb-4`}>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <div className={`p-1.5 rounded-lg ${config.bgColor} ring-1 ${config.ringColor}`}>
            <Icon className={`h-4 w-4 ${config.color}`} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-white">{config.label}</span>
              <Badge className={`text-xs px-1.5 py-0 ${config.bgColor} ${config.color} border ${config.borderColor}`}>
                EARNED
              </Badge>
            </div>
            <p className="text-xs text-white/50 leading-tight">{config.description}</p>
          </div>
        </div>

        {!isAggressive && (
          <div className="flex items-center gap-1 text-white/30">
            <Lock className="h-3 w-3" />
            <span className="text-xs">{config.nextLabel}</span>
            <ChevronRight className="h-3 w-3" />
          </div>
        )}
      </div>

      {isAggressive ? (
        <div className="mt-3 flex items-center gap-2">
          <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
            <div className="h-full w-full bg-gradient-to-r from-red-500 to-orange-500 rounded-full animate-pulse" />
          </div>
          <span className="text-xs text-white/40 whitespace-nowrap">Always evolving</span>
        </div>
      ) : (
        <div className="mt-3 space-y-1.5">
          <div className="flex justify-between items-center">
            <span className="text-xs text-white/50">
              {actionableDone} of {progress.total} mods completed or accepted
            </span>
            <span className={`text-xs font-medium ${pct === 100 ? config.color : 'text-white/50'}`}>
              {pct}%
            </span>
          </div>
          <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                pct === 100
                  ? `bg-gradient-to-r ${progress.currentTier === 'mild' ? 'from-cyan-500 to-cyan-400' : 'from-yellow-500 to-yellow-400'}`
                  : 'bg-white/30'
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>

          {hasPendingBackfills && (
            <div className="flex items-center gap-1.5 text-xs text-amber-400/80 mt-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>
                Generating {progress.backfillsPending} replacement mod{progress.backfillsPending > 1 ? 's' : ''}
                {' '}for skipped items
              </span>
            </div>
          )}

          {progress.backfillsRequired > 0 && !hasPendingBackfills && (
            <p className="text-xs text-amber-400/70">
              {progress.backfillsRequired} replacement mod{progress.backfillsRequired > 1 ? 's' : ''} required before advancing
            </p>
          )}

          {pct === 100 && !hasPendingBackfills && progress.backfillsRequired === 0 && (
            <p className={`text-xs font-medium ${config.color} animate-pulse`}>
              Tier complete — {config.nextLabel} unlocked!
            </p>
          )}
        </div>
      )}
    </div>
  );
}
