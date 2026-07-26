'use client';

import Link from 'next/link';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Car, ChevronLeft, Clock, MessageSquare, Wrench, CreditCard as Edit2, Check, X, Info, ChevronRight, Tag } from 'lucide-react';
import { isDemoVehicleId } from '@/lib/demo';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { updateVehicleAvgMileage, updateVehicleMileage, updateVehicleStatus } from '@/app/actions';
import { invalidateDashboardCache } from '@/lib/query-invalidation';
import { AccountMenu } from '@/components/AccountMenu';

interface DashboardLayoutProps {
  vehicle: any;
  knowledge?: any;
  currentPage?: string;
  children: React.ReactNode;
  vehicleImage?: string;
  healthSummary?: { health_score?: number } | null;
}

const tabs = [
  { key: 'dashboard', label: 'Dashboard', icon: Wrench, href: (id: string) => `/dashboard/${id}` },
  { key: 'consultant', label: 'Consultant', icon: MessageSquare, href: (id: string) => `/consultant/${id}` },
  { key: 'maintenance', label: 'Maintenance', icon: Clock, href: (id: string) => `/documents/${id}` },
  { key: 'vehicle-info', label: 'Vehicle Info', icon: Info, href: (id: string) => `/vehicle-info/${id}` },
] as const;

