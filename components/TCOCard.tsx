'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { prefersReducedMotion } from '@/hooks/use-reduced-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DollarSign, TrendingDown, Fuel, Wrench, ShieldCheck, ChevronRight, ToggleLeft, ToggleRight, Info, SlidersHorizontal } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { calculateTCO } from '@crewchief/core/tco-calculator';

interface TCOCardProps {
  vehicle: any;
  vehicleId: string;
  onEditInputs?: () => void;
}

interface TCOData {
  purchasePrice: number;
  totalServiceSpend: number;
  totalFuelCost: number;
  totalInsurance: number;
  estimatedResaleValue: number;
  monthsOwned: number;
  currentMileage: number;
  monthlyMiles: number;
}

interface DonutSegment {
  label: string;
  value: number;
  color: string;
  icon: React.ElementType;
}

function DonutChart({ segments, total }: { segments: DonutSegment[]; total: number }) {
  const size = 180;
  const strokeWidth = 22;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const cx = size / 2;
  const cy = size / 2;
  const [progress, setProgress] = useState(0);
  const animRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);
  const DURATION = 1200;

  useEffect(() => {
    /*
      The blanket CSS rule in globals.css cannot see a requestAnimationFrame
      loop, so this ring drew itself over 1200ms for everyone — including
      visitors who asked for reduced motion. Found by the item-17 audit rather
      than by anyone reporting it, which is the point of auditing as a list.

      Landing on the final value rather than skipping the effect: the end state
      is never optional, only the travel to it.
    */
    if (prefersReducedMotion()) {
      setProgress(1);
      return;
    }

    setProgress(0);
    startRef.current = null;
    const animate = (now: number) => {
      if (!startRef.current) startRef.current = now;
      const elapsed = now - startRef.current;
      const t = Math.min(elapsed / DURATION, 1);
      const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      setProgress(eased);
      if (t < 1) animRef.current = requestAnimationFrame(animate);
    };
    animRef.current = requestAnimationFrame(animate);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [segments.map(s => s.value).join(',')]);

  const validSegments = segments.filter(s => s.value > 0);
  let cumulativePercent = 0;

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={strokeWidth}
        />
        {validSegments.map((seg, i) => {
          const percent = (seg.value / total) * progress;
          const dashArray = percent * circumference;
          const dashOffset = circumference - cumulativePercent * circumference;
          cumulativePercent += seg.value / total * progress;
          return (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={radius}
              fill="none"
              stroke={seg.color}
              strokeWidth={strokeWidth}
              strokeDasharray={`${dashArray} ${circumference - dashArray}`}
              strokeDashoffset={dashOffset}
              strokeLinecap="butt"
            />
          );
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xs text-white/50 font-medium uppercase tracking-wider">Total Cost</span>
        <span className="text-2xl font-bold text-white mt-0.5">${formatK(total)}</span>
      </div>
    </div>
  );
}

function formatK(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return value.toFixed(0);
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
}

function KPICard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="flex flex-col gap-0.5 p-4 bg-white/4 rounded-xl border border-white/8">
      <span className="text-xs font-semibold uppercase tracking-widest text-white/50">{label}</span>
      <span className={`text-2xl font-bold tabular-nums ${accent || 'text-white'}`}>{value}</span>
      {sub && <span className="text-xs text-white/50">{sub}</span>}
    </div>
  );
}

