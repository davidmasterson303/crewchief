'use client';

import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DollarSign, TrendingUp, Wrench, Calendar } from 'lucide-react';

interface ServiceCostSummaryProps {
  maintenanceLineItems?: any[];
}

export default function ServiceCostSummary({ maintenanceLineItems = [] }: ServiceCostSummaryProps) {
  const stats = useMemo(() => {
    const itemsWithCost = maintenanceLineItems.filter(i => i.cost && i.cost > 0);

    if (itemsWithCost.length === 0) return null;

    const totalSpent = itemsWithCost.reduce((sum, i) => sum + (i.cost || 0), 0);

    const now = new Date();
    const thisYear = now.getFullYear();
    const thisMonth = now.getMonth();

    const thisYearItems = itemsWithCost.filter(i => {
      const d = new Date(i.service_date || i.created_at);
      return d.getFullYear() === thisYear;
    });

    const lastThreeMonths = itemsWithCost.filter(i => {
      const d = new Date(i.service_date || i.created_at);
      const monthsAgo = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
      return monthsAgo >= 0 && monthsAgo < 3;
    });

    const yearToDateTotal = thisYearItems.reduce((sum, i) => sum + (i.cost || 0), 0);
    const recentTotal = lastThreeMonths.reduce((sum, i) => sum + (i.cost || 0), 0);

    const byCategory: Record<string, number> = {};
    itemsWithCost.forEach(i => {
      const cat = i.service_type || i.category || 'Other';
      byCategory[cat] = (byCategory[cat] || 0) + (i.cost || 0);
    });

    const topCategories = Object.entries(byCategory)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    const dateRange = (() => {
      const dates = itemsWithCost
        .map(i => new Date(i.service_date || i.created_at))
        .sort((a, b) => a.getTime() - b.getTime());
      if (dates.length < 2) return null;
      const months = Math.max(1, Math.round((dates[dates.length - 1].getTime() - dates[0].getTime()) / (1000 * 60 * 60 * 24 * 30)));
      return months;
    })();

    const avgPerMonth = dateRange ? totalSpent / dateRange : null;

    return {
      totalSpent,
      yearToDateTotal,
      recentTotal,
      topCategories,
      avgPerMonth,
      itemCount: itemsWithCost.length,
    };
  }, [maintenanceLineItems]);

  if (!stats) return null;

  const fmt = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  return (
    <Card className="bg-slate-900/60 border-white/10">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-white text-base">
          <DollarSign className="h-5 w-5 text-info" />
          Service Cost Summary
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-3 mb-5 sm:grid-cols-3">
          <div className="p-4 bg-white/4 rounded-xl border border-white/8 text-center">
            <p className="label-uppercase mb-2">Total Spent</p>
            <p className="text-xl font-bold text-white tabular-nums">{fmt(stats.totalSpent)}</p>
            <p className="text-xs text-white/50 mt-1">{stats.itemCount} records</p>
          </div>

          <div className="p-4 bg-white/4 rounded-xl border border-white/8 text-center">
            <p className="label-uppercase mb-2">This Year</p>
            <p className="text-xl font-bold text-white tabular-nums">{fmt(stats.yearToDateTotal)}</p>
            <p className="text-xs text-white/50 mt-1">YTD {new Date().getFullYear()}</p>
          </div>

          <div className="p-4 bg-white/4 rounded-xl border border-white/8 text-center">
            <p className="label-uppercase mb-2">Avg / Month</p>
            <p className="text-xl font-bold text-white tabular-nums">
              {stats.avgPerMonth ? fmt(stats.avgPerMonth) : '—'}
            </p>
            <p className="text-xs text-white/50 mt-1">Estimated</p>
          </div>
        </div>

        {stats.topCategories.length > 0 && (
          <div>
            <p className="label-uppercase mb-3">Top Categories</p>
            <div className="space-y-2.5">
              {stats.topCategories.map(([cat, amount]) => {
                const pct = (amount / stats.totalSpent) * 100;
                return (
                  <div key={cat}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm text-white/70 truncate max-w-[60%]">{cat}</span>
                      <span className="text-sm font-semibold text-white tabular-nums">{fmt(amount)}</span>
                    </div>
                    <div className="h-1.5 bg-white/8 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-cyan-500 rounded-full transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