export default function DashboardLayout({ vehicle, knowledge, currentPage, children, vehicleImage, healthSummary }: DashboardLayoutProps) {
  const router = useRouter();
  const activeBreadcrumb = tabs.find(({ key }) => key === currentPage)?.label ?? '';
  const [isEditingAvgMileage, setIsEditingAvgMileage] = useState(false);
  const [isEditingCurrentMileage, setIsEditingCurrentMileage] = useState(false);
  const [avgMileage, setAvgMileage] = useState(vehicle.avg_miles_per_month?.toString() || '');
  const [currentMileage, setCurrentMileage] = useState(vehicle.current_mileage?.toString() || '');
  const [isSaving, setIsSaving] = useState(false);
  const [displayVehicle, setDisplayVehicle] = useState(vehicle);
  const [scrolled, setScrolled] = useState(false);
  const [isStatusOpen, setIsStatusOpen] = useState(false);
  const isDemo = isDemoVehicleId(vehicle.id);

  useEffect(() => {
    setDisplayVehicle(vehicle);
    setAvgMileage(vehicle.avg_miles_per_month?.toString() || '');
    setCurrentMileage(vehicle.current_mileage?.toString() || '');
  }, [vehicle]);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 60);
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    if (!isStatusOpen) return;
    const close = () => setIsStatusOpen(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [isStatusOpen]);

  const focalX = vehicle.focal_point_x ?? 50;
  const focalY = vehicle.focal_point_y ?? 50;

  const backgroundStyle = vehicleImage ? {
    backgroundImage: `linear-gradient(rgba(0, 0, 0, 0.82), rgba(0, 0, 0, 0.82)), url('${vehicleImage}')`,
    backgroundSize: 'cover',
    backgroundPosition: `${focalX}% ${focalY}%`,
  } : undefined;

  const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
    daily_driver: { label: 'Daily Driver', color: 'text-green-300', bg: 'bg-green-500/12', border: 'border-green-400/25' },
    weekend:      { label: 'Weekend',      color: 'text-info-strong', bg: 'bg-info-wash',    border: 'border-info-border' },
    stored:       { label: 'Stored',       color: 'text-amber-300', bg: 'bg-amber-500/12', border: 'border-amber-400/25' },
    for_sale:     { label: 'For Sale',     color: 'text-red-300',   bg: 'bg-red-500/12',   border: 'border-red-400/25' },
  };

  const handleSaveStatus = async (status: string) => {
    if (isDemo) return;
    setIsStatusOpen(false);
    const prev = displayVehicle.vehicle_status;
    setDisplayVehicle((d: any) => ({ ...d, vehicle_status: status }));
    const result = await updateVehicleStatus(vehicle.id, status as any);
    if (result.success) {
      toast.success(`Status updated to ${STATUS_CONFIG[status]?.label}`);
      invalidateDashboardCache(vehicle.id);
    } else {
      toast.error('Failed to update status');
      setDisplayVehicle((d: any) => ({ ...d, vehicle_status: prev }));
    }
  };

  const getReliabilityBadge = (score: number) => {
    if (score >= 8) return { text: 'Excellent', color: 'bg-green-500/20 text-green-300 border-green-400/30' };
    if (score >= 6) return { text: 'Good', color: 'bg-info-wash text-info border-info-border' };
    if (score >= 4) return { text: 'Fair', color: 'bg-yellow-500/20 text-yellow-300 border-yellow-400/30' };
    return { text: 'Poor', color: 'bg-red-500/20 text-red-300 border-red-400/30' };
  };

  const handleSaveAvgMileage = async () => {
    const value = parseInt(avgMileage);
    if (isNaN(value) || value < 0) {
      toast.error('Please enter a valid number');
      return;
    }
    setIsSaving(true);
    setDisplayVehicle((prev: any) => ({ ...prev, avg_miles_per_month: value }));
    setIsEditingAvgMileage(false);
    const result = await updateVehicleAvgMileage(vehicle.id, value);
    if (result.success) {
      toast.success('Average mileage updated');
      invalidateDashboardCache(vehicle.id);
    } else {
      toast.error(result.error || 'Failed to update');
      setDisplayVehicle((prev: any) => ({ ...prev, avg_miles_per_month: vehicle.avg_miles_per_month }));
      setAvgMileage(vehicle.avg_miles_per_month?.toString() || '');
    }
    setIsSaving(false);
  };

  const handleSaveCurrentMileage = async () => {
    const value = parseInt(currentMileage);
    if (isNaN(value) || value < displayVehicle.current_mileage) {
      toast.error('Mileage must be greater than or equal to current mileage');
      return;
    }
    setIsSaving(true);
    setDisplayVehicle((prev: any) => ({ ...prev, current_mileage: value }));
    setIsEditingCurrentMileage(false);
    const result = await updateVehicleMileage(vehicle.id, value);
    if (result.success) {
      toast.success('Mileage updated');
      invalidateDashboardCache(vehicle.id);
    } else {
      toast.error(result.error || 'Failed to update');
      setDisplayVehicle((prev: any) => ({ ...prev, current_mileage: vehicle.current_mileage }));
      setCurrentMileage(vehicle.current_mileage?.toString() || '');
    }
    setIsSaving(false);
  };

  const handleCancelEdit = () => {
    setAvgMileage(vehicle.avg_miles_per_month?.toString() || '');
    setIsEditingAvgMileage(false);
  };

  const handleCancelMileageEdit = () => {
    setCurrentMileage(vehicle.current_mileage?.toString() || '');
    setIsEditingCurrentMileage(false);
  };

  return (
    <div className="min-h-screen bg-black" style={backgroundStyle}>
      <nav className={`sticky top-0 z-40 backdrop-blur-xl transition-all duration-200 ${scrolled ? 'bg-black/98 border-b border-white/10 shadow-lg shadow-black/50' : 'bg-black/90 border-b border-white/8'}`}>
        <div className="max-w-7xl mx-auto px-6 lg:px-12">
          <div className={`flex items-center justify-between transition-all duration-200 ${scrolled ? 'py-3' : 'py-4'}`}>
            <div className="flex items-center gap-3">
              <Link href="/" className="flex items-center space-x-2.5 group">
                <Car className="h-6 w-6 text-cyan-400 transition-transform group-hover:scale-105" />
                <span className={`font-semibold text-white tracking-tight transition-all duration-200 ${scrolled ? 'text-base' : 'text-lg'}`}>CrewChief</span>
              </Link>

              <div className="hidden sm:flex items-center gap-1 text-white/30 text-sm">
                <ChevronRight className="h-3.5 w-3.5" />
                <button
                  onClick={() => router.push('/')}
                  className="text-white/50 hover:text-white transition-colors min-h-[44px] flex items-center px-1"
                >
                  Garage
                </button>
                <ChevronRight className="h-3.5 w-3.5" />
                <span className="text-white/70 px-1">{vehicle.year} {vehicle.make} {vehicle.model}</span>
                {scrolled && healthSummary?.health_score != null && (
                  <span className={`ml-1.5 inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                    healthSummary.health_score >= 80
                      ? 'bg-green-500/15 text-green-300 border border-green-400/25'
                      : healthSummary.health_score >= 60
                      ? 'bg-amber-500/15 text-amber-300 border border-amber-400/25'
                      : 'bg-red-500/15 text-red-300 border border-red-400/25'
                  }`}>
                    {healthSummary.health_score}
                  </span>
                )}
                <ChevronRight className="h-3.5 w-3.5" />
                <span className="text-white px-1 font-medium">{activeBreadcrumb}</span>
              </div>
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push('/')}
              className="text-white/60 hover:text-white hover:bg-white/8 gap-1.5 transition-colors min-h-[44px]"
            >
              <ChevronLeft className="h-4 w-4" />
              <span className="hidden sm:inline">Garage</span>
            </Button>
            {/* Hidden in demo mode — an anonymous visitor has no account to
                manage, and a sign-out that does nothing is worse than absent. */}
            {!isDemo && <AccountMenu />}
          </div>

          {scrolled && (
            <div className="flex border-t border-white/8 overflow-x-auto edge-fade-x">
              {tabs.map(({ key, label, icon: Icon, href }) => {
                const isActive = currentPage === key;
                return (
                  <Link
                    key={key}
                    href={href(vehicle.id)}
                    className={`relative flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium whitespace-nowrap transition-colors duration-150 ${
                      isActive ? 'text-cyan-400 bg-cyan-400/5' : 'text-white/50 hover:text-white/80 hover:bg-white/5'
                    }`}
                  >
                    <Icon className={`h-3.5 w-3.5 ${isActive ? 'text-cyan-400' : 'text-white/40'}`} />
                    {label}
                    {isActive && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-cyan-400 rounded-t-full" />}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-6 lg:px-12 pt-10 pb-6">
        <div className="mb-8">
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
            <div>
              <h1 className="text-4xl lg:text-5xl font-bold text-white tracking-tight mb-1.5">
                {vehicle.year} {vehicle.make} {vehicle.model}
              </h1>
              {vehicle.trim && (
                <p className="text-base text-white/50 font-medium">{vehicle.trim}</p>
              )}
            </div>

            <div className="flex flex-wrap items-end gap-8">
              <div className="flex flex-col gap-1">
                <span className="label-uppercase">Mileage</span>
                {isEditingCurrentMileage ? (
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      value={currentMileage}
                      onChange={(e) => setCurrentMileage(e.target.value)}
                      className="w-28 h-8 bg-white/8 border-white/20 text-white text-sm"
                      disabled={isSaving}
                      autoFocus
                    />
                    <Button size="sm" onClick={handleSaveCurrentMileage} disabled={isSaving} className="h-8 px-2 bg-green-600 hover:bg-green-500">
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={handleCancelMileageEdit} disabled={isSaving} className="h-8 px-2 text-white/50 hover:text-white hover:bg-white/8">
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : (
                  <button
                    onClick={() => setIsEditingCurrentMileage(true)}
                    className="flex items-center gap-1.5 group/edit"
                    aria-label="Edit mileage"
                  >
                    <span className="text-2xl font-bold text-white tabular-nums tracking-tight">{displayVehicle.current_mileage?.toLocaleString() || '—'}</span>
                    <span className="text-sm text-white/30 font-normal">mi</span>
                    <Edit2 className="h-3.5 w-3.5 text-white/30 group-hover/edit:text-cyan-400 transition-colors opacity-0 group-hover/edit:opacity-100" />
                  </button>
                )}
              </div>

              <div className="flex flex-col gap-1">
                <span className="label-uppercase">Avg. Monthly Miles</span>
                {isEditingAvgMileage ? (
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      value={avgMileage}
                      onChange={(e) => setAvgMileage(e.target.value)}
                      className="w-24 h-8 bg-white/8 border-white/20 text-white text-sm"
                      disabled={isSaving}
                      autoFocus
                    />
                    <Button size="sm" onClick={handleSaveAvgMileage} disabled={isSaving} className="h-8 px-2 bg-green-600 hover:bg-green-500">
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={handleCancelEdit} disabled={isSaving} className="h-8 px-2 text-white/50 hover:text-white hover:bg-white/8">
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : (
                  <button
                    onClick={() => setIsEditingAvgMileage(true)}
                    className="flex items-center gap-1.5 group/edit"
                    aria-label="Edit average monthly miles"
                  >
                    <span className="text-2xl font-bold text-white tabular-nums tracking-tight">{displayVehicle.avg_miles_per_month || '—'}</span>
                    <span className="text-sm text-white/30 font-normal">mi/mo</span>
                    <Edit2 className="h-3.5 w-3.5 text-white/30 group-hover/edit:text-cyan-400 transition-colors opacity-0 group-hover/edit:opacity-100" />
                  </button>
                )}
              </div>

              <div className="flex flex-col gap-1 relative">
                <span className="label-uppercase">Status</span>
                <div className="relative">
                  <button
                    onClick={() => !isDemo && setIsStatusOpen(o => !o)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-medium transition-all ${
                      isDemo ? 'opacity-60 cursor-not-allowed' : 'hover:border-white/25 hover:bg-white/5'
                    } ${
                      displayVehicle.vehicle_status
                        ? `${STATUS_CONFIG[displayVehicle.vehicle_status]?.bg} ${STATUS_CONFIG[displayVehicle.vehicle_status]?.border} ${STATUS_CONFIG[displayVehicle.vehicle_status]?.color}`
                        : 'bg-white/5 border-white/15 text-white/50'
                    }`}
                  >
                    <Tag className="h-3.5 w-3.5" />
                    {displayVehicle.vehicle_status ? STATUS_CONFIG[displayVehicle.vehicle_status]?.label : 'Set Status'}
                  </button>
                  {isStatusOpen && (
                    <div className="absolute top-full mt-1.5 right-0 z-50 bg-[#111] border border-white/12 rounded-xl shadow-xl shadow-black/50 py-1.5 min-w-[160px]">
                      {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
                        <button
                          key={key}
                          onClick={() => handleSaveStatus(key)}
                          className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm font-medium transition-colors hover:bg-white/6 ${
                            displayVehicle.vehicle_status === key ? cfg.color : 'text-white/65'
                          }`}
                        >
                          <Tag className={`h-3.5 w-3.5 ${displayVehicle.vehicle_status === key ? cfg.color : 'text-white/30'}`} />
                          {cfg.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {knowledge?.reliability_score && (
                <div className="flex flex-col gap-1">
                  <span className="label-uppercase">Reliability</span>
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-bold text-white tabular-nums tracking-tight">
                      {knowledge.reliability_score}
                      <span className="text-sm text-white/40 ml-0.5">/10</span>
                    </span>
                    <Badge variant="outline" className={`${getReliabilityBadge(knowledge.reliability_score).color} border text-xs`}>
                      {getReliabilityBadge(knowledge.reliability_score).text}
                    </Badge>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>


        <div className="flex mb-8 border-b border-white/10 overflow-x-auto edge-fade-x">
          {tabs.map(({ key, label, icon: Icon, href }) => {
            const isActive = currentPage === key;
            return (
              <Link
                key={key}
                href={href(vehicle.id)}
                className={`relative flex items-center gap-2 px-5 py-3.5 text-sm font-medium whitespace-nowrap transition-colors duration-150 ${
                  isActive ? 'text-cyan-400 bg-cyan-400/5' : 'text-white/50 hover:text-white/80 hover:bg-white/5'
                }`}
              >
                <Icon className={`h-4 w-4 ${isActive ? 'text-cyan-400' : 'text-white/40'}`} />
                {label}
                {isActive && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-cyan-400 rounded-t-full" />}
              </Link>
            );
          })}
        </div>

        <div className="glass-panel rounded-2xl p-6">
          {children}
        </div>

        <footer className="mt-10 pt-6 border-t border-white/6 flex items-center justify-between text-xs text-white/25">
          <span>CrewChief &copy; {new Date().getFullYear()}</span>
          <div className="flex items-center gap-4">
            <a href="mailto:feedback@crewchief.app" className="hover:text-white/50 transition-colors">Feedback</a>
            <Link href="/" className="hover:text-white/50 transition-colors">Garage</Link>
          </div>
        </footer>
      </div>
    </div>
  );
}
