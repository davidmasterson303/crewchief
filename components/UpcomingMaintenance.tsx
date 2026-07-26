'use client';

import { useMemo, useState, useEffect } from 'react';
import { Droplets, Wind, RotateCcw, Zap, Thermometer, Settings, ShieldCheck, Clock, TriangleAlert as AlertTriangle, CircleCheck as CheckCircle, Layers, ChevronRight, ChevronDown, Link as LinkIcon } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { syncCategoryFromHistory } from '@/lib/maintenance-sync';
import { LogServiceModal } from '@/components/LogServiceModal';

interface UpcomingMaintenanceProps {
  vehicle: {
    id?: string;
    current_mileage?: number;
    avg_miles_per_month?: number;
    year?: number;
    make?: string;
    model?: string;
  };
  knowledge?: {
    maintenance_schedule?: any[];
  };
  maintenanceLineItems?: any[];
  completedServiceItems?: any[];
}

const COMMON_INTERVALS: Array<{
  name: string;
  miles: number;
  months: number;
  priority: 'critical' | 'high' | 'medium' | 'low';
  icon: React.ComponentType<{ className?: string }>;
  keywords: string[];
}> = [
  { name: 'Oil Change', miles: 5000, months: 6, priority: 'critical', icon: Droplets, keywords: ['oil', 'lube'] },
  { name: 'Tire Rotation', miles: 7500, months: 6, priority: 'medium', icon: RotateCcw, keywords: ['tire', 'rotation', 'tyre'] },
  { name: 'Air Filter', miles: 15000, months: 12, priority: 'high', icon: Wind, keywords: ['air filter', 'engine filter'] },
  { name: 'Cabin Air Filter', miles: 15000, months: 12, priority: 'low', icon: Wind, keywords: ['cabin filter', 'cabin air'] },
  { name: 'Brake Inspection', miles: 20000, months: 12, priority: 'high', icon: ShieldCheck, keywords: ['brake', 'pad', 'rotor'] },
  { name: 'Spark Plugs', miles: 30000, months: 24, priority: 'medium', icon: Zap, keywords: ['spark', 'plug', 'ignition'] },
  { name: 'Transmission Fluid', miles: 30000, months: 24, priority: 'critical', icon: Settings, keywords: ['transmission', 'trans fluid', 'atf'] },
  { name: 'Coolant Flush', miles: 50000, months: 36, priority: 'medium', icon: Thermometer, keywords: ['coolant', 'antifreeze', 'flush'] },
  { name: 'Brake Fluid', miles: 45000, months: 24, priority: 'high', icon: Droplets, keywords: ['brake fluid', 'dot fluid'] },
  { name: 'Timing Belt', miles: 60000, months: 60, priority: 'critical', icon: Clock, keywords: ['timing belt', 'timing chain'] },
];

const BASELINE_THRESHOLD = 10000;

const URGENCY_CONFIG = {
  overdue: {
    border: 'border-l-red-500',
    glow: 'shadow-red-500/10',
    badge: 'bg-red-500/15 text-red-400 border-red-500/30',
    label: 'Overdue',
    dot: 'bg-red-500',
  },
  soon: {
    border: 'border-l-amber-400',
    glow: 'shadow-amber-500/10',
    badge: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    label: 'Due Soon',
    dot: 'bg-amber-400',
  },
  upcoming: {
    border: 'border-l-cyan-400',
    glow: 'shadow-cyan-500/10',
    badge: 'bg-info-wash text-info border-info-border',
    label: 'On Track',
    dot: 'bg-cyan-400',
  },
};

function getUrgency(milesUntilDue: number, isOverdue: boolean): keyof typeof URGENCY_CONFIG {
  if (isOverdue) return 'overdue';
  if (milesUntilDue <= 2000) return 'soon';
  return 'upcoming';
}

