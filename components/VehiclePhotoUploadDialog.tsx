'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Upload, X, Loader as Loader2, Move } from 'lucide-react';
import { toast } from 'sonner';
import { uploadVehiclePhoto, removeVehiclePhoto } from '@/app/actions';
import { downscaleImage } from '@/lib/image-downscale';
import { useRouter } from 'next/navigation';
import { queryClient } from '@wellkept/core/query-client';

/**
 * `router.refresh()` alone was not enough, and the reason is worth stating.
 *
 * It re-renders server components. The garage does not come from one — it
 * comes from `useMyVehicles`, a TanStack Query cache with a five-minute
 * staleTime that `router.refresh()` never touches. So an uploaded photo did
 * not appear until a full page reload, which reads as the upload having
 * failed. Reported 30 Jul, alongside two siblings: a newly created vehicle
 * missing from the garage, and VehicleCard's dead `setQueryData(['vehicles'])`.
 *
 * Three instances of one bug — a mutation that changes the garage without
 * telling the cache. Both refreshes are needed: the server one for anything
 * rendered server-side, the invalidation for the list the user is looking at.
 */
function refreshVehicleViews(router: { refresh: () => void }) {
  queryClient.invalidateQueries({ queryKey: ['vehicles'] });
  router.refresh();
}

interface VehiclePhotoUploadDialogProps {
  vehicleId: string;
  vehicleName: string;
  currentPhotoUrl?: string;
  hasCustomPhoto: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type ModalStep = 'select' | 'focal';

interface ImageNaturalSize {
  w: number;
  h: number;
}

export function VehiclePhotoUploadDialog({
  vehicleId,
  vehicleName,
  currentPhotoUrl,
  hasCustomPhoto,
  open,
  onOpenChange,
}: VehiclePhotoUploadDialogProps) {
  const router = useRouter();
  const [step, setStep] = useState<ModalStep>('select');
  const [isUploading, setIsUploading] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDraggingDrop, setIsDraggingDrop] = useState(false);

  const [focalX, setFocalX] = useState(50);
  const [focalY, setFocalY] = useState(50);

  const [isPanning, setIsPanning] = useState(false);
  const [showGrid, setShowGrid] = useState(false);

