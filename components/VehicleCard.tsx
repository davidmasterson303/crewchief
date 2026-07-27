'use client';

import Link from 'next/link';
import { usageProfileChip } from '@crewchief/core/usage-profile';
import { useHealthBand } from '@/hooks/use-health-band';
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
  ShieldAlert,
  TriangleAlert,
} from 'lucide-react';
import { updateVehicleMileage } from '@/app/actions';
import { logger } from '@crewchief/core/logger';
import { isDemoVehicleId, DEMO_IMAGES } from '@crewchief/core/demo';
import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { invalidateDashboardCache } from '@crewchief/core/query-invalidation';
import { queryClient } from '@crewchief/core/query-client';
import { supabase } from '@/lib/supabase';
import { MileageUpdatePrompt } from './MileageUpdatePrompt';
import { VehiclePhotoUploadDialog } from './VehiclePhotoUploadDialog';

/**
 * A condition worth interrupting a browse for.
 *
 * Kept separate from `statusLabel`/usage profile on purpose. Both used to be a
 * glass chip at the same corner of the photo, so an active safety recall was
 * the same shape and position as a trim label and differed only in hue.
 * Conditions now get their own ribbon; the chip is identity only.
 */
export interface VehicleCardAlert {
  /** Short and countable — "2 recalls", "Service overdue". Never a sentence. */
  label: string;
  tone: 'critical' | 'attention';
}

interface VehicleCardProps {
  vehicle: any;
  activeRecalls: number;
  healthSummary?: any;
  /**
   * Optional override. When omitted, `activeRecalls` is promoted to a critical
   * alert, which is how all three current call sites behave — so none of them
   * had to change. Pass this to add conditions the card cannot derive.
   */
  alerts?: VehicleCardAlert[];
}


/*
 * The card's primary element.
 *
 * v7 moved this out of a filled well beside the summary text and onto the
 * card's right edge at 56px, top-aligned with the title. The score is the
 * reason the product exists; it was previously smaller than the mileage.
 *
 * 56px outer / 46px inner is the ticket's geometry: r + strokeWidth/2 must
 * equal 28 for the outer edge to land on 56, so r = 25.5 at a 5px stroke,
 * which puts the inner edge at 23 — a 46px hole. Do not adjust one without
 * the other.
 *
 * Reads the shared band table. This ring used to hand-roll its own three-band
 * ramp — green / brand cyan / orange at 80 and 60 — so the garage grid and
 * the dashboard disagreed about the same car: 30 was orange here and red in
 * the hero, and anything at or above 60 rendered in the brand accent, which
 * is precisely what the band system exists to stop.
 *
 * Deliberately still. No count-up, and — new in v7 — no low-score pulse
 * either. Both were single-card moments; three of them side by side in the
 * garage grid read as noise, and the band colour already carries severity.
 */
function HealthRing({ score }: { score: number }) {
  const radius = 25.5;
  const circumference = 2 * Math.PI * radius;
  const fill = (score / 100) * circumference;
  const band = useHealthBand(score);
  const color = band.color;
  const trackColor = `rgba(${band.rgb},0.10)`;

  return (
    <div className="flex flex-col items-center gap-1 flex-shrink-0">
      <div className="relative flex items-center justify-center w-14 h-14">
        <svg width="56" height="56" viewBox="0 0 56 56" className="-rotate-90">
          <circle cx="28" cy="28" r={radius} fill="none" stroke={trackColor} strokeWidth="5" />
          <circle
            cx="28" cy="28" r={radius}
            fill="none"
            stroke={color}
            strokeWidth="5"
            strokeDasharray={`${fill} ${circumference}`}
            strokeLinecap="round"
            style={{ filter: `drop-shadow(0 0 4px ${color}50)` }}
          />
        </svg>
        <span className="num absolute text-lg font-bold text-white">{score}</span>
      </div>
      {/* `short`, not `label` — "Needs attention" does not fit under 56px in a
          three-up grid. Same band, abbreviated; never a different judgement. */}
      <span className="text-[11px] font-semibold leading-none" style={{ color }}>
        {band.short}
      </span>
    </div>
  );
}

