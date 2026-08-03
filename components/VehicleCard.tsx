'use client';

import Link from 'next/link';
import { usageProfileChip } from '@crewchief/core/usage-profile';
import { useVehicleImage } from '@/hooks/useSignedUrl';
import { VehicleIdentity } from '@/components/VehicleIdentity';
import { ClusterGauge } from '@/components/ClusterGauge';
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
  ShieldAlert,
  TriangleAlert,
} from 'lucide-react';
import { deleteVehicle, updateVehicleMileage } from '@/app/actions';
import { logger } from '@crewchief/core/logger';
import { isDemoVehicleId } from '@crewchief/core/demo';
import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { invalidateDashboardCache } from '@crewchief/core/query-invalidation';
import { queryClient } from '@crewchief/core/query-client';
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
  /*
   * The garage grid adopts the same instrument as the dashboard hero — the
   * ticked 270° dial, at the 56px slot this card has always used. Roadmap
   * item 7 sequences it this way: hero first, card after, so the two surfaces
   * stop describing one score with two different shapes.
   *
   * `variant="card"` is what survives the size rather than a second design.
   * Minors every 5 would be sub-pixel here and six numbers illegible, so it
   * keeps the arc, the three band boundaries, a marker, and the reading in the
   * well. It also stays still: no count-up, no pulse — both were single-card
   * moments, and three of them side by side in this grid read as noise while
   * the band colour already carries severity.
   */
  return <ClusterGauge score={score} variant="card" size={56} />;
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

  useEffect(() => {
    setDisplayVehicle(vehicle);
    setMileageInput(vehicle.current_mileage.toString());
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
      const result = await deleteVehicle(vehicle.id);
      if (result.success) {
        setDeleteDialogOpen(false);
        setIsDeleted(true);
        /*
          Prefix invalidation, not setQueryData. The garage queries are keyed
          ['vehicles','mine',userId] and ['vehicles','demo'] since useVehicles
          was split; setQueryData matches keys *exactly*, so the previous
          ['vehicles'] write had been silently hitting nothing. The card is
          already out of the DOM via isDeleted — this is what makes the
          underlying list agree on the next read.
        */
        queryClient.invalidateQueries({ queryKey: ['vehicles'] });
        toast.success(`${vehicle.year} ${vehicle.make} ${vehicle.model} removed from garage`);
      } else {
        setIsDeleting(false);
        toast.error(result.error || 'Failed to delete vehicle');
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
   *
   * The owner-photo half is resolved by `useVehicleImage`: the column holds a
   * storage path against a private bucket, so it has to be signed before it
   * can go in an `<img>`. That returns undefined while the exchange is in
   * flight, which is why the demo override is checked first — it needs no
   * signing and must not wait on one.
   */
  const resolvedImageUrl = useVehicleImage(vehicle);

  /*
    One source of truth now: whatever `useVehicleImage` resolves from the row.

    The demo override that used to sit here is gone — see the note in
    `packages/core/src/demo.ts`. The database was verified to hold local hero
    paths before it was removed, and `VehicleIdentity` derives the card-sized
    derivative from that path itself, so dropping the map does not put
    page-width heroes back in the grid.

    The deliberately-unphotographed demo car still needs no special case:
    `useVehicleImage` returns undefined for it, which lives in the hook because
    all five screens that show a vehicle photo have to agree.
  */

  if (isDeleted) return null;

  const statusKey = displayVehicle.vehicle_status || 'daily_driver';
  const statusInfo = usageProfileChip(statusKey);

  const photoUrl = resolvedImageUrl;

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
        The 3:2 identity plate, and it renders unconditionally — CC-142 §2.

        ── This supersedes a v7 decision, deliberately ───────────────────────
        v7 shrank this to a 96px strip that appeared *only* when a photograph
        existed, on the reasoning that "a card that is complete without a photo
        is better than a card that is never allowed to lack one." That reasoning
        was sound, and its premise was that the no-photo state looked broken —
        an empty plate, a placeholder icon, or a stock car.

        CC-142 removes the premise. The no-photo state is now a deterministic
        make-derived field with the vehicle named on it, which is a finished
        design rather than an absence, so it earns the space v7 correctly denied
        it. Restoring the plate without `VehicleIdentity` would reinstate the
        bug v7 was avoiding — the two changes only make sense together.

        The focal-point crop is gone with the `cover` fit that needed it: the
        plate contains the photo rather than cropping it, so there is no crop to
        anchor. `focal_point_x/y` still exist and are still edited in
        VehiclePhotoUploadDialog; nothing reads them here any more.
      */}
      <div className="relative group/image">
        <VehicleIdentity
          variant="card"
          photo={photoUrl ?? null}
          year={vehicle.year}
          make={vehicle.make}
          model={vehicle.model}
          trim={vehicle.trim}
        />

        <div className="above-stretch absolute inset-0 bg-black/50 reveal-on-hover flex items-center justify-center">
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowPhotoDialog(true); }}
            className="tap-target-44 flex items-center gap-2 px-3 py-1.5 bg-white/10 hover:bg-white/20 border border-white/20 rounded-full text-white text-xs font-medium transition-all backdrop-blur-sm"
            aria-label={photoUrl ? 'Change vehicle photo' : 'Add a photo of this car'}
          >
            <Camera className="h-3.5 w-3.5" />
            {photoUrl ? 'Change Photo' : 'Add Photo'}
          </button>
        </div>

        <div className="absolute top-2 left-2">{nicknameChip}</div>
      </div>

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

            {/*
              The chip used to be repeated here when there was no photograph,
              on the reasoning that "with no strip the chip has nowhere to sit".
              That premise expired with CC-142: the plate above is rendered
              whether or not a photo exists, and it carries the chip at
              top-left unconditionally — so this printed "Daily Driver" twice on
              any car without a photograph.

              Nothing caught it because nothing ever rendered that state.
              VehicleIdentity's docblock predicted exactly this ("the first real
              user vehicle would have found it"); putting one demo car in the
              unphotographed state found it instead.
            */}

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
                className="meta-edit tap-target-44 text-white/50 hover:text-cyan-400 transition-colors"
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
                  className="tap-target-44 w-8 h-8 flex items-center justify-center bg-black/60 hover:bg-black/80 border border-white/15 rounded-full text-white/60 hover:text-white transition-all backdrop-blur-sm reveal-on-hover"
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
                className="mt-2"
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
        currentPhotoUrl={photoUrl}
        hasCustomPhoto={!!vehicle.custom_image_url}
        open={showPhotoDialog}
        onOpenChange={setShowPhotoDialog}
      />
    </div>
  );
}