export default function TCOCard({ vehicle, vehicleId, onEditInputs }: TCOCardProps) {
  const [totalServiceSpend, setTotalServiceSpend] = useState(0);
  const [loading, setLoading] = useState(true);
  const [whatIfMode, setWhatIfMode] = useState<'now' | 'keep2'>('now');

  const loadServiceSpend = useCallback(async () => {
    if (!supabase) return;
    try {
      const { data } = await supabase
        .from('maintenance_line_items')
        .select('total_cost')
        .eq('vehicle_id', vehicleId);

      const spend = (data || []).reduce((sum: number, item: any) => sum + (item.total_cost || 0), 0);
      setTotalServiceSpend(spend);
    } catch {
    } finally {
      setLoading(false);
    }
  }, [vehicleId]);

  useEffect(() => {
    loadServiceSpend();
  }, [loadServiceSpend]);

  const purchasePrice = vehicle.purchase_price || 0;
  const extraYears = whatIfMode === 'keep2' ? 2 : 0;

  // The math lives in @crewchief/core so the numbers on this card are the
  // numbers the tests assert — they were two separate implementations with
  // two different depreciation models until this was extracted.
  const {
    totalFuelCost: activeFuelCost,
    totalInsurance: activeInsurance,
    totalServiceSpend: activeServiceSpend,
    depreciation,
    resaleValue,
    netTCO,
    costPerMile,
    costPerMonth,
    monthsOwned: activeMonths,
    activeMileage,
  } = calculateTCO(vehicle, totalServiceSpend, extraYears);

  // Read straight off the vehicle for the "we can't price fuel" notice below.
  const avgMpg = vehicle.avg_mpg || 0;
  const fuelPrice = vehicle.fuel_price_per_gallon || 0;

  const hasEnoughData = purchasePrice > 0;

  const segments: DonutSegment[] = [
    { label: 'Depreciation', value: depreciation, color: '#ef4444', icon: TrendingDown },
    { label: 'Maintenance', value: activeServiceSpend, color: '#f59e0b', icon: Wrench },
    { label: 'Fuel', value: activeFuelCost, color: '#3b82f6', icon: Fuel },
    { label: 'Insurance', value: activeInsurance, color: '#10b981', icon: ShieldCheck },
  ].filter(s => s.value > 0);

  const donutTotal = segments.reduce((s, seg) => s + seg.value, 0);

  if (loading) {
    return (
      <Card className="bg-slate-900/60 border-white/10">
        <CardContent className="pt-6 pb-6">
          <div className="flex items-center gap-3 animate-pulse">
            <div className="w-8 h-8 bg-white/10 rounded-lg" />
            <div className="h-5 bg-white/10 rounded w-48" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-slate-900/60 border-white/10">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-white text-base">
            <DollarSign className="h-5 w-5 text-info" />
            Total Cost of Ownership
          </CardTitle>
          <div className="flex items-center gap-2">
            {onEditInputs && (
              <button
                onClick={onEditInputs}
                className="tap-target-44 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-white/20 bg-white/10 hover:bg-white/16 hover:border-white/30 text-white/70 hover:text-white transition-all duration-200"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                Edit Inputs
              </button>
            )}
            {hasEnoughData && (
              <button
                onClick={() => setWhatIfMode(m => m === 'now' ? 'keep2' : 'now')}
                className="tap-target-44 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all duration-200 select-none"
                style={{
                  background: whatIfMode === 'keep2' ? 'rgba(251,191,36,0.15)' : 'rgba(255,255,255,0.10)',
                  borderColor: whatIfMode === 'keep2' ? 'rgba(251,191,36,0.45)' : 'rgba(255,255,255,0.20)',
                  color: whatIfMode === 'keep2' ? '#fbbf24' : 'rgba(255,255,255,0.70)',
                }}
              >
                {whatIfMode === 'keep2' ? <ToggleRight className="h-3.5 w-3.5" /> : <ToggleLeft className="h-3.5 w-3.5" />}
                {whatIfMode === 'keep2' ? 'Keep 2 More Years' : 'Sell Now'}
              </button>
            )}
          </div>
        </div>
        {whatIfMode === 'keep2' && (
          <div className="mt-2 flex items-center gap-2 px-3 py-2 bg-amber-400/8 border border-amber-400/20 rounded-lg">
            <Info className="h-3.5 w-3.5 text-amber-400 flex-shrink-0" />
            <p className="text-xs text-amber-300/80">Projecting costs if you keep this vehicle for 2 more years</p>
          </div>
        )}
      </CardHeader>

      <CardContent>
        {!hasEnoughData ? (
          <div className="flex flex-col items-center justify-center py-10 text-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-white/4 border border-white/8 flex items-center justify-center">
              <DollarSign className="h-6 w-6 text-white/20" />
            </div>
            <div>
              <p className="text-sm font-medium text-white/60 mb-1">Add purchase price to unlock TCO</p>
              <p className="text-xs text-white/50 max-w-xs">
                Enter your vehicle&apos;s purchase price, MPG, and fuel cost to see your real cost-per-mile.
              </p>
            </div>
            {onEditInputs ? (
              <Button
                onClick={onEditInputs}
                size="sm"
                className="bg-primary hover:bg-primary/90 text-primary-foreground text-xs"
              >
                <SlidersHorizontal className="h-3.5 w-3.5 mr-1.5" />
                Enter Cost Inputs
              </Button>
            ) : (
              <a href={`/vehicle-info/${vehicleId}`}>
                <Button variant="outline" size="sm" className="border-white/15 text-white/60 hover:text-white hover:bg-white/8 text-xs">
                  Go to Vehicle Info <ChevronRight className="h-3.5 w-3.5 ml-1" />
                </Button>
              </a>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <KPICard
                label="Cost / Mile"
                value={costPerMile > 0 ? `$${costPerMile.toFixed(2)}` : '—'}
                sub="real-world"
                accent="text-info"
              />
              <KPICard
                label="Monthly Cost"
                value={costPerMonth > 0 ? formatCurrency(costPerMonth) : '—'}
                sub="avg over ownership"
              />
              <KPICard
                label="Est. Resale"
                value={resaleValue > 0 ? formatCurrency(resaleValue) : '—'}
                sub="depreciation est."
                accent="text-emerald-400"
              />
              <KPICard
                label="Net TCO"
                value={netTCO > 0 ? formatCurrency(netTCO) : '—'}
                sub={whatIfMode === 'keep2' ? 'projected' : 'to date'}
                accent="text-rose-400"
              />
            </div>

            {donutTotal > 0 && (
              <div className="flex flex-col sm:flex-row items-center gap-6">
                <DonutChart segments={segments} total={donutTotal} />
                <div className="flex-1 space-y-2 w-full">
                  {segments.map((seg) => {
                    const pct = ((seg.value / donutTotal) * 100).toFixed(1);
                    const Icon = seg.icon;
                    return (
                      <div key={seg.label} className="flex items-center gap-3">
                        <div className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0" style={{ background: `${seg.color}20` }}>
                          <Icon className="h-3.5 w-3.5" style={{ color: seg.color }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs text-white/60">{seg.label}</span>
                            <span className="text-xs font-semibold text-white tabular-nums">{formatCurrency(seg.value)}</span>
                          </div>
                          <div className="h-1.5 bg-white/8 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{ width: `${pct}%`, background: seg.color }}
                            />
                          </div>
                        </div>
                        <span className="text-xs text-white/50 w-10 text-right tabular-nums">{pct}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {(avgMpg === 0 || fuelPrice === 0) && (
              <div className="flex items-center gap-2 px-3 py-2 bg-white/4 border border-white/8 rounded-lg">
                <Info className="h-3.5 w-3.5 text-white/30 flex-shrink-0" />
                <p className="text-xs text-white/50">
                  Add avg MPG and fuel price{' '}
                  {onEditInputs ? (
                    <button onClick={onEditInputs} className="text-cyan-400 hover:underline">in Cost Inputs</button>
                  ) : (
                    <a href={`/vehicle-info/${vehicleId}`} className="text-cyan-400 hover:underline">in Vehicle Info</a>
                  )}{' '}
                  for full fuel cost analysis.
                </p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
