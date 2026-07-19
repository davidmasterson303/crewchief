'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Activity, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface HealthHistoryChartProps {
  vehicleId: string;
  currentScore?: number;
}

interface HistoryEntry {
  health_score: number;
  recorded_at: string;
}

function MiniSparkline({ data }: { data: HistoryEntry[] }) {
  if (data.length < 2) return null;

  const scores = data.map(d => d.health_score);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const range = max - min || 1;
  const width = 200;
  const height = 48;
  const padding = 4;

  const computedPoints = data.map((d, i) => ({
    x: padding + (i / (data.length - 1)) * (width - padding * 2),
    y: height - padding - ((d.health_score - min) / range) * (height - padding * 2),
  }));

  const polylinePoints = computedPoints.map(p => `${p.x},${p.y}`).join(' ');

  const lastScore = scores[scores.length - 1];
  const color = lastScore >= 80 ? '#4ade80' : lastScore >= 60 ? '#22d3ee' : lastScore >= 40 ? '#fb923c' : '#f87171';

  return (
    <svg width={width} height={height} className="overflow-visible">
      <defs>
        <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <polygon
        points={[
          `${padding},${height}`,
          ...computedPoints.map(p => `${p.x},${p.y}`),
          `${width - padding},${height}`,
        ].join(' ')}
        fill="url(#sparkGrad)"
      />
      <polyline
        points={polylinePoints}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ filter: `drop-shadow(0 0 4px ${color}60)` }}
      />
      {computedPoints.map((p, i) => (
        <circle
          key={i}
          cx={p.x} cy={p.y} r="3"
          fill={color}
          opacity={i === computedPoints.length - 1 ? 1 : 0.5}
        />
      ))}
    </svg>
  );
}

export default function HealthHistoryChart({ vehicleId, currentScore }: HealthHistoryChartProps) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) return;

    (async () => {
      try {
        const result = await supabase
          .from('vehicle_health_history')
          .select('health_score, recorded_at')
          .eq('vehicle_id', vehicleId)
          .order('recorded_at', { ascending: true })
          .limit(12);
        if (result.data && result.data.length > 0) {
          setHistory(result.data as HistoryEntry[]);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [vehicleId]);

  if (loading || history.length < 2) return null;

  const scores = history.map(h => h.health_score);
  const firstScore = scores[0];
  const lastScore = scores[scores.length - 1];
  const delta = lastScore - firstScore;

  const TrendIcon = delta > 3 ? TrendingUp : delta < -3 ? TrendingDown : Minus;
  const trendColor = delta > 3 ? 'text-green-400' : delta < -3 ? 'text-red-400' : 'text-white/40';

  return (
    <Card className="bg-slate-900/60 border-white/10">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-white text-base">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-cyan-400" />
            Health Trend
          </div>
          <div className={`flex items-center gap-1.5 text-sm font-medium ${trendColor}`}>
            <TrendIcon className="h-4 w-4" />
            {delta > 0 ? '+' : ''}{delta} pts
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-end gap-6">
          <div className="flex-1">
            <MiniSparkline data={history} />
          </div>
          <div className="flex gap-4 flex-shrink-0">
            <div className="text-center">
              <p className="text-xs text-white/35 mb-1 uppercase tracking-widest font-semibold">Start</p>
              <p className="text-lg font-bold text-white/60 tabular-nums">{firstScore}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-white/35 mb-1 uppercase tracking-widest font-semibold">Current</p>
              <p className={`text-lg font-bold tabular-nums ${
                lastScore >= 80 ? 'text-green-400' : lastScore >= 60 ? 'text-cyan-400' : lastScore >= 40 ? 'text-orange-400' : 'text-red-400'
              }`}>{lastScore}</p>
            </div>
          </div>
        </div>
        <p className="text-xs text-white/25 mt-3">
          Based on {history.length} data points over time
        </p>
      </CardContent>
    </Card>
  );
}
