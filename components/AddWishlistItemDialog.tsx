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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader as Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { logger } from '@/lib/logger';

interface AddWishlistItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vehicleId: string;
  onSuccess: () => void;
}

export function AddWishlistItemDialog({
  open,
  onOpenChange,
  vehicleId,
  onSuccess,
}: AddWishlistItemDialogProps) {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    itemType: 'maintenance' as 'issue' | 'maintenance' | 'modification',
    itemName: '',
    description: '',
    category: '',
    estimatedCostParts: 0,
    estimatedCostLabor: 0,
    estimatedLaborHours: 0,
    notes: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.itemName.trim()) {
      toast.error('Please enter an item name');
      return;
    }

    try {
      setLoading(true);

      const itemIdentifier = `manual:${formData.itemType}:${formData.itemName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')}`;

      const response = await fetch('/api/wishlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicleId,
          itemType: formData.itemType,
          itemName: formData.itemName,
          itemIdentifier,
          description: formData.description || null,
          category: formData.category || null,
          estimatedCostParts: formData.estimatedCostParts,
          estimatedCostLabor: formData.estimatedCostLabor,
          estimatedLaborHours: formData.estimatedLaborHours,
          notes: formData.notes || null,
          source: 'manual',
        }),
      });

      if (response.ok) {
        setFormData({
          itemType: 'maintenance',
          itemName: '',
          description: '',
          category: '',
          estimatedCostParts: 0,
          estimatedCostLabor: 0,
          estimatedLaborHours: 0,
          notes: '',
        });
        onSuccess();
      } else {
        const data = await response.json();
        if (response.status === 409) {
          toast.error('This item is already in your wishlist');
        } else {
          toast.error(data.error || 'Failed to add item');
        }
      }
    } catch (error) {
      logger.error('ADD_WISHLIST_DIALOG:SUBMIT', error as Error);
      toast.error('Failed to add item');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Item to Wishlist</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="itemType">Item Type</Label>
              <Select
                value={formData.itemType}
                onValueChange={(value: 'issue' | 'maintenance' | 'modification') =>
                  setFormData({ ...formData, itemType: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="issue">Issue / Repair</SelectItem>
                  <SelectItem value="maintenance">Maintenance</SelectItem>
                  <SelectItem value="modification">Modification / Upgrade</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="itemName">Item Name *</Label>
              <Input
                id="itemName"
                value={formData.itemName}
                onChange={(e) =>
                  setFormData({ ...formData, itemName: e.target.value })
                }
                placeholder="e.g., Oil Change, New Tires, Cold Air Intake"
                required
              />
            </div>

            <div>
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                placeholder="Additional details about this item..."
                rows={3}
              />
            </div>

            <div>
              <Label htmlFor="category">Category</Label>
              <Input
                id="category"
                value={formData.category}
                onChange={(e) =>
                  setFormData({ ...formData, category: e.target.value })
                }
                placeholder="e.g., Fluids, Brakes, Engine, Suspension"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="estimatedCostParts">Est. Parts Cost ($)</Label>
                <Input
                  id="estimatedCostParts"
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.estimatedCostParts}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      estimatedCostParts: parseFloat(e.target.value) || 0,
                    })
                  }
                />
              </div>

              <div>
                <Label htmlFor="estimatedCostLabor">Est. Labor Cost ($)</Label>
                <Input
                  id="estimatedCostLabor"
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.estimatedCostLabor}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      estimatedCostLabor: parseFloat(e.target.value) || 0,
                    })
                  }
                />
              </div>
            </div>

            <div>
              <Label htmlFor="estimatedLaborHours">Est. Labor Hours</Label>
              <Input
                id="estimatedLaborHours"
                type="number"
                min="0"
                step="0.1"
                value={formData.estimatedLaborHours}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    estimatedLaborHours: parseFloat(e.target.value) || 0,
                  })
                }
              />
            </div>

            <div>
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={formData.notes}
                onChange={(e) =>
                  setFormData({ ...formData, notes: e.target.value })
                }
                placeholder="Any additional notes..."
                rows={2}
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
                  Adding...
                </>
              ) : (
                'Add to Wishlist'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