function getBundleSuggestions(
  predictions: Array<{ name: string; milesUntilDue: number; isOverdue: boolean }>
): Map<string, string[]> {
  const BUNDLE_PAIRS: Array<[string, string, string]> = [
    ['Oil Change', 'Air Filter', 'High Synergy'],
    ['Oil Change', 'Cabin Air Filter', 'High Synergy'],
    ['Brake Inspection', 'Brake Fluid', 'High Synergy'],
    ['Coolant Flush', 'Transmission Fluid', 'Bundle Opportunity'],
    ['Air Filter', 'Cabin Air Filter', 'Bundle Opportunity'],
    ['Spark Plugs', 'Air Filter', 'Bundle Opportunity'],
  ];
  const bundleMap = new Map<string, string[]>();
  const names = new Set(predictions.map(p => p.name));
  for (const [a, b, label] of BUNDLE_PAIRS) {
    if (names.has(a) && names.has(b)) {
      const aMiles = predictions.find(p => p.name === a)?.milesUntilDue ?? 0;
      const bMiles = predictions.find(p => p.name === b)?.milesUntilDue ?? 0;
      const diff = Math.abs(aMiles - bMiles);
      if (diff < 4000) {
        bundleMap.set(a, [...(bundleMap.get(a) || []), `${label}: bundle with ${b}`]);
        bundleMap.set(b, [...(bundleMap.get(b) || []), `${label}: bundle with ${a}`]);
      }
    }
  }
  return bundleMap;
}

