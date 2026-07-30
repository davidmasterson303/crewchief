'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2 } from 'lucide-react';

interface IssueFixDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  issueName: string;
  onSubmit: (data: {
    dateCompleted: string;
    shopName?: string;
    cost?: number;
    notes?: string;
  }) => Promise<void>;
  isLoading: boolean;
}

export default function IssueFixDialog({
  open,
  onOpenChange,
  issueName,
  onSubmit,
  isLoading,
}: IssueFixDialogProps) {
  const [dateCompleted, setDateCompleted] = useState(new Date().toISOString().split('T')[0]);
  const [shopName, setShopName] = useState('');
  const [cost, setCost] = useState('');
  const [notes, setNotes] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmit({
      dateCompleted,
      shopName: shopName || undefined,
      cost: cost ? parseFloat(cost) : undefined,
      notes: notes || undefined,
    });
    setDateCompleted(new Date().toISOString().split('T')[0]);
    setShopName('');
    setCost('');
    setNotes('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mark as Fixed: {issueName}</DialogTitle>
          <DialogDescription>
            Record the details of fixing this issue
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
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
              className="resize-none"
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
                  Saving
                </>
              ) : (
                'Mark Fixed'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
