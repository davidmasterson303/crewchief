'use client';

import { useState, useEffect, useMemo, forwardRef, useImperativeHandle, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CircleAlert as AlertCircle, FileText, Wrench, RefreshCw } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  updateIssueStatus,
  updateModificationStatusWithTier,
  getIssueTracking,
  getModificationTracking,
  getModificationDetailsBatch,
  addMaintenanceHistory,
  preloadAllPerformanceModifications,
  getModNamesOnly,
  getDetailedModsWithCachedDetails,
  getCachedPerformanceModifications,
  getTierProgress,
  getModsForEarnedTier,
  ensureAggressiveModMinimum,
  generateVehicleDossier,
  generateVehicleHealthSummary,
} from '@/app/actions';
import { useWishlistData } from '@/hooks/useWishlistData';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { invalidateDashboardCache } from '@/lib/query-invalidation';
import IssueFixDialog from './IssueFixDialog';
import MaintenanceHistoryDialog from './MaintenanceHistoryDialog';
import IssuesTab from './insights/IssuesTab';
import MaintenanceTab from './insights/MaintenanceTab';
import ModificationsTab from './insights/ModificationsTab';
import type { TierProgress, Tier } from './TierProgressCard';

interface VehicleInsightsProps {
  vehicle: any;
  knowledge: any;
  onWishlistStateUpdate?: (itemNames: Set<string>) => void;
}