function ForecastCard({
  item,
  vehicle,
  bundleHints,
  onLogService,
}: {
  item: {
    name: string;
    milesUntilDue: number;
    monthsUntilDue: number;
    isOverdue: boolean;
    overdueMiles: number;
    priority: string;
    isBaseline: boolean;
    isSynced: boolean;
    Icon: React.ComponentType<{ className?: string }>;
  };
  vehicle: { make?: string; model?: string };
  bundleHints: string[];
  onLogService: () => void;
}) {
  const urgency = getUrgency(item.milesUntilDue, item.isOverdue);
  const cfg = URGENCY_CONFIG[urgency];
  const Icon = item.Icon;

  const engineLabel = vehicle.make && vehicle.model
    ? `${vehicle.make} ${vehicle.model}`
    : 'your vehicle';

  return (
    <div
      className={`
        flex-shrink-0 w-[260px] bg-white/[0.04] border border-white/10 border-l-4 ${cfg.border}
        rounded-2xl p-5 flex flex-col gap-3.5 shadow-lg ${cfg.glow}
        transition-all duration-200 hover:bg-white/[0.06] hover:border-white/15
      `}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-white/8 border border-white/10 flex items-center justify-center flex-shrink-0">
            <Icon className="h-4.5 w-4.5 text-white/70" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-semibold text-white leading-tight">{item.name}</p>
              {item.isSynced && (
                <span className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1 py-0.5 rounded bg-info-wash text-info border border-info-border leading-none">
                  <LinkIcon className="h-2 w-2" />
                  Synced
                </span>
              )}
            </div>
            <span className={`inline-flex items-center gap-1 mt-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${cfg.badge}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
              {cfg.label}
            </span>
          </div>
        </div>
      </div>

      <div className="flex-1">
        {item.isBaseline ? (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5 text-amber-400 flex-shrink-0" />
              <span className="text-[11px] font-semibold text-amber-400 uppercase tracking-wide">Establish Baseline</span>
            </div>
            <p className="text-xs text-white/45 leading-relaxed">
              No recent records found. Prioritize verifying fluid health or replacing preemptively to protect {engineLabel}.
            </p>
          </div>
        ) : item.isOverdue ? (
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-red-400 flex-shrink-0" />
              <p className="text-xs font-semibold text-red-400">
                ~{item.overdueMiles.toLocaleString()} mi past due
              </p>
            </div>
            <p className="text-xs text-white/40">Address as soon as possible.</p>
          </div>
        ) : (
          <div className="space-y-1">
            <p className="text-lg font-bold text-white tabular-nums leading-none">
              {item.milesUntilDue > 0 ? `~${item.milesUntilDue.toLocaleString()}` : '—'}
              <span className="text-xs font-normal text-white/40 ml-1">mi</span>
            </p>
            {item.monthsUntilDue > 0 && (
              <p className="text-xs text-white/40">
                est. {item.monthsUntilDue} {item.monthsUntilDue === 1 ? 'month' : 'months'} away
              </p>
            )}
          </div>
        )}
      </div>

      {bundleHints.length > 0 && (
        <div className="flex items-start gap-1.5 bg-info-wash border border-info-border rounded-xl px-2.5 py-2">
          <CheckCircle className="h-3 w-3 text-info flex-shrink-0 mt-0.5" />
          <p className="text-[10px] text-info/80 leading-snug">{bundleHints[0]}</p>
        </div>
      )}

      <button
        onClick={onLogService}
        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-white/12 text-xs font-medium text-white/55 hover:text-white hover:bg-white/8 hover:border-white/20 transition-all duration-150"
      >
        <CheckCircle className="h-3.5 w-3.5" />
        Log Service
        <ChevronRight className="h-3 w-3 ml-auto opacity-50" />
      </button>
    </div>
  );
}

const COLLAPSED_KEY = 'maintenance_forecast_collapsed';

export default function UpcomingMaintenance({ vehicle, knowledge, maintenanceLineItems = [], completedServiceItems = [] }: UpcomingMaintenanceProps) {
  const currentMileage = vehicle.current_mileage || 0;
  const avgMilesPerMonth = vehicle.avg_miles_per_month || 1000;

  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(COLLAPSED_KEY) === 'true';
  });
  const [dismissals, setDismissals] = useState<any[]>([]);
  const [logServiceTarget, setLogServiceTarget] = useState<string | null>(null);

  useEffect(() => {
    if (!vehicle.id || !supabase) return;
    supabase
      .from('maintenance_dismissals')
      .select('*')
      .eq('vehicle_id', vehicle.id)
      .then(({ data }: { data: any[] | null }) => {
        if (data) setDismissals(data);
      });
  }, [vehicle.id]);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem(COLLAPSED_KEY, String(next)); } catch (_) {}
  };

  const allHistoryItems = useMemo(() => {
    const fromLineItems = maintenanceLineItems.map(item => ({
      item_description: item.item_description || item.description || item.service_type || '',
      service_date: item.service_date,
      service_mileage: item.service_mileage || item.mileage_at_service || 0,
      total_cost: item.total_cost,
    }));
    const fromCompleted = (completedServiceItems || []).map(item => ({
      item_description: item.description || '',
      service_date: item.date_completed,
      service_mileage: 0,
      total_cost: (item.cost_parts || 0) + (item.cost_labor || 0),
    }));
    return [...fromLineItems, ...fromCompleted];
  }, [maintenanceLineItems, completedServiceItems]);

  const predictions = useMemo(() => {
    return COMMON_INTERVALS
      .map(interval => {
        const syncResult = syncCategoryFromHistory(
          interval.name,
          allHistoryItems,
          dismissals,
          currentMileage
        );

        const lastServiceMileage = syncResult.synced ? syncResult.lastServiceMileage : 0;
        const milesSinceService = currentMileage - lastServiceMileage;
        const overdueMiles = milesSinceService - interval.miles;
        const milesUntilDue = interval.miles - milesSinceService;

        if (!syncResult.synced && milesUntilDue > interval.miles * 0.4) return null;

        const isOverdue = milesUntilDue <= 0;
        const absOverdue = isOverdue ? Math.abs(milesUntilDue) : 0;
        const isBaseline = isOverdue && absOverdue > BASELINE_THRESHOLD && !syncResult.synced;

        const monthsUntilDue = milesUntilDue > 0
          ? Math.ceil(milesUntilDue / avgMilesPerMonth)
          : 0;

        return {
          name: interval.name,
          milesUntilDue: isBaseline ? 0 : milesUntilDue,
          monthsUntilDue,
          isOverdue,
          overdueMiles: isBaseline ? 0 : absOverdue,
          priority: interval.priority,
          isSynced: syncResult.synced,
          isBaseline,
          Icon: interval.icon,
        };
      })
      .filter(Boolean)
      .filter(p => {
        if (p!.isOverdue) return true;
        if (p!.isSynced) return true;
        return p!.milesUntilDue <= (
          COMMON_INTERVALS.find(i => i.name === p!.name)?.miles ?? 99999
        ) * 0.4;
      })
      .sort((a, b) => {
        if (a!.isOverdue && !b!.isOverdue) return -1;
        if (!a!.isOverdue && b!.isOverdue) return 1;
        return a!.milesUntilDue - b!.milesUntilDue;
      })
      .slice(0, 7) as Array<{
        name: string;
        milesUntilDue: number;
        monthsUntilDue: number;
        isOverdue: boolean;
        overdueMiles: number;
        priority: string;
        isSynced: boolean;
        isBaseline: boolean;
        Icon: React.ComponentType<{ className?: string }>;
      }>;
  }, [currentMileage, avgMilesPerMonth, allHistoryItems, dismissals]);

  const bundleMap = useMemo(() => getBundleSuggestions(predictions), [predictions]);

  if (predictions.length === 0 || !currentMileage) return null;

  const overdueCount = predictions.filter(p => p.isOverdue && !p.isBaseline).length;
  const baselineCount = predictions.filter(p => p.isBaseline).length;
  const soonCount = predictions.filter(p => !p.isOverdue && p.milesUntilDue <= 2000).length;
  const syncedCount = predictions.filter(p => p.isSynced).length;

  const handleServiceLogged = async () => {
    if (!vehicle.id || !supabase) return;
    const { data } = await supabase
      .from('maintenance_dismissals')
      .select('*')
      .eq('vehicle_id', vehicle.id);
    if (data) setDismissals(data);
  };

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <button
            onClick={toggleCollapsed}
            className="flex items-center gap-2.5 group"
            aria-expanded={!collapsed}
          >
            <h2 className="text-base font-semibold text-white group-hover:text-white/80 transition-colors">
              Maintenance Forecast
            </h2>
            <span className="text-xs text-white/30 font-normal">Estimated</span>
            <ChevronDown
              className={`h-4 w-4 text-white/30 group-hover:text-white/50 transition-all duration-200 ${collapsed ? '-rotate-90' : ''}`}
            />
          </button>

          <div className="flex items-center gap-2">
            {collapsed ? (
              <>
                {overdueCount > 0 && (
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 border border-red-500/25">
                    {overdueCount} overdue
                  </span>
                )}
                {baselineCount > 0 && (
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/12 text-amber-400 border border-amber-500/20">
                    {baselineCount} unverified
                  </span>
                )}
                {soonCount > 0 && (
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-400/12 text-amber-400 border border-amber-400/20">
                    {soonCount} due soon
                  </span>
                )}
                {overdueCount === 0 && soonCount === 0 && baselineCount === 0 && (
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-info-wash text-info border border-info-border">
                    All on track
                  </span>
                )}
              </>
            ) : (
              <>
                {overdueCount > 0 && (
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 border border-red-500/25">
                    {overdueCount} overdue
                  </span>
                )}
                {baselineCount > 0 && (
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/12 text-amber-400 border border-amber-500/20">
                    {baselineCount} unverified
                  </span>
                )}
                {soonCount > 0 && !overdueCount && (
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-400/12 text-amber-400 border border-amber-400/20">
                    {soonCount} due soon
                  </span>
                )}
              </>
            )}
          </div>
        </div>

        <div
          className="overflow-hidden transition-all duration-300 ease-in-out"
          style={{ maxHeight: collapsed ? 0 : 800, opacity: collapsed ? 0 : 1 }}
        >
          <div className="relative">
            <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10 snap-x snap-mandatory">
              {predictions.map((item, i) => (
                <div key={i} className="snap-start">
                  <ForecastCard
                    item={item}
                    vehicle={vehicle}
                    bundleHints={bundleMap.get(item.name) || []}
                    onLogService={() => setLogServiceTarget(item.name)}
                  />
                </div>
              ))}
              <div className="flex-shrink-0 w-4" aria-hidden />
            </div>
            <div className="pointer-events-none absolute right-0 top-0 bottom-2 w-12 bg-gradient-to-l from-[#0a0a0f] to-transparent rounded-r-2xl" />
          </div>

          <p className="text-xs text-white/20 mt-2">
            Based on {currentMileage.toLocaleString()} mi &amp; {avgMilesPerMonth.toLocaleString()} mi/mo avg.
            {syncedCount > 0 && (
              <span className="text-info/50 ml-1">{syncedCount} item{syncedCount !== 1 ? 's' : ''} auto-linked from history.</span>
            )}
          </p>
        </div>
      </div>

      {logServiceTarget && vehicle.id && (
        <LogServiceModal
          open={!!logServiceTarget}
          onOpenChange={(open) => { if (!open) setLogServiceTarget(null); }}
          categoryName={logServiceTarget}
          vehicleId={vehicle.id}
          currentMileage={currentMileage}
          onServiceLogged={handleServiceLogged}
        />
      )}
    </>
  );
}
