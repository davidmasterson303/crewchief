'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2 } from 'lucide-react';

interface MaintenanceHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  maintenanceItem: string;
  isModInstallation?: boolean;
  onSubmit: (data: {
    dateCompleted: string;
    description: string;
    shopName?: string;
    cost?: number;
    notes?: string;
  }) => Promise<void>;
  isLoading: boolean;
}

export default function MaintenanceHistoryDialog({
  open,
  onOpenChange,
  maintenanceItem,
  isModInstallation = false,
  onSubmit,
  isLoading,
}: MaintenanceHistoryDialogProps) {
  const [dateCompleted, setDateCompleted] = useState(new Date().toISOString().split('T')[0]);
  const [description, setDescription] = useState(maintenanceItem);
  const [shopName, setShopName] = useState('');
  const [cost, setCost] = useState('');
  const [notes, setNotes] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmit({
      dateCompleted,
      description,
      shopName: shopName || undefined,
      cost: cost ? parseFloat(cost) : undefined,
      notes: notes || undefined,
    });
    setDateCompleted(new Date().toISOString().split('T')[0]);
    setDescription(maintenanceItem);
    setShopName('');
    setCost('');
    setNotes('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add to Maintenance History</DialogTitle>
          <DialogDescription>
            Record a maintenance service without uploading an invoice
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="description" className="text-white">
              Service Description {!isModInstallation && <span className="text-red-400">*</span>}
            </Label>
            <Input
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required={!isModInstallation}
              disabled={isModInstallation}
              className="bg-white/5 border-white/20 text-white placeholder:text-white/40"
            />
            {isModInstallation && <p className="text-xs text-white/50">Auto-filled with modification name</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="date" className="text-white">
              Date Completed <span className="text-red-400">*</span>
            </Label>
            <Input
              id="date"
              type="date"
              value={dateCompleted}
              onChange={(e) => setDateCompleted(e.target.value)}
              required
              className="bg-white/5 border-white/20 text-white"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="shop" className="text-white">
              Shop Name <span className="text-white/50">(Optional)</span>
            </Label>
            <Input
              id="shop"
              placeholder="e.g., Local Garage, DIY"
              value={shopName}
              onChange={(e) => setShopName(e.target.value)}
              className="bg-white/5 border-white/20 text-white placeholder:text-white/40"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cost" className="text-white">
              Total Cost <span className="text-white/50">(Optional)</span>
            </Label>
            <Input
              id="cost"
              type="number"
              placeholder="0.00"
              step="0.01"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              className="bg-white/5 border-white/20 text-white placeholder:text-white/40"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes" className="text-white">
              Notes <span className="text-white/50">(Optional)</span>
            </Label>
            <Textarea
              id="notes"
              placeholder="Add any additional details..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="bg-white/5 border-white/20 text-white placeholder:text-white/40 resize-none"
              rows={3}
            />
          </div>

          <div className="flex gap-2 justify-end pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
              className="border-white/20 text-white hover:bg-white/10"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isLoading}
              className="bg-accent hover:bg-accent/90 text-white"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Adding
                </>
              ) : (
                'Add to History'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
