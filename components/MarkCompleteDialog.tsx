'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader as Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { logger } from '@wellkept/core/logger';

interface WishlistItem {
  id: string;
  item_name: string;
  estimated_cost_parts: number;
  estimated_cost_labor: number;
}

interface MarkCompleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wishlistItem: WishlistItem;
  onSuccess: () => void;
}

export function MarkCompleteDialog({
  open,
  onOpenChange,
  wishlistItem,
  onSuccess,
}: MarkCompleteDialogProps) {
  const [loading, setLoading] = useState(false);
  const [isDIY, setIsDIY] = useState(false);
  const [formData, setFormData] = useState({
    serviceDate: new Date().toISOString().split('T')[0],
    shopName: '',
    partsCost: wishlistItem.estimated_cost_parts || 0,
    laborCost: wishlistItem.estimated_cost_labor || 0,
    notes: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isDIY && !formData.shopName.trim()) {
      toast.error('Please enter shop name or mark as DIY');
      return;
    }

    try {
      setLoading(true);

      const response = await fetch('/api/v1/wishlist/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: wishlistItem.id,
          serviceDate: formData.serviceDate,
          shopName: formData.shopName,
          isDIY,
          partsCost: formData.partsCost,
          laborCost: formData.laborCost,
          notes: formData.notes,
        }),
      });

      if (response.ok) {
        onSuccess();
      } else {
        const data = await response.json();
        toast.error(data.error || 'Failed to mark as complete');
      }
    } catch (error) {
      logger.error('MARK_COMPLETE_DIALOG:SUBMIT', error as Error);
      toast.error('Failed to mark as complete');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Mark as Complete: {wishlistItem.item_name}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="serviceDate">Service Date</Label>
              <Input
                id="serviceDate"
                type="date"
                value={formData.serviceDate}
                onChange={(e) =>
                  setFormData({ ...formData, serviceDate: e.target.value })
                }
                required
              />
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="isDIY"
                checked={isDIY}
                onCheckedChange={(checked) => setIsDIY(checked as boolean)}
              />
              <Label htmlFor="isDIY" className="cursor-pointer">
                This was a DIY (Do It Yourself) job
              </Label>
            </div>

            {!isDIY && (
              <div>
                <Label htmlFor="shopName">Shop Name</Label>
                <Input
                  id="shopName"
                  value={formData.shopName}
                  onChange={(e) =>
                    setFormData({ ...formData, shopName: e.target.value })
                  }
                  placeholder="Enter shop name"
                  required={!isDIY}
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="partsCost">Parts Cost ($)</Label>
                <Input
                  id="partsCost"
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.partsCost}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      partsCost: parseFloat(e.target.value) || 0,
                    })
                  }
                />
              </div>

              <div>
                <Label htmlFor="laborCost">Labor Cost ($)</Label>
                <Input
                  id="laborCost"
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.laborCost}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      laborCost: parseFloat(e.target.value) || 0,
                    })
                  }
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>Total Cost</Label>
                <span className="text-lg font-semibold text-foreground">
                  ${(formData.partsCost + formData.laborCost).toFixed(2)}
                </span>
              </div>
            </div>

            <div>
              <Label htmlFor="notes">Notes (Optional)</Label>
              <Textarea
                id="notes"
                value={formData.notes}
                onChange={(e) =>
                  setFormData({ ...formData, notes: e.target.value })
                }
                placeholder="Any additional notes about this service..."
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                'Mark as Complete'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