  const [naturalSize, setNaturalSize] = useState<ImageNaturalSize>({ w: 1, h: 1 });

  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const focalStartRef = useRef<{ x: number; y: number }>({ x: 50, y: 50 });

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (file: File) => {
    if (!file.type.match(/^image\/(jpeg|png|jpg|webp)$/)) {
      toast.error('Please select a valid image file (JPEG, PNG, or WEBP)');
      return;
    }
    /*
      A sanity ceiling, not a size limit. This used to be 5 MB, which rejects an
      ordinary photo from a recent phone — the user was told their picture was
      too big and given nothing to do about it. Uploads are now downscaled to
      1600px before they leave the browser (see handleUpload), so the only thing
      still worth refusing is a file large enough to be a mistake or a decode
      bomb.
    */
    if (file.size > 40 * 1024 * 1024) {
      toast.error('That image is unusually large — please choose a photo under 40MB');
      return;
    }
    setSelectedFile(file);
    const reader = new FileReader();
    reader.onload = (e) => {
      const url = e.target?.result as string;
      setPreviewUrl(url);
      setFocalX(50);
      setFocalY(50);

      const img = new Image();
      img.onload = () => setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
      img.src = url;

      setStep('focal');
    };
    reader.readAsDataURL(file);
  };

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    pointerStartRef.current = { x: e.clientX, y: e.clientY };
    focalStartRef.current = { x: focalX, y: focalY };
    setIsPanning(true);
    setShowGrid(true);
  }, [focalX, focalY]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isPanning || !pointerStartRef.current || !containerRef.current) return;

    const containerW = containerRef.current.offsetWidth;
    const containerH = containerRef.current.offsetHeight;

    const imageAspect = naturalSize.w / naturalSize.h;
    const containerAspect = containerW / containerH;

    let visibleW: number;
    let visibleH: number;
    if (imageAspect > containerAspect) {
      visibleH = containerH;
      visibleW = containerH * imageAspect;
    } else {
      visibleW = containerW;
      visibleH = containerW / imageAspect;
    }

    const dragRangeX = Math.max(0, visibleW - containerW);
    const dragRangeY = Math.max(0, visibleH - containerH);

    const dx = e.clientX - pointerStartRef.current.x;
    const dy = e.clientY - pointerStartRef.current.y;

    const deltaX = dragRangeX > 0 ? -(dx / dragRangeX) * 100 : 0;
    const deltaY = dragRangeY > 0 ? -(dy / dragRangeY) * 100 : 0;

    const newX = Math.min(100, Math.max(0, focalStartRef.current.x + deltaX));
    const newY = Math.min(100, Math.max(0, focalStartRef.current.y + deltaY));

    setFocalX(Math.round(newX * 10) / 10);
    setFocalY(Math.round(newY * 10) / 10);
  }, [isPanning, naturalSize]);

  const onPointerUp = useCallback(() => {
    setIsPanning(false);
    pointerStartRef.current = null;
    setTimeout(() => setShowGrid(false), 600);
  }, []);

  useEffect(() => {
    if (!isPanning) return;
    const handleUp = () => onPointerUp();
    window.addEventListener('pointerup', handleUp);
    return () => window.removeEventListener('pointerup', handleUp);
  }, [isPanning, onPointerUp]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingDrop(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    setIsUploading(true);

    /*
      Downscale here rather than at selection, for two reasons: a user who
      picks a photo and then cancels should not have paid for an encode, and
      the focal-point preview above stays on the full-resolution image.

      This never throws and never rejects — on any failure it hands back the
      original file, so the worst case is the upload we would have done anyway.
    */
    const fileToUpload = await downscaleImage(selectedFile);

    const formData = new FormData();
    formData.append('file', fileToUpload);
    formData.append('vehicleId', vehicleId);
    formData.append('focalX', String(focalX));
    formData.append('focalY', String(focalY));

    const result = await uploadVehiclePhoto(formData);

    if (result.success) {
      toast.success('Photo uploaded successfully');
      setSelectedFile(null);
      setPreviewUrl(null);
      setStep('select');
      onOpenChange(false);
      refreshVehicleViews(router);
    } else {
      toast.error(result.error || 'Failed to upload photo');
    }
    setIsUploading(false);
  };

  const handleRemovePhoto = async () => {
    setIsRemoving(true);
    const result = await removeVehiclePhoto(vehicleId);
    if (result.success) {
      toast.success('Custom photo removed');
      onOpenChange(false);
      refreshVehicleViews(router);
    } else {
      toast.error(result.error || 'Failed to remove photo');
    }
    setIsRemoving(false);
  };

  const handleClose = () => {
    setSelectedFile(null);
    setPreviewUrl(null);
    setStep('select');
    setIsPanning(false);
    setShowGrid(false);
    onOpenChange(false);
  };

  const containerHeightPx = 420;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-xl bg-[#111114] border-white/10 text-white">
        <DialogHeader>
          <DialogTitle className="text-white">
            {step === 'focal'
              ? 'Frame Your Vehicle'
              : hasCustomPhoto
              ? 'Change Vehicle Photo'
              : 'Upload Vehicle Photo'}
          </DialogTitle>
          <DialogDescription className="text-white/50">
            {step === 'focal'
              ? 'Drag the image to position your car in the banner frame.'
              : `Add a personal photo of your ${vehicleName} for better customization.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {step === 'select' ? (
            <>
              <div
                className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer ${
                  isDraggingDrop
                    ? 'border-cyan-400 bg-cyan-400/10'
                    : 'border-white/15 hover:border-cyan-400/50 hover:bg-white/[0.04]'
                }`}
                onDrop={handleDrop}
                onDragOver={(e) => { e.preventDefault(); setIsDraggingDrop(true); }}
                onDragLeave={() => setIsDraggingDrop(false)}
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="flex flex-col items-center gap-3">
                  <div className="h-12 w-12 bg-info-wash rounded-full flex items-center justify-center border border-info-border">
                    <Upload className="h-5 w-5 text-cyan-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">Drag and drop your photo here</p>
                    <p className="text-xs text-white/50 mt-1">or click to browse</p>
                  </div>
                  <p className="text-xs text-white/50">JPEG, PNG, WEBP — max 5MB</p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/jpg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileSelect(file);
                  }}
                />
              </div>

              {hasCustomPhoto && (
                <div className="pt-3 border-t border-white/8">
                  <p className="text-xs text-white/50 mb-3">Remove your custom photo and revert to stock image</p>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleRemovePhoto}
                    disabled={isRemoving}
                    className="w-full bg-red-500/15 hover:bg-red-500/25 text-red-400 border border-red-500/25"
                  >
                    {isRemoving ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Removing...</>
                    ) : (
                      <><X className="h-4 w-4 mr-2" />Remove Custom Photo</>
                    )}
                  </Button>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-info-wash border border-info-border">
                <Move className="h-3.5 w-3.5 text-info flex-shrink-0" />
                <p className="text-xs text-info/80">
                  Drag the image to position your car inside the banner frame.
                </p>
              </div>

              <div
                ref={containerRef}
                className="relative w-full overflow-hidden rounded-xl select-none border border-white/10"
                style={{
                  height: `${containerHeightPx}px`,
                  cursor: isPanning ? 'grabbing' : 'grab',
                  touchAction: 'none',
                }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
              >
                {previewUrl && (
                  <img
                    ref={imgRef}
                    src={previewUrl}
                    alt="Preview"
                    draggable={false}
                    className="absolute inset-0 w-full h-full object-cover pointer-events-none select-none"
                    style={{ objectPosition: `${focalX}% ${focalY}%` }}
                  />
                )}

                <div
                  className="absolute inset-0 pointer-events-none transition-opacity duration-500"
                  style={{ opacity: showGrid ? 1 : 0 }}
                >
                  <div className="absolute inset-0" style={{
                    backgroundImage: `
                      linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px),
                      linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)
                    `,
                    backgroundSize: `33.333% 33.333%`,
                  }} />
                  <div
                    className="absolute border border-white/20"
                    style={{
                      left: '33.333%',
                      right: '33.333%',
                      top: '33.333%',
                      bottom: '33.333%',
                    }}
                  />
                  <div className="absolute inset-0" style={{
                    backgroundImage: `
                      linear-gradient(rgba(34,211,238,0.15) 1px, transparent 1px),
                      linear-gradient(90deg, rgba(34,211,238,0.15) 1px, transparent 1px)
                    `,
                    backgroundSize: `33.333% 33.333%`,
                    backgroundPosition: '0 0',
                    maskImage: 'linear-gradient(to bottom, transparent 32%, rgba(0,0,0,0.7) 33%, rgba(0,0,0,0.7) 67%, transparent 68%), linear-gradient(to right, transparent 32%, rgba(0,0,0,0.7) 33%, rgba(0,0,0,0.7) 67%, transparent 68%)',
                  }} />
                </div>

                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    background: `
                      linear-gradient(to right, rgba(0,0,0,0.25) 0%, transparent 8%, transparent 92%, rgba(0,0,0,0.25) 100%),
                      linear-gradient(to bottom, rgba(0,0,0,0.15) 0%, transparent 6%, transparent 94%, rgba(0,0,0,0.15) 100%)
                    `,
                  }}
                />

                <div className="absolute top-2 right-2 flex items-center gap-1.5 bg-black/65 backdrop-blur-sm rounded-lg px-2 py-1 border border-white/10 pointer-events-none">
                  <Move className="h-3 w-3 text-info" />
                  <span className="text-xs font-mono text-white/55">
                    {focalX.toFixed(0)}% {focalY.toFixed(0)}%
                  </span>
                </div>

                {!isPanning && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    {/*
                      The container's `opacity-70` is gone for the same reason
                      as ModificationsTab's: it multiplied. `text-white/60`
                      inside it composited to an effective 0.42 alpha, on an
                      instruction sitting over a photograph — the one place the
                      backdrop is least predictable and legibility matters most.

                      The pill's own `bg-black/50` is what makes this readable
                      over an arbitrary image; that is doing the work, and the
                      extra fade was undoing it. Expressed as colour instead, so
                      the contrast guard can measure it.
                    */}
                    <div className="flex items-center gap-1.5 bg-black/50 backdrop-blur-sm rounded-full px-3 py-1.5 border border-white/15">
                      <Move className="h-3.5 w-3.5 text-white/80" />
                      <span className="text-xs text-white/80 font-medium">Drag to reposition</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <p className="text-xs text-white/50 font-medium uppercase tracking-wider">Banner preview</p>
                <div
                  className="w-full overflow-hidden rounded-lg border border-white/10"
                  style={{ height: '56px' }}
                >
                  {previewUrl && (
                    <img
                      src={previewUrl}
                      alt=""
                      className="w-full h-full object-cover pointer-events-none"
                      style={{ objectPosition: `${focalX}% ${focalY}%` }}
                    />
                  )}
                </div>
                <p className="text-xs text-white/50">This is the exact crop shown in the dashboard hero banner.</p>
              </div>

              <div className="flex gap-2 pt-1">
                <Button
                  variant="outline"
                  onClick={() => setStep('select')}
                  disabled={isUploading}
                  className="flex-1 bg-white/5 border-white/12 text-white/60 hover:bg-white/10 hover:text-white"
                >
                  Change Photo
                </Button>
                <Button
                  onClick={handleUpload}
                  disabled={isUploading}
                  className="flex-1 bg-cyan-500 hover:bg-cyan-400 text-black font-semibold"
                >
                  {isUploading ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Uploading...</>
                  ) : (
                    <><Upload className="h-4 w-4 mr-2" />Save Photo</>
                  )}
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
