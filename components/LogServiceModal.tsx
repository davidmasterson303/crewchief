'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Upload, ClipboardList, CircleCheck as CheckCircle, Loader as Loader2, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import DocumentUploadDialog from '@/components/DocumentUploadDialog';

type LogTab = 'upload' | 'manual' | 'dismiss';

interface LogServiceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categoryName: string;
  vehicleId: string;
  currentMileage: number;
  onServiceLogged: () => void;
}

export function LogServiceModal({
  open,
  onOpenChange,
  categoryName,
  vehicleId,
  currentMileage,
  onServiceLogged,
}: LogServiceModalProps) {
  const [tab, setTab] = useState<LogTab>('upload');
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);

  const [manualDate, setManualDate] = useState('');
  const [manualMileage, setManualMileage] = useState(String(currentMileage));
  const [manualCost, setManualCost] = useState('');
  const [manualNotes, setManualNotes] = useState('');
  const [manualShop, setManualShop] = useState('');
  const [isSavingManual, setIsSavingManual] = useState(false);

  const [dismissMileage, setDismissMileage] = useState(String(currentMileage));
  const [isDismissing, setIsDismissing] = useState(false);

  const handleClose = () => {
    setTab('upload');
    setManualDate('');
    setManualMileage(String(currentMileage));
    setManualCost('');
    setManualNotes('');
    setManualShop('');
    setDismissMileage(String(currentMileage));
    onOpenChange(false);
  };

  const handleManualSave = async () => {
    if (!manualDate) {
      toast.error('Please enter the service date');
      return;
    }
    const mileage = parseInt(manualMileage);
    if (isNaN(mileage) || mileage < 0) {
      toast.error('Please enter a valid mileage');
      return;
    }
    if (!supabase) {
      toast.error('Database not available');
      return;
    }
    setIsSavingManual(true);
    try {
      const cost = parseFloat(manualCost) || 0;
      const { error } = await supabase.from('maintenance_line_items').insert({
        vehicle_id: vehicleId,
        item_description: categoryName,
        service_date: manualDate,
        service_mileage: mileage,
        total_cost: cost,
        shop_name: manualShop || null,
        notes: manualNotes || null,
        category: categoryName.toLowerCase().replace(/\s+/g, '_'),
        source: 'manual_entry',
      });
      if (error) throw error;
      toast.success(`${categoryName} logged successfully`);
      onServiceLogged();
      handleClose();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save service record');
    } finally {
      setIsSavingManual(false);
    }
  };

  const handleDismiss = async () => {
    const mileage = parseInt(dismissMileage);
    if (isNaN(mileage) || mileage < 0) {
      toast.error('Please enter a valid mileage');
      return;
    }
    if (!supabase) {
      toast.error('Database not available');
      return;
    }
    setIsDismissing(true);
    try {
      const { error } = await supabase.from('maintenance_dismissals').insert({
        vehicle_id: vehicleId,
        category_key: categoryName,
        confirmed_mileage: mileage,
        notes: 'Verified by owner',
      });
      if (error) throw error;
      toast.success(`${categoryName} marked as current`);
      onServiceLogged();
      handleClose();
    } catch (err: any) {
      toast.error(err.message || 'Failed to dismiss alert');
    } finally {
      setIsDismissing(false);
    }
  };

  const TAB_OPTIONS: { id: LogTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'upload', label: 'Upload Invoice', icon: Upload },
    { id: 'manual', label: 'Manual Entry', icon: ClipboardList },
    { id: 'dismiss', label: 'Mark as Current', icon: CheckCircle },
  ];

  return (
    <>
      <Dialog open={open && !uploadDialogOpen} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-md bg-[#111114] border-white/10 text-white">
          <DialogHeader>
            <DialogTitle className="text-white">Log {categoryName}</DialogTitle>
            <DialogDescription className="text-white/45">
              Choose how you want to record this service.
            </DialogDescription>
          </DialogHeader>

          <div className="flex gap-1 p-1 bg-white/[0.04] rounded-xl border border-white/8">
            {TAB_OPTIONS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`flex-1 flex flex-col items-center gap-1 px-2 py-2 rounded-lg text-[11px] font-medium transition-all ${
                  tab === id
                    ? 'bg-cyan-400/10 text-cyan-300 border border-cyan-400/25'
                    : 'text-white/40 hover:text-white/70 hover:bg-white/5'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>

          {tab === 'upload' && (
            <div className="space-y-3">
              <p className="text-sm text-white/55 leading-relaxed">
                Upload a PDF or photo of your service invoice. AI will extract the details automatically and log them to your maintenance history.
              </p>
              <Button
                onClick={() => setUploadDialogOpen(true)}
                className="w-full bg-cyan-500 hover:bg-cyan-400 text-black font-semibold h-11"
              >
                <Upload className="h-4 w-4 mr-2" />
                Choose Invoice File
                <ChevronRight className="h-4 w-4 ml-auto" />
              </Button>
            </div>
          )}

          {tab === 'manual' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-white/55">Service Date *</Label>
                  <Input fieldSize="sm"
                    type="date"
                    value={manualDate}
                    onChange={(e) => setManualDate(e.target.value)}
                    className="text-sm [color-scheme:dark]"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-white/55">Mileage *</Label>
                  <Input fieldSize="sm"
                    type="number"
                    value={manualMileage}
                    onChange={(e) => setManualMileage(e.target.value)}
                    placeholder={String(currentMileage)}
                    className="text-sm"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-white/55">Shop / DIY</Label>
                  <Input fieldSize="sm"
                    value={manualShop}
                    onChange={(e) => setManualShop(e.target.value)}
                    placeholder="e.g. Jiffy Lube or DIY"
                    className="text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-white/55">Cost (optional)</Label>
                  <div className="relative">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/30 text-sm">$</span>
                    <Input fieldSize="sm"
                      type="number"
                      value={manualCost}
                      onChange={(e) => setManualCost(e.target.value)}
                      placeholder="0.00"
                      className="text-sm pl-6"
                    />
                  </div>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-white/55">Notes (optional)</Label>
                <Textarea
                  value={manualNotes}
                  onChange={(e) => setManualNotes(e.target.value)}
                  placeholder="Brand used, condition observed, etc."
                  rows={2}
                  className="text-sm resize-none"
                />
              </div>
              <Button
                onClick={handleManualSave}
                disabled={isSavingManual}
                className="w-full bg-cyan-500 hover:bg-cyan-400 text-black font-semibold h-11"
              >
                {isSavingManual ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving...</>
                ) : (
                  <><CheckCircle className="h-4 w-4 mr-2" />Save Service Record</>
                )}
              </Button>
            </div>
          )}

          {tab === 'dismiss' && (
            <div className="space-y-4">
              <div className="p-3 bg-amber-500/8 border border-amber-400/20 rounded-xl">
                <p className="text-xs text-amber-300/80 leading-relaxed">
                  Use this if you know this service was recently done but don't have the paperwork. We'll reset the countdown clock from the mileage you confirm below.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-white/55">Mileage when service was done</Label>
                <Input
                  type="number"
                  value={dismissMileage}
                  onChange={(e) => setDismissMileage(e.target.value)}
                />
                <p className="text-[10px] text-white/30">Defaults to your current mileage ({currentMileage.toLocaleString()} mi)</p>
              </div>
              <Button
                onClick={handleDismiss}
                disabled={isDismissing}
                className="w-full bg-white/10 hover:bg-white/15 text-white border border-white/15 font-medium h-11"
              >
                {isDismissing ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Confirming...</>
                ) : (
                  <><CheckCircle className="h-4 w-4 mr-2 text-green-400" />Confirm &amp; Clear Alert</>
                )}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {uploadDialogOpen && (
        <DocumentUploadDialog
          vehicleId={vehicleId}
          open={uploadDialogOpen}
          onOpenChange={(open) => {
            setUploadDialogOpen(open);
            if (!open) handleClose();
          }}
          onUploadComplete={() => {
            setUploadDialogOpen(false);
            onServiceLogged();
            handleClose();
          }}
        />
      )}
    </>
  );
}
