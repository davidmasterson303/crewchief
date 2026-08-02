'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Upload, FileText, Camera, X, TriangleAlert as AlertTriangle, Image as ImageIcon } from 'lucide-react';
import { toast } from 'sonner';
import InvoiceProcessingLoader from './InvoiceProcessingLoader';
import { invalidateDashboardCache } from '@crewchief/core/query-invalidation';
import { generateVehicleHealthSummary } from '@/app/actions';
import { downscaleImage } from '@/lib/image-downscale';
import { DOC_MAX_EDGE, DOC_TARGET_BYTES, isDownscalableImage } from '@crewchief/core/image-resize';

interface DocumentUploadDialogProps {
  vehicleId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploadComplete?: () => void;
}

export default function DocumentUploadDialog({ vehicleId, open, onOpenChange, onUploadComplete }: DocumentUploadDialogProps) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [showVehicleMismatchDialog, setShowVehicleMismatchDialog] = useState(false);
  const [vehicleMismatchData, setVehicleMismatchData] = useState<{extractedVehicle: string, expectedVehicle: string} | null>(null);
  const [currentFileForMismatch, setCurrentFileForMismatch] = useState<File | null>(null);
  const [remainingFiles, setRemainingFiles] = useState<File[]>([]);
  const [currentProcessingFile, setCurrentProcessingFile] = useState<string>('');
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);

  /**
   * Reduce a photographed invoice before it goes to the extractor.
   *
   * A phone camera hands us 4032x3024 and 2-3 MB, and every one of those pixels
   * is billed on the way into the vision model. The dimensions the model needs
   * are set by the smallest text on the page, not by the sensor.
   *
   * Document bounds, not the photo ones — see `DOC_MAX_EDGE`. PDFs and anything
   * else non-raster pass through untouched.
   *
   * It never fails the upload. `downscaleImage` returns the original on every
   * error path, and the `catch` here covers the rest: a large invoice that
   * reaches the extractor costs money, and one that does not reach it at all
   * costs the feature.
   */
  const prepareForUpload = async (file: File): Promise<File> => {
    if (!isDownscalableImage(file.type)) return file;
    try {
      return await downscaleImage(file, {
        maxEdge: DOC_MAX_EDGE,
        targetBytes: DOC_TARGET_BYTES,
      });
    } catch {
      return file;
    }
  };

  const validateAndAddFiles = (files: File[]) => {
    const validFiles = files.filter(file => {
      if (file.size > 10 * 1024 * 1024) {
        setError('File size must be less than 10MB');
        return false;
      }
      return true;
    });

    if (validFiles.length > 0) {
      setSelectedFiles(prev => [...prev, ...validFiles]);
      setError('');
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    validateAndAddFiles(files);
    e.target.value = '';
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current++;
    if (dragCounterRef.current === 1) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    validateAndAddFiles(files);
  };

  const removeFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleUpload = async (bypassVehicleCheck: boolean = false) => {
    if (selectedFiles.length === 0) return;

    setUploading(true);
    setError('');

    try {
      let totalItemsExtracted = 0;
      let successCount = 0;

      for (let i = 0; i < selectedFiles.length; i++) {
        // The name the user recognises stays the original's throughout — the
        // reduced copy carries the encoder's extension, and telling someone
        // their `invoice.jpg` failed as `invoice.webp` is a small lie in the
        // one message they are reading closely.
        const original = selectedFiles[i];
        setCurrentProcessingFile(original.name);

        const file = await prepareForUpload(original);
        const formData = new FormData();
        formData.append('file', file);
        formData.append('vehicleId', vehicleId);
        if (bypassVehicleCheck) {
          formData.append('bypassVehicleCheck', 'true');
        }

        const response = await fetch('/api/v1/upload-document', {
          method: 'POST',
          body: formData,
        });

        const result = await response.json();
        if (!result.success) {
          if (result.error === 'NOT_AUTOMOTIVE_INVOICE') {
            setError(result.message || 'This document does not appear to be an automotive service invoice.');
            toast.error(`${original.name}: Not an automotive invoice`);
            setUploading(false);
            return;
          }

          if (result.error === 'VEHICLE_MISMATCH') {
            setVehicleMismatchData({
              extractedVehicle: result.extractedVehicle || 'Unknown vehicle',
              expectedVehicle: result.expectedVehicle || 'Unknown vehicle'
            });
            // The prepared copy, not the original — "Continue anyway" re-uploads
            // this, and it should not pay the reduction twice or send the full
            // 3 MB on the retry path specifically.
            setCurrentFileForMismatch(file);
            setRemainingFiles(selectedFiles.slice(i + 1));
            setShowVehicleMismatchDialog(true);
            setUploading(false);
            return;
          }

          setError(result.error || result.message || 'Upload failed');
          toast.error(`Failed to process ${original.name}: ${result.error || result.message}`);
          setUploading(false);
          return;
        }

        successCount++;
        if (result.itemsExtracted) {
          totalItemsExtracted += result.itemsExtracted;
        }
      }

      setSelectedFiles([]);
      setError('');
      setCurrentProcessingFile('');
      onOpenChange(false);

      if (successCount > 0) {
        if (totalItemsExtracted > 0) {
          toast.success(`Processed ${successCount} invoice${successCount !== 1 ? 's' : ''}, extracted ${totalItemsExtracted} line item${totalItemsExtracted !== 1 ? 's' : ''}`);
        } else {
          toast.success(`Uploaded ${successCount} document${successCount !== 1 ? 's' : ''} successfully`);
        }
      }

      if (onUploadComplete) {
        onUploadComplete();
      }

      invalidateDashboardCache(vehicleId);

      if (totalItemsExtracted > 0) {
        fetch('/api/v1/performance-stats', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vehicleId, forceRefresh: true }),
        }).catch(() => {});
      }

      generateVehicleHealthSummary(vehicleId, true).then(() => {
        invalidateDashboardCache(vehicleId);
        router.refresh();
      });

      router.refresh();
    } catch (err) {
      setError('An error occurred during upload');
      toast.error('Upload failed');
    } finally {
      setUploading(false);
      setCurrentProcessingFile('');
    }
  };

  const handleClose = () => {
    if (!uploading) {
      setSelectedFiles([]);
      setError('');
      setCurrentProcessingFile('');
      onOpenChange(false);
    }
  };

  const handleContinueAnyway = async () => {
    if (!currentFileForMismatch) return;

    setShowVehicleMismatchDialog(false);
    setVehicleMismatchData(null);
    setUploading(true);

    try {
      const formData = new FormData();
      formData.append('file', currentFileForMismatch);
      formData.append('vehicleId', vehicleId);
      formData.append('bypassVehicleCheck', 'true');

      const response = await fetch('/api/v1/upload-document', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();
      if (!result.success) {
        setError(result.error || 'Upload failed');
        toast.error(`Failed to process ${currentFileForMismatch.name}`);
        setUploading(false);
        setCurrentFileForMismatch(null);
        setRemainingFiles([]);
        return;
      }

      toast.success(`Successfully processed ${currentFileForMismatch.name}`);

      if (remainingFiles.length > 0) {
        setSelectedFiles(remainingFiles);
        setCurrentFileForMismatch(null);
        setRemainingFiles([]);
        setUploading(false);
        await handleUpload(false);
      } else {
        setSelectedFiles([]);
        setCurrentFileForMismatch(null);
        setRemainingFiles([]);
        setError('');
        onOpenChange(false);

        if (onUploadComplete) {
          onUploadComplete();
        }

        invalidateDashboardCache(vehicleId);
        router.refresh();
        setUploading(false);
      }
    } catch (err) {
      setError('An error occurred during upload');
      toast.error('Upload failed');
      setUploading(false);
      setCurrentFileForMismatch(null);
      setRemainingFiles([]);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-2xl bg-[#0d0d0d] border-white/10">
          {uploading ? (
            <>
              <DialogHeader>
                <DialogTitle className="text-white">Processing Invoice</DialogTitle>
                <DialogDescription className="text-white/50">
                  We&apos;re analyzing your document and extracting the details
                </DialogDescription>
              </DialogHeader>
              <InvoiceProcessingLoader isProcessing={uploading} fileName={currentProcessingFile} />
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="text-white">Upload Invoices or Documents</DialogTitle>
                <DialogDescription className="text-white/50">
                  Upload service invoices and we&apos;ll automatically extract details including line items
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div
                  className={`border-2 border-dashed rounded-xl transition-all duration-200 ${
                    isDragging
                      ? 'border-cyan-400/70 bg-cyan-400/10 scale-[1.005]'
                      : 'border-white/12 hover:border-white/20'
                  }`}
                  onDragEnter={handleDragEnter}
                  onDragLeave={handleDragLeave}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                >
                  {selectedFiles.length === 0 ? (
                    <div className="p-10 text-center">
                      <div className={`transition-colors ${isDragging ? 'text-info' : 'text-white/25'}`}>
                        {isDragging ? (
                          <>
                            <ImageIcon className="h-12 w-12 mx-auto mb-3" />
                            <p className="text-base font-medium text-info">Drop files here</p>
                          </>
                        ) : (
                          <>
                            <Upload className="h-10 w-10 mx-auto mb-3" />
                            <Label htmlFor="file-upload" className="cursor-pointer block">
                              <span className="text-cyan-400 hover:text-cyan-300 font-medium transition-colors">
                                Choose files
                              </span>
                              <span className="text-white/45"> or drag and drop</span>
                            </Label>
                            <p className="text-xs text-white/30 mt-1.5">PNG, JPG, PDF up to 10MB each. Multiple files supported.</p>
                          </>
                        )}
                      </div>
                      <Input
                        id="file-upload"
                        type="file"
                        accept="image/*,.pdf"
                        multiple
                        onChange={handleFileSelect}
                        className="hidden"
                      />
                    </div>
                  ) : (
                    <div className="p-5 space-y-4">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-white/70">{selectedFiles.length} file{selectedFiles.length !== 1 ? 's' : ''} selected</p>
                        <Label htmlFor="file-upload-more" className="cursor-pointer text-xs text-cyan-400 hover:text-cyan-300 transition-colors font-medium">
                          + Add more
                          <Input
                            id="file-upload-more"
                            type="file"
                            accept="image/*,.pdf"
                            multiple
                            onChange={handleFileSelect}
                            className="hidden"
                          />
                        </Label>
                      </div>
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {selectedFiles.map((file, idx) => (
                          <div key={idx} className="flex items-center justify-between bg-white/5 border border-white/8 p-3 rounded-xl">
                            <div className="flex items-center gap-2.5 flex-1 min-w-0">
                              <div className="w-8 h-8 rounded-lg bg-info-wash border border-info-border flex items-center justify-center flex-shrink-0">
                                <FileText className="h-4 w-4 text-info" />
                              </div>
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-white truncate">{file.name}</p>
                                <p className="text-xs text-white/35">
                                  {(file.size / 1024 / 1024).toFixed(2)} MB
                                </p>
                              </div>
                            </div>
                            <button
                              onClick={() => removeFile(idx)}
                              className="tap-target-44 ml-2 w-7 h-7 flex items-center justify-center rounded-lg text-white/30 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                              disabled={uploading}
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          onClick={() => setSelectedFiles([])}
                          disabled={uploading}
                          className="text-white/40 hover:text-white hover:bg-white/8 border border-white/10 text-sm"
                        >
                          Clear All
                        </Button>
                        <Button
                          onClick={() => handleUpload(false)}
                          disabled={uploading}
                          className="flex-1 bg-cyan-600 hover:bg-cyan-500 text-white font-medium"
                        >
                          <Upload className="mr-2 h-4 w-4" />
                          Upload {selectedFiles.length} File{selectedFiles.length !== 1 ? 's' : ''}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                <div>
                  <Label htmlFor="camera-upload" className="block">
                    <div className="border border-white/10 rounded-xl p-4 text-center cursor-pointer hover:bg-white/4 hover:border-white/18 transition-colors">
                      <Camera className="h-5 w-5 mx-auto mb-1.5 text-white/40" />
                      <span className="text-sm font-medium text-white/60">Take Photo</span>
                    </div>
                    <Input
                      id="camera-upload"
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={handleFileSelect}
                      className="hidden"
                    />
                  </Label>
                </div>

                {error && (
                  <div className="flex items-start gap-2.5 p-3.5 bg-red-500/10 border border-red-400/25 rounded-xl">
                    <AlertTriangle className="h-4 w-4 text-red-400 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-red-300">{error}</p>
                  </div>
                )}

                <div className="bg-info-wash border border-info-border rounded-xl p-4">
                  <p className="text-xs font-semibold uppercase tracking-widest text-info/70 mb-1.5">AI Invoice Processing</p>
                  <p className="text-sm text-white/50 leading-relaxed">
                    Our AI automatically extracts service details, costs, line items, and dates from your invoices.
                  </p>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={showVehicleMismatchDialog} onOpenChange={setShowVehicleMismatchDialog}>
        <AlertDialogContent className="bg-[#0d0d0d] border-white/10">
          <AlertDialogHeader>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-8 h-8 rounded-xl bg-orange-500/15 border border-orange-400/25 flex items-center justify-center">
                <AlertTriangle className="h-4 w-4 text-orange-400" />
              </div>
              <AlertDialogTitle className="text-white">Vehicle Mismatch Detected</AlertDialogTitle>
            </div>
            <AlertDialogDescription className="text-white/50 space-y-3 pt-1">
              <p>The invoice appears to be for a different vehicle:</p>
              <div className="bg-orange-500/8 border border-orange-400/20 rounded-xl p-4 space-y-3">
                <div>
                  <span className="text-xs font-semibold uppercase tracking-widest text-white/40">Invoice shows</span>
                  <p className="text-sm text-white font-semibold mt-1">{vehicleMismatchData?.extractedVehicle}</p>
                </div>
                <div className="border-t border-white/8 pt-3">
                  <span className="text-xs font-semibold uppercase tracking-widest text-white/40">Uploading to</span>
                  <p className="text-sm text-white font-semibold mt-1">{vehicleMismatchData?.expectedVehicle}</p>
                </div>
              </div>
              <p className="text-sm text-white/40">Are you sure you want to continue?</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setShowVehicleMismatchDialog(false);
                setVehicleMismatchData(null);
                setCurrentFileForMismatch(null);
                setRemainingFiles([]);
              }}
              className="bg-white/5 border-white/10 text-white/70 hover:bg-white/10 hover:text-white"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleContinueAnyway}
              className="bg-orange-600 hover:bg-orange-500 text-white"
            >
              Continue Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
