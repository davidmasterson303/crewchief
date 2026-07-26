'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  CircleAlert as AlertCircle,
  TrendingUp,
  RefreshCw,
  TriangleAlert as AlertTriangle,
  CircleCheck as CheckCircle,
  Activity,
  ShieldAlert,
  ChevronRight,
} from 'lucide-react';
import { generateVehicleHealthSummary } from '@/app/actions';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { invalidateDashboardCache } from '@/lib/query-invalidation';
import RecallHistoryModal from './RecallHistoryModal';
import { useCountUp } from '@/hooks/use-count-up';
import { useHealthBand, getHealthBand } from '@/hooks/use-health-band';

interface HealthSummaryProps {
  vehicleId: string;
  healthSummary: any;
  recalls?: any[];
  compact?: boolean;
}

function ScoreRing({ score }: { score: number }) {
  const radius = 29;
  const circumference = 2 * Math.PI * radius;

  // Ring sweep and the printed number are driven by one value, so they
  // resolve together rather than drifting apart.
  const animated = useCountUp(score, 900);
  const fill = (animated / 100) * circumference;

  // Band is chosen from the *target* score: the colour should not cycle
  // through red → amber → green while the ring draws in.
  const band = useHealthBand(score);

  return (
    <div className="relative flex items-center justify-center w-20 h-20 flex-shrink-0">
      <svg width="80" height="80" viewBox="0 0 80 80" className="-rotate-90">
        <circle
          cx="40" cy="40" r={radius}
          fill="none"
          stroke={`rgba(${band.rgb},0.12)`}
          strokeWidth="6"
        />
        <circle
          cx="40" cy="40" r={radius}
          fill="none"
          stroke={band.color}
          strokeWidth="6"
          strokeDasharray={`${fill} ${circumference}`}
          strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 5px rgba(${band.rgb},0.38))` }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="num text-xl font-bold text-foreground leading-none">
          {Math.round(animated)}
        </span>
        <span className="text-xs text-white/40 mt-0.5">/100</span>
      </div>
    </div>
  );
}

export default function HealthSummary({ vehicleId, healthSummary, recalls = [], compact = false }: HealthSummaryProps) {
  const router = useRouter();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    const result = await generateVehicleHealthSummary(vehicleId, true);
    if (result.success) {
      toast.success('Health summary updated');
      invalidateDashboardCache(vehicleId);
      router.refresh();
    } else {
      toast.error('Failed to update health summary');
    }
    setIsRefreshing(false);
  };

  if (!healthSummary) {
    return (
      <Card className="bg-slate-900/60 border-white/10">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Activity className="h-5 w-5 text-info" />
            Vehicle Health
          </CardTitle>
          <p className="text-sm text-white/50 mt-1">
            {isRefreshing ? 'Analyzing your vehicle...' : 'Get started by uploading service invoices'}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {isRefreshing ? (
            <div className="flex items-center justify-center py-10">
              <RefreshCw className="h-7 w-7 text-info animate-spin" />
            </div>
          ) : (
            <>
              <p className="text-sm text-white/55 leading-relaxed">
                Upload photos of your service invoices to analyze your vehicle&apos;s maintenance history and provide personalized insights.
              </p>
              <Button
                size="sm"
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="w-full bg-cyan-600 hover:bg-cyan-500 text-white glow-cyan-sm"
              >
                <TrendingUp className="h-4 w-4 mr-2" />
                Generate Health Report
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    );
  }

  // Reads the shared band table, so the label, the ring and DiagnosticHero's
  // hero score can never disagree about which band a score falls in.
  const getScoreLabel = (score: number) => {
    const band = getHealthBand(score);
    return { label: band.label, color: `text-health-${band.name}` };
  };

  const getEmptyStatusMessage = (status: string, type: string): string => {
    if (!status || status.trim() === '' || status === 'null') {
      if (type === 'recall') return 'No active recalls';
      if (type === 'maintenance') return 'No items due';
      if (type === 'issues') return 'No known issues';
    }
    return status;
  };

  const scoreInfo = getScoreLabel(healthSummary.health_score);

  if (compact) {
    return (
      <Card className={`border ${
        healthSummary.health_score >= 80 ? 'bg-green-500/8 border-green-400/20'
        : healthSummary.health_score >= 60 ? 'bg-info-wash border-info-border'
        : 'bg-orange-500/8 border-orange-400/20'
      }`}>
        <CardContent className="pt-5 pb-4">
          <div className="flex items-center gap-4 mb-3">
            <ScoreRing score={healthSummary.health_score} />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-white/50 uppercase tracking-widest mb-1">Health Score</p>
              <p className={`text-base font-bold ${scoreInfo.color}`}>{scoreInfo.label}</p>
              <p className="text-xs text-white/55 line-clamp-2 mt-1 leading-relaxed">{healthSummary.summary}</p>
            </div>
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="p-1.5 rounded-lg text-white/30 hover:text-cyan-400 hover:bg-cyan-400/8 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
              aria-label="Refresh health summary"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
          {healthSummary.red_flags && healthSummary.red_flags.length > 0 && (
            <div className="pt-3 border-t border-white/8 space-y-1.5">
              {healthSummary.red_flags.slice(0, 2).map((flag: string) => (
                <div key={flag} className="flex items-start gap-2">
                  <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-white/65 leading-snug">{flag}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  const maintenanceEmpty = !healthSummary.maintenance_status || healthSummary.maintenance_status.trim() === '';
  const issuesEmpty = !healthSummary.issues_overview || healthSummary.issues_overview.trim() === '';
  const recallEmpty = !healthSummary.recall_status || healthSummary.recall_status.trim() === '';

  return (
    <Card className="bg-slate-900/60 border-white/10">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-5">
            <ScoreRing score={healthSummary.health_score} />
            <div>
              <CardTitle className="text-white flex items-center gap-2 mb-1">
                <Activity className="h-5 w-5 text-info" />
                Vehicle Health
              </CardTitle>
              <p className={`text-base font-semibold ${scoreInfo.color}`}>{scoreInfo.label}</p>
              {healthSummary.summary && (
                <p className="text-sm text-white/55 mt-1.5 max-w-xl leading-relaxed">{healthSummary.summary}</p>
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="text-white/40 hover:text-cyan-400 hover:bg-cyan-400/8 transition-colors"
            aria-label="Refresh health summary"
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="grid md:grid-cols-3 gap-3">
          <div className={`p-4 rounded-xl border ${maintenanceEmpty ? 'bg-green-500/8 border-green-400/20' : 'bg-orange-500/8 border-orange-400/20'}`}>
            <div className="flex items-center gap-2.5 mb-2">
              {maintenanceEmpty
                ? <CheckCircle className="h-6 w-6 text-green-400" />
                : <AlertCircle className="h-6 w-6 text-orange-400" />}
              <h4 className="text-sm font-semibold text-white">Maintenance</h4>
            </div>
            <p className="text-sm text-white/65 leading-relaxed">
              {getEmptyStatusMessage(healthSummary.maintenance_status, 'maintenance')}
            </p>
          </div>

          <div className={`p-4 rounded-xl border ${issuesEmpty ? 'bg-green-500/8 border-green-400/20' : 'bg-info-wash border-info-border'}`}>
            <div className="flex items-center gap-2.5 mb-2">
              {issuesEmpty
                ? <CheckCircle className="h-6 w-6 text-green-400" />
                : <AlertCircle className="h-6 w-6 text-cyan-400" />}
              <h4 className="text-sm font-semibold text-white">Known Issues</h4>
            </div>
            <p className="text-sm text-white/65 leading-relaxed">
              {getEmptyStatusMessage(healthSummary.issues_overview, 'issues')}
            </p>
          </div>

          <RecallHistoryModal
            recalls={recalls}
            trigger={
              <div className={`p-4 rounded-xl border cursor-pointer transition-all group ${
                recallEmpty
                  ? 'bg-green-500/8 border-green-400/20 hover:bg-green-500/14 hover:border-green-400/35'
                  : 'bg-orange-500/8 border-orange-400/20 hover:bg-orange-500/14 hover:border-orange-400/35'
              }`}>
                <div className="flex items-center gap-2.5 mb-2">
                  {recallEmpty
                    ? <CheckCircle className="h-6 w-6 text-green-400" />
                    : <ShieldAlert className="h-6 w-6 text-orange-400" />}
                  <h4 className="text-sm font-semibold text-white">Recall Status</h4>
                </div>
                <p className="text-sm text-white/65 leading-relaxed mb-3">
                  {getEmptyStatusMessage(healthSummary.recall_status, 'recall')}
                </p>
                {/* Informational link, not a CTA — info rather than brand cyan. */}
                <div className="flex items-center gap-1 text-xs font-medium text-info/70 group-hover:text-info-strong transition-colors">
                  <span>View recall history</span>
                  <ChevronRight
                    className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform"
                    aria-hidden="true"
                  />
                </div>
              </div>
            }
          />
        </div>

        {healthSummary.red_flags && healthSummary.red_flags.length > 0 && (
          <div className="bg-red-500/8 border border-red-400/20 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="h-5 w-5 text-red-400" />
              <h4 className="font-semibold text-white text-sm">Red Flags</h4>
            </div>
            <div className="space-y-2">
              {healthSummary.red_flags.map((flag: string) => (
                <div key={flag} className="flex items-start gap-2.5 p-2.5 bg-red-500/6 rounded-lg border border-red-400/10">
                  <div className="w-1.5 h-1.5 rounded-full bg-red-400 mt-1.5 shrink-0" />
                  <p className="text-sm text-white/75 leading-snug">{flag}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {healthSummary.recommendations && healthSummary.recommendations.length > 0 && (
          <div className="bg-info-wash border border-info-border rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="h-5 w-5 text-cyan-400" />
              <h4 className="font-semibold text-white text-sm">Recommendations</h4>
            </div>
            <ul className="space-y-2">
              {healthSummary.recommendations.map((rec: string) => (
                <li key={rec} className="text-sm text-white/75 flex items-start gap-2.5">
                  <ChevronRight
                    className="h-4 w-4 mt-0.5 shrink-0 text-info"
                    aria-hidden="true"
                  />
                  <span className="leading-relaxed">{rec}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="text-xs text-white/30 text-right">
          Last updated:{' '}
          {healthSummary.last_generated
            ? new Date(healthSummary.last_generated).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            : 'Never'}
        </p>
      </CardContent>
    </Card>
  );
}
