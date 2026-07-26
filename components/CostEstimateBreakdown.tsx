'use client';

import { DollarSign, Clock, Info } from 'lucide-react';

interface CostEstimateItem {
  description: string;
  parts_cost_low: number;
  parts_cost_high: number;
  labor_hours_low: number;
  labor_hours_high: number;
  labor_cost_low: number;
  labor_cost_high: number;
  notes: string;
}

interface CostEstimate {
  items: CostEstimateItem[];
  regional_labor_rate: string;
  total_low: number;
  total_high: number;
}

interface CostEstimateBreakdownProps {
  estimate: CostEstimate;
}

function fmt(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);
}

function CostRangeBar({ low, high, max }: { low: number; high: number; max: number }) {
  const leftPct = max > 0 ? (low / max) * 100 : 0;
  const widthPct = max > 0 ? ((high - low) / max) * 100 : 50;
  const midPct = leftPct + widthPct / 2;

  return (
    <div className="relative mt-3 mb-1">
      <div className="h-2 bg-white/6 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-cyan-400"
          style={{ marginLeft: `${leftPct}%`, width: `${Math.max(widthPct, 4)}%` }}
        />
      </div>
      <div className="flex justify-between mt-1.5 text-xs text-white/35 tabular-nums">
        <span>$0</span>
        <span className="text-cyan-300 font-medium">{fmt(low)} – {fmt(high)}</span>
        <span>{fmt(max)}</span>
      </div>
      <div
        className="absolute -top-1 w-px h-4 bg-white/20"
        style={{ left: `${midPct}%` }}
      />
    </div>
  );
}

export function CostEstimateBreakdown({ estimate }: CostEstimateBreakdownProps) {
  const maxPossible = estimate.total_high * 1.2;

  return (
    <div className="space-y-3">
      {estimate.items.map((item, idx) => {
        const itemLow = item.parts_cost_low + item.labor_cost_low;
        const itemHigh = item.parts_cost_high + item.labor_cost_high;
        return (
          <div key={idx} className="bg-white/4 border border-white/8 rounded-xl p-4 space-y-3">
            <div>
              <h4 className="font-semibold text-white text-sm">{item.description}</h4>
              {item.notes && (
                <p className="text-xs text-white/45 mt-0.5 leading-relaxed">{item.notes}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div className="bg-white/3 border border-white/6 rounded-lg p-2.5">
                <div className="flex items-center gap-1 text-white/40 mb-1">
                  <DollarSign className="h-3 w-3" />
                  <span className="text-xs font-medium">Parts</span>
                </div>
                <p className="text-sm font-semibold text-cyan-300 tabular-nums">
                  {fmt(item.parts_cost_low)} – {fmt(item.parts_cost_high)}
                </p>
              </div>
              <div className="bg-white/3 border border-white/6 rounded-lg p-2.5">
                <div className="flex items-center gap-1 text-white/40 mb-1">
                  <Clock className="h-3 w-3" />
                  <span className="text-xs font-medium">Labor</span>
                </div>
                <p className="text-sm font-semibold text-cyan-300 tabular-nums">
                  {fmt(item.labor_cost_low)} – {fmt(item.labor_cost_high)}
                </p>
                <p className="text-xs text-white/30 mt-0.5">
                  {item.labor_hours_low.toFixed(1)}–{item.labor_hours_high.toFixed(1)} hrs
                </p>
              </div>
            </div>

            <div className="pt-2 border-t border-white/6">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-white/40 font-medium">Item Estimate</span>
                <span className="text-sm font-bold text-cyan-400 tabular-nums">{fmt(itemLow)} – {fmt(itemHigh)}</span>
              </div>
              <CostRangeBar low={itemLow} high={itemHigh} max={itemHigh * 1.4} />
            </div>
          </div>
        );
      })}

      <div className="bg-cyan-400/8 border border-cyan-400/20 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-xs text-info/70 font-semibold uppercase tracking-wider mb-0.5">Total Estimate Range</p>
            <p className="num text-2xl font-bold text-foreground">
              {fmt(estimate.total_low)} – {fmt(estimate.total_high)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-white/35">Market avg</p>
            <p className="text-sm font-semibold text-cyan-300 tabular-nums">
              {fmt(Math.round((estimate.total_low + estimate.total_high) / 2))}
            </p>
          </div>
        </div>

        <div className="relative">
          <div className="h-3 bg-white/6 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full relative overflow-hidden"
              style={{
                marginLeft: `${(estimate.total_low / maxPossible) * 100}%`,
                width: `${Math.max(((estimate.total_high - estimate.total_low) / maxPossible) * 100, 4)}%`,
                background: 'linear-gradient(90deg, #06b6d4, #22d3ee)',
              }}
            />
          </div>
          <div className="flex justify-between mt-2 text-xs text-white/30 tabular-nums">
            <span>$0</span>
            <span className="text-cyan-300/80 font-medium">
              {fmt(estimate.total_low)} — {fmt(estimate.total_high)}
            </span>
            <span>{fmt(maxPossible)}</span>
          </div>
          <div
            className="absolute -top-0.5 w-px h-5 bg-white/25"
            style={{ left: `${((estimate.total_low + estimate.total_high) / 2 / maxPossible) * 100}%` }}
          >
            <span className="absolute -top-5 -translate-x-1/2 text-xs text-white/40 whitespace-nowrap">avg</span>
          </div>
        </div>

        {estimate.regional_labor_rate && (
          <p className="text-xs text-white/40 mt-4 flex items-start gap-1.5 leading-relaxed">
            <Info className="h-3.5 w-3.5 text-cyan-400/60 flex-shrink-0 mt-0.5" />
            {estimate.regional_labor_rate}
          </p>
        )}
      </div>

      <div className="flex items-start gap-2 text-xs text-white/30 bg-white/3 border border-white/6 rounded-xl p-3.5 leading-relaxed">
        <Info className="h-3.5 w-3.5 flex-shrink-0 mt-0.5 text-white/25" />
        <p>AI-generated estimates for comparison only. Actual costs vary based on shop rates, parts availability, and diagnostics.</p>
      </div>
    </div>
  );
}
