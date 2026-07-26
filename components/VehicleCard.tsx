'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  CircleAlert as AlertCircle,
  Trash2,
  ArrowRight,
  Pencil,
  Camera,
  MoveVertical as MoreVertical,
  Car,
  Gauge,
  Clock,
  Tag,
  Crosshair,
} from 'lucide-react';
import { updateVehicleMileage } from '@/app/actions';
import { logger } from '@/lib/logger';
import { isDemoVehicleId, DEMO_IMAGES } from '@/lib/demo';
import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { invalidateDashboardCache } from '@/lib/query-invalidation';
import { queryClient } from '@/lib/query-client';
import { supabase } from '@/lib/supabase';
import { MileageUpdatePrompt } from './MileageUpdatePrompt';
import { VehiclePhotoUploadDialog } from './VehiclePhotoUploadDialog';

interface VehicleCardProps {
  vehicle: any;
  activeRecalls: number;
  healthSummary?: any;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  daily_driver: { label: 'Daily Driver', color: 'text-green-300', bg: 'bg-green-500/15', border: 'border-green-400/30' },
  weekend:      { label: 'Weekend',      color: 'text-info-strong', bg: 'bg-info-wash',    border: 'border-info-border' },
  stored:       { label: 'Stored',       color: 'text-amber-300', bg: 'bg-amber-500/15', border: 'border-amber-400/30' },
  for_sale:     { label: 'For Sale',     color: 'text-red-300',   bg: 'bg-red-500/15',   border: 'border-red-400/30' },
};