export function VehicleCard({ vehicle, activeRecalls, healthSummary, alerts }: VehicleCardProps) {
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

  /*
   * Returns undefined when this vehicle genuinely has no usable photo, and the
   * card renders no strip at all.
   *
   * There used to be a hardcoded images.unsplash.com stock car here, used both
   * as the empty state and as the onError target. That meant three things at
   * once: no vehicle could ever *be* photo-less, every photo-less garage made a
   * third-party CDN request on load, and a broken image silently substituted a
   * stranger's car for the owner's. A card that is complete without a photo is
   * better than a card that is never allowed to lack one.
   *
   * The DEMO_IMAGES override stays until migration 20260726230000 has been
   * applied everywhere. Deleting it before then would send the demo cards back
   * to the Pexels CDN this map was introduced to get them off — the database
   * still holds those URLs. Delete both together, not this one first.
   */
  const getVehicleImageUrl = (): string | undefined => {
    if (imageError) return undefined;
    if (isDemoVehicleId(vehicle.id) && DEMO_IMAGES[vehicle.id]) {
      return DEMO_IMAGES[vehicle.id];
    }
    return vehicle.custom_image_url || vehicle.image_url || undefined;
  };

  const handleImageError = () => {
    logger.error('VEHICLE_CARD:IMAGE_LOAD', new Error('Image failed to load'));
    setImageError(true);
  };

  if (isDeleted) return null;

  const statusKey = displayVehicle.vehicle_status || 'daily_driver';
  const statusInfo = usageProfileChip(statusKey);

  const photoUrl = getVehicleImageUrl();

  /*
   * The band pill that used to sit in this chip row is gone.
   *
   * It printed `band.label` beside the recall badge and the usage chip, while
   * the ring printed the same score a few centimetres below — the dashboard's
   * D5 defect ("the score prints twice"), on the garage surface, which the v7
   * ticket did not mention because it described the score as only a small
   * footer run. With the ring promoted to the card's primary element, a second
   * rendering of the same number is exactly the noise v7 exists to remove.
   */

  /*
   * `activeRecalls` is a count, so the label is derivable — no call site had to
   * change. An explicit `alerts` prop wins when passed.
   */
  const resolvedAlerts: VehicleCardAlert[] =
    alerts ??
    (activeRecalls > 0
      ? [{ label: `${activeRecalls} recall${activeRecalls !== 1 ? 's' : ''}`, tone: 'critical' }]
      : []);

  /* Any critical entry makes the whole ribbon critical — a scan must not have
   * to read the row to find out whether the red one is in there. */
  const ribbonCritical = resolvedAlerts.some((a) => a.tone === 'critical');
  const RibbonIcon = ribbonCritical ? ShieldAlert : TriangleAlert;

  /* Identity, never condition. Neutral for all four profiles by design — see
   * lib/usage-profile.ts. Rendered over the strip when there is one, and in
   * the body when there is not, so a photo-less card still says what the car
   * is for. */
  const nicknameChip = (
    <div className={`flex items-center gap-1.5 ${statusInfo.className} border px-2.5 py-1 rounded-full text-xs font-semibold backdrop-blur-sm`}>
      <Tag className="h-3 w-3" />
      {statusInfo.label}
    </div>
  );

  return (
    <div className="group card-lift relative border rounded-2xl overflow-hidden bg-[#0f1318]/90 backdrop-blur-sm h-full flex flex-col shadow-lg shadow-black/50 edge-light hover:border-cyan-400/30">
      {/*
        96px, down from a 3:2 plate that was ~158px tall.
        Identity only — enough to tell three cars apart at a glance, not a
        feature. And it renders only when there is a photograph: no empty
        plate, no placeholder icon, no stock car. See getVehicleImageUrl.
      */}
      {photoUrl && (
        <div className="photo-plate h-24 bg-slate-900/60 group/image">
          {(() => {
            const focalX = vehicle.focal_point_x ?? 50;
            const focalY = vehicle.focal_point_y ?? 50;
            const showAdjustNudge = vehicle.custom_image_url && vehicle.focal_point_x == null;
            return (
              <>
                <img
                  src={photoUrl}
                  alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
                  className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-500"
                  style={{ objectPosition: `${focalX}% ${focalY}%` }}
                  onError={handleImageError}
                  loading="lazy"
                />

                {/* Compact at 96px. The full-width bar this replaced covered
                    most of a strip this short. */}
                {showAdjustNudge && (
                  <div className="above-stretch absolute bottom-2 left-2 opacity-0 group-hover/image:opacity-100 transition-opacity duration-200">
                    <button
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowPhotoDialog(true); }}
                      className="tap-target-44 flex items-center gap-1.5 px-2 py-1 bg-black/70 hover:bg-black/85 border border-amber-400/35 rounded-md text-amber-300/90 text-[11px] font-medium transition-all backdrop-blur-sm"
                    >
                      <Crosshair className="h-3 w-3 flex-shrink-0" />
                      Adjust focus
                    </button>
                  </div>
                )}

                <div className="above-stretch absolute inset-0 bg-black/50 opacity-0 group-hover/image:opacity-100 transition-opacity duration-200 flex items-center justify-center">
                  <button
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowPhotoDialog(true); }}
                    className="flex items-center gap-2 px-3 py-1.5 bg-white/10 hover:bg-white/20 border border-white/20 rounded-full text-white text-xs font-medium transition-all backdrop-blur-sm"
                    aria-label="Change vehicle photo"
                  >
                    <Camera className="h-3.5 w-3.5" />
                    Change Photo
                  </button>
                </div>
              </>
            );
          })()}

          <div className="absolute top-2 left-2">{nicknameChip}</div>
        </div>
      )}

      {/*
        Conditions, in their own slot. Full-bleed so it reads as a property of
        the card rather than another chip floating on the photo. One line,
        joined with ' · ' — never stacked, never wrapped; past two entries the
        caller summarises ("3 issues").
      */}
      {resolvedAlerts.length > 0 && (
        <div
          className="flex items-center gap-1.5 px-4 py-[7px] text-xs font-semibold border-y"
          style={
            ribbonCritical
              ? {
                  color: 'var(--critical-red)',
                  background: 'var(--critical-red-wash)',
                  borderColor: 'var(--critical-red-border)',
                }
              : {
                  color: 'var(--attention-amber)',
                  background: 'var(--attention-amber-wash)',
                  borderColor: 'var(--attention-amber-border)',
                }
          }
        >
          <RibbonIcon className="h-3.5 w-3.5 flex-shrink-0" />
          <span className="truncate">{resolvedAlerts.map((a) => a.label).join(' · ')}</span>
        </div>
      )}

      <div className="p-5 flex-1 flex flex-col gap-4">
        {/* Reading order starts here: score, name, condition, detail. */}
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <h3 className="text-xl font-bold text-white tracking-tight leading-tight">
              {vehicle.year} {vehicle.make}
            </h3>
            <p className="text-sm text-white/50 mt-0.5">{vehicle.model}{vehicle.trim ? ` · ${vehicle.trim}` : ''}</p>

            {/* With no strip the chip has nowhere to sit, and the card would
                stop saying what the car is for. */}
            {!photoUrl && <div className="mt-2 flex">{nicknameChip}</div>}

            {/*
              Mileage as a meta line, replacing a filled bordered well with its
              own hover state. It was the largest thing on the card, which said
              the most important fact about a vehicle is how far it has driven.
              No fill, no border, no nesting.
            */}
            <div className="meta-row above-stretch relative mt-3 flex items-center gap-1.5">
              <Gauge className="h-3 w-3 text-white/40 flex-shrink-0" />
              <span className="text-[13px] text-secondary-foreground">
                <span className="num font-semibold">{displayVehicle.current_mileage.toLocaleString()}</span>
                <span className="text-muted-foreground font-normal"> mi mileage</span>
              </span>
              <button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowMileageDialog(true); }}
                className="meta-edit tap-target-44 text-white/40 hover:text-cyan-400 transition-colors"
                aria-label={`Update mileage for ${vehicle.year} ${vehicle.make} ${vehicle.model}`}
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {healthSummary && <HealthRing score={healthSummary.health_score} />}

          {/*
            The options menu used to live inside the photo plate. With the strip
            now conditional, that put delete, change-photo and update-mileage
            behind having a photograph — so the vehicle most likely to need
            "Change Photo" was the one that could not reach it. It is a flex
            child of the header row instead, which exists unconditionally.
          */}
          <div className="above-stretch relative flex-shrink-0">
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

        {/*
          The health summary used to be boxed in a well beside the ring. The
          ring has moved to the header, and this is prose — so it is unboxed,
          and capped at a readable measure rather than run to the card's width.
        */}
        {healthSummary?.summary && (
          <p className="measure text-xs text-white/60 leading-relaxed line-clamp-2">
            {healthSummary.summary}
          </p>
        )}

        <div className="above-stretch relative">
        <MileageUpdatePrompt
          vehicle={displayVehicle}
          onUpdateClick={() => setShowMileageDialog(true)}
        />
        </div>

        {/* mt-auto, so CTAs align across a row of unequal-height cards. The
            grid must stay align-items: stretch for this to hold. */}
        <Link
          href={`/dashboard/${vehicle.id}`}
          className="stretch-link group/cta mt-auto flex items-center justify-center gap-1.5 w-full h-11 rounded-xl text-sm font-semibold text-info hover:text-info-strong transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
        >
          View Dashboard
          <ArrowRight className="h-4 w-4 transition-transform group-hover/cta:translate-x-0.5" />
        </Link>
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
