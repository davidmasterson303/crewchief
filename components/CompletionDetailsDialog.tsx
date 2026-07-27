'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Calendar, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { uploadInvoiceForCompletion } from '@/app/actions';
import { logger } from '@crewchief/core/logger';

interface CompletionDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serviceItem: any;
  onConfirm: (details: CompletionDetails) => Promise<void>;
  isLoading?: boolean;
}

export interface CompletionDetails {
  dateCompleted: string;
  shopName?: string;
  totalCost?: number;
  notes?: string;
  invoiceUrl?: string;
}

export default function CompletionDetailsDialog({
  open,
  onOpenChange,
  serviceItem,
  onConfirm,
  isLoading = false,
}: CompletionDetailsDialogProps) {
  const [formData, setFormData] = useState<CompletionDetails>({
    dateCompleted: new Date().toISOString().split('T')[0],
    shopName: '',
    totalCost: undefined,
    notes: '',
    invoiceUrl: '',
  });

  const [submitting, setSubmitting] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      toast.error('File size must be less than 10MB');
      return;
    }

    setUploadingFile(true);
    try {
      // serviceItem.vehicle_id scopes the upload to a vehicle, so the stored
      // path carries its owner and the file can be authorized and purged.
      const result = await uploadInvoiceForCompletion(file, serviceItem?.vehicle_id);
      if (result.success && result.data) {
        setFormData({ ...formData, invoiceUrl: result.data.url });
        toast.success('Invoice uploaded successfully');
      } else {
        toast.error(result.error || 'Failed to upload invoice');
      }
    } catch (error) {
      logger.error('COMPLETION_DIALOG:UPLOAD', error as Error);
      toast.error('Failed to upload invoice');
    } finally {
      setUploadingFile(false);
      if (e.target) e.target.value = '';
    }
  };

  const handleSubmit = async () => {
    if (!formData.dateCompleted) {
      toast.error('Date completed is required');
      return;
    }

    setSubmitting(true);
    try {
      await onConfirm(formData);
      onOpenChange(false);
      setFormData({
        dateCompleted: new Date().toISOString().split('T')[0],
        shopName: '',
        totalCost: undefined,
        notes: '',
        invoiceUrl: '',
      });
    } catch (error) {
      logger.error('COMPLETION_DIALOG:SUBMIT', error as Error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Mark as Completed</DialogTitle>
          <DialogDescription>
            Provide details about the completed maintenance work
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="p-3 bg-slate-800/50 rounded border border-info-border">
            <p className="text-sm text-slate-400">Service Item</p>
            <p className="font-medium text-white">{serviceItem?.description}</p>
          </div>

          <div>
            <Label htmlFor="dateCompleted" className="flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Date Completed <span className="text-red-500">*</span>
            </Label>
            <Input
              id="dateCompleted"
              type="date"
              value={formData.dateCompleted}
              onChange={(e) => setFormData({ ...formData, dateCompleted: e.target.value })}
              className="mt-1"
            />
          </div>

          <div>
            <Label htmlFor="shopName">Shop Name / Technician (Optional)</Label>
            <Input
              id="shopName"
              placeholder="e.g., Joe's Auto Repair"
              value={formData.shopName || ''}
              onChange={(e) => setFormData({ ...formData, shopName: e.target.value })}
              className="mt-1"
            />
          </div>

          <div>
            <Label htmlFor="totalCost">Total Cost (Optional)</Label>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-slate-400">$</span>
              <Input
                id="totalCost"
                type="number"
                placeholder="0.00"
                step="0.01"
                min="0"
                value={formData.totalCost ?? ''}
                onChange={(e) => setFormData({ ...formData, totalCost: e.target.value ? parseFloat(e.target.value) : undefined })}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="notes">Work Notes (Optional)</Label>
            <Textarea
              id="notes"
              placeholder="Any additional details about the work performed..."
              value={formData.notes || ''}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={3}
              className="mt-1"
            />
          </div>

          <div>
            <Label>Invoice Attachment (Optional)</Label>
            <div className="mt-2 space-y-2">
              {formData.invoiceUrl ? (
                <div className="p-3 bg-green-500/10 border border-green-500/20 rounded flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Upload className="h-4 w-4 text-green-500" />
                    <span className="text-sm text-green-600">Invoice uploaded</span>
                  </div>
                  <button
                    onClick={() => setFormData({ ...formData, invoiceUrl: '' })}
                    className="p-1 hover:bg-red-500/20 rounded"
                  >
                    <X className="h-4 w-4 text-red-500" />
                  </button>
                </div>
              ) : (
                <label className="flex items-center justify-center w-full p-3 border border-dashed border-info-border rounded hover:bg-cyan-400/5 cursor-pointer transition">
                  <div className="flex items-center gap-2 text-sm text-slate-400">
                    <Upload className="h-4 w-4" />
                    Click to upload invoice (PDF, JPG, PNG)
                  </div>
                  <input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    onChange={handleFileUpload}
                    disabled={uploadingFile}
                    className="hidden"
                  />
                </label>
              )}
              {uploadingFile && (
                <p className="text-xs text-slate-400">Uploading invoice...</p>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting || isLoading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || isLoading || !formData.dateCompleted}
            className="bg-green-600 hover:bg-green-700"
          >
            {submitting || isLoading ? 'Saving...' : 'Mark as Completed'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