function HealthRing({ score }: { score: number }) {
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const fill = (score / 100) * circumference;
  const color = score >= 80 ? '#4ade80' : score >= 60 ? '#22d3ee' : '#fb923c';
  const trackColor = score >= 80 ? 'rgba(74,222,128,0.10)' : score >= 60 ? 'rgba(34,211,238,0.10)' : 'rgba(251,146,60,0.10)';
  const isLow = score < 60;

  return (
    <div className={`relative flex items-center justify-center w-16 h-16 flex-shrink-0 ${isLow ? 'animate-pulse-health' : ''}`}>
      <svg width="64" height="64" viewBox="0 0 64 64" className="-rotate-90">
        <circle cx="32" cy="32" r={radius} fill="none" stroke={trackColor} strokeWidth="5" />
        <circle
          cx="32" cy="32" r={radius}
          fill="none"
          stroke={color}
          strokeWidth="5"
          strokeDasharray={`${fill} ${circumference}`}
          strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 4px ${color}50)` }}
        />
      </svg>
      <span className="absolute text-sm font-bold text-white tabular-nums">{score}</span>
    </div>
  );
}

export function VehicleCard({ vehicle, activeRecalls, healthSummary }: VehicleCardProps) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDeleted, setIsDeleted] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [showMileageDialog, setShowMileageDialog] = useState(false);
  const [mileageInput, setMileageInput] = useState(vehicle.current_mileage.toString());
  const [isUpdatingMileage, setIsUpdatingMileage] = useState(false);
  const [showPhotoDialog, setShowPhotoDialog] = useState(false);
  const [displayVehicle, setDisplayVehicle] = useState(vehicle);
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    setDisplayVehicle(vehicle);
    setMileageInput(vehicle.current_mileage.toString());
    setImageError(false);
  }, [vehicle]);

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (isDemoVehicleId(vehicle.id)) {
      toast.info('Deletion is disabled in demo mode');
      setDeleteDialogOpen(false);
      return;
    }
    setIsDeleting(true);
    try {
      const { error: deleteError } = await supabase.from('vehicles').delete().eq('id', vehicle.id);
      if (!deleteError) {
        setDeleteDialogOpen(false);
        setIsDeleted(true);
        queryClient.setQueryData(['vehicles'], (old: any) => {
          if (Array.isArray(old)) return old.filter((v: any) => v.id !== vehicle.id);
          return old;
        });
        toast.success(`${vehicle.year} ${vehicle.make} ${vehicle.model} removed from garage`);
      } else {
        setIsDeleting(false);
        toast.error(deleteError.message || 'Failed to delete vehicle');
      }
    } catch (error) {
      setIsDeleting(false);
      toast.error('An unexpected error occurred during deletion');
      logger.error('VEHICLE_CARD:DELETE', error as Error);
    }
  };

  const handleUpdateMileage = async () => {
    if (isDemoVehicleId(vehicle.id)) {
      toast.info('Mileage updates are disabled in demo mode');
      setShowMileageDialog(false);
      return;
    }
    const newMileage = parseInt(mileageInput);
    if (isNaN(newMileage) || newMileage < displayVehicle.current_mileage) {
      toast.error('Mileage must be greater than current mileage');
      return;
    }
    setIsUpdatingMileage(true);
    setDisplayVehicle((prev: any) => ({ ...prev, current_mileage: newMileage }));
    setShowMileageDialog(false);
    const result = await updateVehicleMileage(vehicle.id, newMileage);
    if (result.success) {
      toast.success('Mileage updated');
      invalidateDashboardCache(vehicle.id);
    } else {
      toast.error(result.error || 'Failed to update mileage');
      setDisplayVehicle((prev: any) => ({ ...prev, current_mileage: vehicle.current_mileage }));
      setMileageInput(vehicle.current_mileage.toString());
    }
    setIsUpdatingMileage(false);
  };

  const handleViewDashboard = () => {
    router.push(`/dashboard/${vehicle.id}`);
  };

  const FALLBACK_IMAGE = 'https://images.unsplash.com/photo-1517026575992-5e15ad95f780?q=80&w=2340&auto=format&fit=crop';

  const getVehicleImageUrl = () => {
    if (imageError) return FALLBACK_IMAGE;
    if (isDemoVehicleId(vehicle.id) && DEMO_IMAGES[vehicle.id]) {
      return DEMO_IMAGES[vehicle.id];
    }
    return vehicle.custom_image_url || vehicle.image_url || FALLBACK_IMAGE;
  };

  const handleImageError = () => {
    logger.error('VEHICLE_CARD:IMAGE_LOAD', new Error('Image failed to load'));
    setImageError(true);
  };

  if (isDeleted) return null;

  const statusKey = displayVehicle.vehicle_status || 'daily_driver';
  const statusInfo = STATUS_CONFIG[statusKey] || STATUS_CONFIG['daily_driver'];

  const getHealthPill = () => {
    if (!healthSummary) return null;
    const score = healthSummary.health_score;
    if (score >= 80) return { label: 'Good', bg: 'bg-green-500/20', text: 'text-green-300', border: 'border-green-400/30', dot: 'bg-green-400' };
    if (score >= 60) return { label: 'Fair', bg: 'bg-amber-500/20', text: 'text-amber-300', border: 'border-amber-400/30', dot: 'bg-amber-400' };
    return { label: 'Needs Attention', bg: 'bg-red-500/20', text: 'text-red-300', border: 'border-red-400/30', dot: 'bg-red-400' };
  };

  const healthPill = getHealthPill();

  return (
    <div className="group card-lift border rounded-2xl overflow-hidden bg-[#0f1318]/90 backdrop-blur-sm h-full flex flex-col shadow-lg shadow-black/50 edge-light hover:border-cyan-400/30">
      <div className="relative aspect-[3/2] bg-slate-900/60 overflow-hidden group/image">
        {(() => {
          const focalX = vehicle.focal_point_x ?? 50;
          const focalY = vehicle.focal_point_y ?? 50;
          const hasCustomFocal = vehicle.custom_image_url && vehicle.focal_point_x != null;
          const showAdjustNudge = vehicle.custom_image_url && vehicle.focal_point_x == null;
          return (
            <>
              <img
                src={getVehicleImageUrl()}
                alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
                className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-500"
                style={{ objectPosition: `${focalX}% ${focalY}%` }}
                onError={handleImageError}
                loading="lazy"
              />
              {/* Signature photography treatment: radial vignette UNDER the
                  bottom scrim. The pairing is the ownable gesture — a photo
                  carrying only one of the two reads off-system. */}
              <div className="absolute inset-0 vignette-frame pointer-events-none" aria-hidden="true" />
              <div className="absolute inset-0 pointer-events-none" aria-hidden="true" style={{ background: 'linear-gradient(to top, rgba(9,11,15,0.92) 0%, rgba(9,11,15,0.45) 35%, rgba(9,11,15,0.10) 60%, transparent 100%)' }} />

              {showAdjustNudge && (
                <div className="absolute bottom-2 left-2 right-2 z-10 opacity-0 group-hover/image:opacity-100 transition-opacity duration-200">
                  <button
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowPhotoDialog(true); }}
                    className="w-full flex items-center gap-1.5 px-2.5 py-1.5 bg-black/70 hover:bg-black/85 border border-amber-400/35 rounded-lg text-amber-300/90 text-[11px] font-medium transition-all backdrop-blur-sm"
                  >
                    <Crosshair className="h-3 w-3 flex-shrink-0" />
                    Adjust Photo Focus for a better view
                  </button>
                </div>
              )}

              <div className={`absolute inset-0 bg-black/50 opacity-0 group-hover/image:opacity-100 transition-opacity duration-200 flex ${showAdjustNudge ? 'items-start pt-3' : 'items-center'} justify-center`}>
                <button
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowPhotoDialog(true); }}
                  className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-full text-white text-sm font-medium transition-all backdrop-blur-sm"
                  aria-label="Change vehicle photo"
                >
                  <Camera className="h-4 w-4" />
                  Change Photo
                </button>
              </div>
            </>
          );
        })()}

        <div className="absolute top-3 left-3 flex flex-wrap items-center gap-1.5">
          {activeRecalls > 0 && (
            <div className="flex items-center gap-1.5 bg-red-500/90 text-white px-2.5 py-1 rounded-full text-xs font-semibold shadow-lg backdrop-blur-sm">
              <AlertCircle className="h-3.5 w-3.5" />
              {activeRecalls} Recall{activeRecalls !== 1 ? 's' : ''}
            </div>
          )}
          <div className={`flex items-center gap-1.5 ${statusInfo.bg} ${statusInfo.border} border px-2.5 py-1 rounded-full text-xs font-semibold backdrop-blur-sm ${statusInfo.color}`}>
            <Tag className="h-3 w-3" />
            {statusInfo.label}
          </div>
          {healthPill && (
            <div className={`flex items-center gap-1.5 ${healthPill.bg} ${healthPill.border} border px-2.5 py-1 rounded-full text-xs font-semibold backdrop-blur-sm ${healthPill.text}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${healthPill.dot} flex-shrink-0`} />
              {healthPill.label}
            </div>
          )}
        </div>

        <div className="absolute top-3 right-3">
          <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <button
                  className="w-8 h-8 flex items-center justify-center bg-black/60 hover:bg-black/80 border border-white/15 rounded-full text-white/60 hover:text-white transition-all backdrop-blur-sm opacity-0 group-hover:opacity-100"
                  aria-label="Vehicle options"
                >
                  <MoreVertical className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-slate-950 border-white/15 text-white min-w-[160px]">
                <DropdownMenuItem
                  onClick={(e) => { e.stopPropagation(); setShowPhotoDialog(true); }}
                  className="text-white/80 hover:text-white focus:text-white hover:bg-white/8 focus:bg-white/8 cursor-pointer"
                >
                  <Camera className="h-4 w-4 mr-2 text-cyan-400" />
                  Change Photo
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={(e) => { e.stopPropagation(); setShowMileageDialog(true); }}
                  className="text-white/80 hover:text-white focus:text-white hover:bg-white/8 focus:bg-white/8 cursor-pointer"
                >
                  <Pencil className="h-4 w-4 mr-2 text-cyan-400" />
                  Update Mileage
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-white/10" />
                <AlertDialogTrigger asChild onClick={(e) => e.stopPropagation()}>
                  <DropdownMenuItem
                    className="text-red-400 hover:text-red-300 focus:text-red-300 hover:bg-red-500/10 focus:bg-red-500/10 cursor-pointer"
                    disabled={isDeleting}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete Vehicle
                  </DropdownMenuItem>
                </AlertDialogTrigger>
              </DropdownMenuContent>
            </DropdownMenu>

            <AlertDialogContent onClick={(e) => e.stopPropagation()} className="bg-slate-950 border-white/15">
              <AlertDialogHeader>
                <AlertDialogTitle className="text-white">Delete Vehicle</AlertDialogTitle>
                <AlertDialogDescription className="text-white/60">
                  Are you sure you want to remove {vehicle.year} {vehicle.make} {vehicle.model} from your garage?
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isDeleting} className="border-white/15 text-white/70 hover:text-white hover:bg-white/8">Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete} disabled={isDeleting} className="bg-red-600 hover:bg-red-500 text-white">
                  {isDeleting ? 'Deleting...' : 'Delete Vehicle'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <div className="p-5 flex-1 flex flex-col gap-4">
        <Link href={`/dashboard/${vehicle.id}`} className="block">
          <h3 className="text-xl font-bold text-white tracking-tight leading-tight">
            {vehicle.year} {vehicle.make}
          </h3>
          <p className="text-sm text-white/50 mt-0.5">{vehicle.model}{vehicle.trim ? ` · ${vehicle.trim}` : ''}</p>
        </Link>

        <MileageUpdatePrompt
          vehicle={displayVehicle}
          onUpdateClick={() => setShowMileageDialog(true)}
        />

        <div className="flex-1 space-y-3">
          {healthSummary && (
            <div className="flex items-center gap-3 p-3 bg-white/5 rounded-xl border border-white/8">
              <HealthRing score={healthSummary.health_score} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-white/50 uppercase tracking-widest mb-0.5">Health</p>
                <p className="text-xs text-white/60 line-clamp-2 leading-relaxed">{healthSummary.summary}</p>
              </div>
            </div>
          )}

          <div
            className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/8 hover:border-cyan-400/30 hover:bg-cyan-400/5 cursor-pointer transition-all group/mile"
            onClick={(e) => { e.preventDefault(); setShowMileageDialog(true); }}
          >
            <div>
              <p className="text-xs font-semibold text-white/50 uppercase tracking-widest mb-0.5">
                <span className="flex items-center gap-1">
                  <Gauge className="h-3 w-3" />
                  Mileage
                </span>
              </p>
              <span className="text-base font-bold text-white tabular-nums tracking-tight">
                {displayVehicle.current_mileage.toLocaleString()}
                <span className="text-xs text-white/40 font-normal ml-1">mi</span>
              </span>
            </div>
            <Pencil className="h-3.5 w-3.5 text-white/30 group-hover/mile:text-cyan-400 transition-colors" />
          </div>
        </div>

        <Button
          onClick={handleViewDashboard}
          className="w-full bg-cyan-600 hover:bg-cyan-500 text-white h-11 rounded-xl font-semibold text-sm border-0 glow-cyan-sm transition-all hover:scale-[1.01] active:scale-[0.99]"
        >
          View Dashboard
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>

      <Dialog open={showMileageDialog} onOpenChange={setShowMileageDialog}>
        <DialogContent className="bg-slate-950 border-white/15">
          <DialogHeader>
            <DialogTitle className="text-white">Update Mileage</DialogTitle>
            <DialogDescription className="text-white/60">
              Enter the current mileage for your {vehicle.year} {vehicle.make} {vehicle.model}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="mileage" className="text-white/80">Current Mileage (miles)</Label>
              <Input
                id="mileage"
                type="number"
                value={mileageInput}
                onChange={(e) => setMileageInput(e.target.value)}
                placeholder={vehicle.current_mileage.toString()}
                className="mt-2 bg-white/8 border-white/15 text-white"
              />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShowMileageDialog(false)} disabled={isUpdatingMileage} className="border-white/15 text-white/70 hover:text-white hover:bg-white/8">
                Cancel
              </Button>
              <Button onClick={handleUpdateMileage} disabled={isUpdatingMileage} className="flex-1 bg-cyan-600 hover:bg-cyan-500 text-white">
                {isUpdatingMileage ? 'Updating...' : 'Update Mileage'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <VehiclePhotoUploadDialog
        vehicleId={vehicle.id}
        vehicleName={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
        currentPhotoUrl={getVehicleImageUrl()}
        hasCustomPhoto={!!vehicle.custom_image_url}
        open={showPhotoDialog}
        onOpenChange={setShowPhotoDialog}
      />
    </div>
  );
}