const VehicleInsights = forwardRef<{ getSavedItemNames: () => Set<string> }, VehicleInsightsProps>(
  ({ vehicle, knowledge, onWishlistStateUpdate }, ref) => {
    const router = useRouter();
    const { data: wishlistItems } = useWishlistData(vehicle.id);
    const savedItemNames = useMemo(
      () => new Set<string>((wishlistItems ?? []).map((item: any) => item.item_name as string)),
      [wishlistItems]
    );
    const [issueTracking, setIssueTracking] = useState<any[]>([]);
    const [modTracking, setModTracking] = useState<any[]>([]);
    const [modDetails, setModDetails] = useState<Record<string, any>>({});
    const [loading, setLoading] = useState(false);
    const [issueFixDialogOpen, setIssueFixDialogOpen] = useState(false);
    const [selectedIssue, setSelectedIssue] = useState<{ id: string; name: string } | null>(null);
    const [maintenanceDialogOpen, setMaintenanceDialogOpen] = useState(false);
    const [selectedMaintenanceItem, setSelectedMaintenanceItem] = useState<string>('');
    const [selectedModForInstall, setSelectedModForInstall] = useState<string>('');
    const [performanceMods, setPerformanceMods] = useState<any[]>([]);
    const [earnedTier, setEarnedTier] = useState<Tier>((vehicle.earned_tier || 'mild') as Tier);
    const [tierProgress, setTierProgress] = useState<TierProgress | null>(null);
    const [tierProgressLoading, setTierProgressLoading] = useState(false);
    const [dossierTab, setDossierTab] = useState('issues');
    const [loadingModNames, setLoadingModNames] = useState(false);
    const [isAutoResearching, setIsAutoResearching] = useState(false);
    const autoResearchRef = useRef(false);

    useImperativeHandle(ref, () => ({
      getSavedItemNames: () => savedItemNames,
    }));

    useEffect(() => {
      loadTracking();
      preloadAllPerformanceModifications(vehicle.id).catch(() => {});
    }, [vehicle.id]);

    useEffect(() => {
      loadTierProgress();
    }, [vehicle.id]);

    useEffect(() => {
      loadPerformanceMods(earnedTier);
    }, [earnedTier, vehicle.id]);

    useEffect(() => {
      onWishlistStateUpdate?.(savedItemNames);
    }, [savedItemNames, onWishlistStateUpdate]);

    useEffect(() => {
      if ((knowledge?.research_status === 'pending' || knowledge?.research_status === 'failed') && !autoResearchRef.current) {
        autoResearchRef.current = true;
        const autoResearch = async () => {
          setIsAutoResearching(true);
          const result = await generateVehicleDossier(vehicle.id, {
            year: vehicle.year,
            make: vehicle.make,
            model: vehicle.model,
          });
          if (result.success) {
            invalidateDashboardCache(vehicle.id);
            router.refresh();
          }
          setIsAutoResearching(false);
        };
        autoResearch();
      }
    }, [vehicle.id, vehicle.year, vehicle.make, vehicle.model, knowledge?.research_status, router]);

    const loadTierProgress = async () => {
      setTierProgressLoading(true);
      const result = await getTierProgress(vehicle.id);
      if (result.success && result.progress) {
        setTierProgress(result.progress);
        if (result.tier && result.tier !== earnedTier) {
          setEarnedTier(result.tier);
        }
      }
      setTierProgressLoading(false);
    };

    const loadTracking = async () => {
      const [issueResult, modResult] = await Promise.all([
        getIssueTracking(vehicle.id),
        getModificationTracking(vehicle.id),
      ]);

      if (issueResult.success) setIssueTracking(issueResult.data);

      if (modResult.success) {
        setModTracking(modResult.data);
        const modNames = (knowledge?.common_mods || []).map((mod: any) => mod.name);
        if (modNames.length > 0) {
          const batchResult = await getModificationDetailsBatch(vehicle.id, modNames);
          if (batchResult.success) setModDetails(batchResult.data);
        }
      }
    };

    const loadPerformanceMods = async (tier: Tier) => {
      setLoadingModNames(true);

      // Try tier-specific mod list first
      const tierResult = await getModsForEarnedTier(vehicle.id, tier);
      if (tierResult.success && tierResult.data.length > 0) {
        setPerformanceMods(tierResult.data);
        const detailsMap: Record<string, any> = {};
        for (const mod of tierResult.data) {
          if (mod.details) detailsMap[mod.name] = mod.details;
        }
        setModDetails((prev) => ({ ...prev, ...detailsMap }));
        setLoadingModNames(false);
        return;
      }

      // Fallback: load from names cache then details cache
      const namesResult = await getModNamesOnly(vehicle.id, tier);
      if (namesResult.success && namesResult.data.length > 0) {
        setPerformanceMods(namesResult.data);
      }
      setLoadingModNames(false);

      const detailsResult = await getDetailedModsWithCachedDetails(vehicle.id, tier);
      if (detailsResult.success && detailsResult.data.length > 0) {
        setPerformanceMods(detailsResult.data);
        const detailsMap: Record<string, any> = {};
        for (const mod of detailsResult.data) {
          if (mod.details) detailsMap[mod.name] = mod.details;
        }
        setModDetails((prev) => ({ ...prev, ...detailsMap }));
      } else {
        const fallbackResult = await getCachedPerformanceModifications(vehicle.id, tier);
        if (fallbackResult.success && fallbackResult.data.length > 0) {
          setPerformanceMods(fallbackResult.data);
          const detailsMap: Record<string, any> = {};
          for (const mod of fallbackResult.data) {
            if (mod.details) detailsMap[mod.name] = mod.details;
          }
          setModDetails((prev) => ({ ...prev, ...detailsMap }));
        }
      }

      // If aggressive, ensure perpetual backfill minimum
      if (tier === 'aggressive') {
        ensureAggressiveModMinimum(vehicle.id).catch(() => {});
      }
    };

    const handleIssueStatusUpdate = async (
      issueIdentifier: string,
      status: 'pending' | 'completed' | 'not_interested'
    ) => {
      setLoading(true);
      const result = await updateIssueStatus(
        vehicle.id,
        issueIdentifier,
        status,
        undefined,
        status === 'completed' ? new Date().toISOString().split('T')[0] : undefined
      );
      if (result.success) {
        toast.success('Issue status updated');
        await loadTracking();
        generateVehicleHealthSummary(vehicle.id, true).then(() => {
          invalidateDashboardCache(vehicle.id);
          router.refresh();
        });
        invalidateDashboardCache(vehicle.id);
        router.refresh();
      } else {
        toast.error('Failed to update issue status');
      }
      setLoading(false);
    };

    const handleWishlistToggleComplete = async () => {
      await loadTracking();
    };

    const triggerPerfStatsRecalc = () => {
      fetch('/api/performance-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicleId: vehicle.id }),
      }).catch(() => {});
    };

    const handleModStatusUpdate = async (
      modName: string,
      status: 'pending' | 'completed' | 'not_interested',
      tier: Tier
    ) => {
      if (status === 'completed') {
        setSelectedModForInstall(modName);
        setMaintenanceDialogOpen(true);
        return;
      }
      setLoading(true);
      const result = await updateModificationStatusWithTier(vehicle.id, modName, status, tier);
      if (result.success) {
        if (status === 'not_interested' && result.backfillTriggered) {
          toast.success('Skipped — a replacement mod is being generated');
        } else {
          toast.success('Modification status updated');
        }

        if (result.newTier && result.newTier !== earnedTier) {
          setEarnedTier(result.newTier);
          toast.success(`Tier unlocked: ${result.newTier.charAt(0).toUpperCase() + result.newTier.slice(1)}!`);
        }

        await loadTracking();
        await loadTierProgress();
        await loadPerformanceMods(result.newTier || earnedTier);
        invalidateDashboardCache(vehicle.id);
        triggerPerfStatsRecalc();
        router.refresh();
      } else {
        toast.error('Failed to update modification status');
      }
      setLoading(false);
    };

    const handleMarkFixedClick = (issueId: string, issueName: string) => {
      setSelectedIssue({ id: issueId, name: issueName });
      setIssueFixDialogOpen(true);
    };

    const handleIssueFixSubmit = async (data: {
      dateCompleted: string;
      shopName?: string;
      cost?: number;
      notes?: string;
    }) => {
      if (!selectedIssue) return;
      setLoading(true);
      const result = await updateIssueStatus(
        vehicle.id,
        selectedIssue.id,
        'completed',
        data.notes,
        data.dateCompleted,
        data.shopName,
        data.cost
      );
      if (result.success) {
        const historyResult = await addMaintenanceHistory(
          vehicle.id,
          selectedIssue.name,
          data.dateCompleted,
          data.shopName,
          data.cost,
          data.notes
        );
        if (historyResult.success) {
          toast.success('Issue fixed and added to maintenance history');
        } else {
          toast.success('Issue marked as fixed (history entry failed, but issue recorded)');
        }
        setIssueFixDialogOpen(false);
        setSelectedIssue(null);
        await loadTracking();
        invalidateDashboardCache(vehicle.id);
        router.refresh();
      } else {
        toast.error('Failed to mark issue as fixed');
      }
      setLoading(false);
    };

    const handleMaintenanceHistorySubmit = async (data: {
      dateCompleted: string;
      description: string;
      shopName?: string;
      cost?: number;
      notes?: string;
    }) => {
      setLoading(true);
      if (selectedModForInstall) {
        const modResult = await updateModificationStatusWithTier(
          vehicle.id,
          selectedModForInstall,
          'completed',
          earnedTier,
          data.notes,
          data.dateCompleted
        );
        if (!modResult.success) {
          toast.error('Failed to update modification status');
          setLoading(false);
          return;
        }

        if (modResult.newTier && modResult.newTier !== earnedTier) {
          setEarnedTier(modResult.newTier);
          toast.success(`Tier unlocked: ${modResult.newTier.charAt(0).toUpperCase() + modResult.newTier.slice(1)}!`);
        }
      }
      const result = await addMaintenanceHistory(
        vehicle.id,
        data.description,
        data.dateCompleted,
        data.shopName,
        data.cost,
        data.notes
      );
      if (result.success) {
        if (selectedModForInstall) {
          toast.success('Modification installed and added to maintenance history');
          setSelectedModForInstall('');
          triggerPerfStatsRecalc();
        } else {
          toast.success('Added to maintenance history');
        }
        setMaintenanceDialogOpen(false);
        setSelectedMaintenanceItem('');
        await loadTracking();
        await loadTierProgress();
        await loadPerformanceMods(earnedTier);
        generateVehicleHealthSummary(vehicle.id, true).then(() => {
          invalidateDashboardCache(vehicle.id);
          router.refresh();
        });
        invalidateDashboardCache(vehicle.id);
        router.refresh();
      } else {
        toast.error('Failed to add maintenance history');
      }
      setLoading(false);
    };

    if (!knowledge || knowledge.research_status === 'pending') {
      return (
        <Card className="bg-gradient-to-br from-slate-900/60 to-slate-900/40 border-info-border overflow-hidden relative">
          <div className="absolute inset-0 bg-gradient-to-r from-cyan-400/5 via-transparent to-cyan-400/5 animate-pulse" />
          <CardHeader className="relative">
            <div className="space-y-4">
              <CardTitle className="text-white flex items-center gap-3">
                <div className="relative">
                  <div className="absolute inset-0 bg-info-wash rounded-full animate-pulse blur" />
                  <RefreshCw className="h-5 w-5 text-info animate-spin relative" />
                </div>
                <span>Vehicle Research In Progress</span>
              </CardTitle>
              <div className="text-slate-300 text-sm space-y-2">
                <p>Analyzing your {vehicle.year} {vehicle.make} {vehicle.model}...</p>
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">
                    <div className="w-1 h-3 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-1 h-3 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-1 h-3 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                  <span className="text-xs text-slate-400">Gathering data</span>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="relative">
            <div className="space-y-3">
              <div className="space-y-2">
                {['Issues Analysis', 'Maintenance Schedule', 'Performance Data'].map((label, i) => (
                  <div key={label} className="flex items-center justify-between">
                    <span className="text-xs text-slate-400">{label}</span>
                    <div className="w-24 h-1.5 bg-slate-700/50 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-cyan-400 to-cyan-500 rounded-full animate-pulse"
                        style={{ width: `${(i + 1) * 20 + 13}%`, animationDelay: `${i * 300}ms` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="pt-2 border-t border-slate-700/50">
                <p className="text-xs text-slate-400 italic">This may take a moment. Feel free to explore the page.</p>
              </div>
            </div>
          </CardContent>
        </Card>
      );
    }

    if (knowledge.research_status === 'failed') {
      return (
        <Card className="bg-slate-900/50 border-yellow-400/20">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              {isAutoResearching
                ? <RefreshCw className="h-5 w-5 text-yellow-400 animate-spin" />
                : <AlertCircle className="h-5 w-5 text-yellow-400" />
              }
              Research Unavailable
            </CardTitle>
            <CardDescription className="text-slate-400">
              {isAutoResearching
                ? 'Retrying research...'
                : 'We encountered an issue researching your vehicle. You can still track maintenance manually.'}
            </CardDescription>
          </CardHeader>
        </Card>
      );
    }

    if (knowledge.research_status === 'unsupported') {
      return (
        <Card className="border-yellow-200 bg-yellow-50">
          <CardHeader>
            <CardTitle>Limited Data Available</CardTitle>
            <CardDescription>
              We couldn&apos;t find enough information about your specific vehicle, but you can still use CrewChief
              to track maintenance and get general advice.
            </CardDescription>
          </CardHeader>
        </Card>
      );
    }

    const knownIssues = knowledge.known_issues || [];
    const maintenanceSchedule = knowledge.maintenance_schedule || [];

    return (
      <>
        <Card className="bg-slate-900/50 border-info-border">
          <CardHeader>
            <div>
              <CardTitle className="text-white flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-info" />
                The Dossier
              </CardTitle>
              <CardDescription className="text-slate-400">AI-researched insights for your vehicle</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <Tabs value={dossierTab} onValueChange={setDossierTab} className="w-full">
              <TabsList className={`grid w-full ${vehicle.performance_mindedness === 'stock' ? 'grid-cols-2' : 'grid-cols-3'} mb-4 bg-white/4 border border-white/8 p-0.5 rounded-xl`}>
                {(['issues', 'maintenance', ...(vehicle.performance_mindedness !== 'stock' ? ['mods'] : [])] as string[]).map((tabVal) => {
                  const isActive = dossierTab === tabVal;
                  const tabConfig = {
                    issues:      { Icon: AlertCircle, label: 'Issues',      count: knownIssues.length },
                    maintenance: { Icon: FileText,    label: 'Maintenance', count: maintenanceSchedule.length },
                    mods:        { Icon: Wrench,      label: 'Mods',        count: performanceMods.filter((m) => { const t = modTracking.find((tr) => tr.mod_name === m.name); return !t || t.status === 'pending'; }).length },
                  }[tabVal]!;
                  const { Icon, label, count } = tabConfig;
                  return (
                    <TabsTrigger
                      key={tabVal}
                      value={tabVal}
                      className={`relative flex items-center gap-1.5 rounded-lg py-2 transition-all duration-200 ${isActive ? 'bg-slate-800 text-white shadow-md' : 'text-white/40 hover:text-white/65 bg-transparent'}`}
                      style={isActive ? { boxShadow: '0 0 0 1px rgba(34,211,238,0.18), 0 1px 6px rgba(0,0,0,0.4)' } : undefined}
                    >
                      <Icon className={`h-3.5 w-3.5 ${isActive ? 'text-cyan-400' : ''}`} />
                      <span className={`font-medium text-xs ${isActive ? 'text-white' : ''}`}>{label}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold tabular-nums ${isActive ? 'bg-cyan-400/10 text-cyan-300' : 'bg-white/8 text-white/35'}`}>
                        {count}
                      </span>
                      {isActive && (
                        <span
                          className="absolute bottom-0 left-1/2 -translate-x-1/2 h-[2px] w-8 rounded-full"
                          style={{ background: '#22d3ee', boxShadow: '0 0 8px 1px rgba(34,211,238,0.55)' }}
                        />
                      )}
                    </TabsTrigger>
                  );
                })}
              </TabsList>

              <TabsContent value="issues">
                <IssuesTab
                  issues={knownIssues}
                  vehicleId={vehicle.id}
                  issueTracking={issueTracking}
                  savedItemNames={savedItemNames}
                  loading={loading}
                  onMarkFixed={handleMarkFixedClick}
                  onNotApplicable={handleIssueStatusUpdate}
                  onWishlistToggleComplete={handleWishlistToggleComplete}
                />
              </TabsContent>

              <TabsContent value="maintenance">
                <MaintenanceTab
                  schedule={maintenanceSchedule}
                  vehicleId={vehicle.id}
                  savedItemNames={savedItemNames}
                  loading={loading}
                  onAddToHistory={(itemName) => {
                    setSelectedMaintenanceItem(itemName);
                    setMaintenanceDialogOpen(true);
                  }}
                  onWishlistToggleComplete={handleWishlistToggleComplete}
                />
              </TabsContent>

              {vehicle.performance_mindedness !== 'stock' && (
                <TabsContent value="mods">
                  <ModificationsTab
                    vehicle={vehicle}
                    performanceMods={performanceMods}
                    modDetails={modDetails}
                    modTracking={modTracking}
                    savedItemNames={savedItemNames}
                    loading={loading}
                    loadingModNames={loadingModNames}
                    earnedTier={earnedTier}
                    tierProgress={tierProgress}
                    tierProgressLoading={tierProgressLoading}
                    onModStatusUpdate={handleModStatusUpdate}
                    onWishlistToggleComplete={handleWishlistToggleComplete}
                  />
                </TabsContent>
              )}
            </Tabs>
          </CardContent>
        </Card>

        <IssueFixDialog
          open={issueFixDialogOpen}
          onOpenChange={setIssueFixDialogOpen}
          issueName={selectedIssue?.name || ''}
          onSubmit={handleIssueFixSubmit}
          isLoading={loading}
        />

        <MaintenanceHistoryDialog
          open={maintenanceDialogOpen}
          onOpenChange={setMaintenanceDialogOpen}
          maintenanceItem={selectedModForInstall || selectedMaintenanceItem}
          isModInstallation={!!selectedModForInstall}
          onSubmit={handleMaintenanceHistorySubmit}
          isLoading={loading}
        />
      </>
    );
  }
);

VehicleInsights.displayName = 'VehicleInsights';
export default VehicleInsights;
