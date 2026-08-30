'use client';

import { useState, useEffect, forwardRef, useImperativeHandle, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Plus, CircleCheck as CheckCircle, Clock, Wrench, TrendingUp, Mail, FileText, Heart, Eye } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { createServiceItem, updateServiceItem, deleteServiceItem, moveServiceItemToHistory, getWishlistItems, getQuoteRequestHistory } from '@/app/actions';
import { logger } from '@wellkept/core/logger';
import { QuoteRequestDialogV2 } from './QuoteRequestDialogV2';
import { QuoteDetailDialog } from './QuoteDetailDialog';
import CompletionDetailsDialog, { CompletionDetails } from './CompletionDetailsDialog';

interface ServiceItemsProps {
  vehicleId: string;
  vehicle: any;
  initialItems: any[];
  bundles: any[];
  savedItemNames?: Set<string>;
}

const ServiceItemsComponent = forwardRef<{ refreshWishlist: () => Promise<void> }, ServiceItemsProps>(
  ({ vehicleId, vehicle, initialItems, bundles, savedItemNames = new Set() }, ref) => {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [quoteHistory, setQuoteHistory] = useState<any[]>([]);
  const [loadingQuotes, setLoadingQuotes] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showQuoteDialog, setShowQuoteDialog] = useState(false);
  const [showQuoteDetailDialog, setShowQuoteDetailDialog] = useState(false);
  const [selectedQuote, setSelectedQuote] = useState<any>(null);
  const [showCompletionDialog, setShowCompletionDialog] = useState(false);
  const [selectedItemForCompletion, setSelectedItemForCompletion] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    description: '',
    category: 'maintenance',
    status: 'wishlist',
    cost_parts: '',
    cost_labor: '',
    notes: '',
  });

  useImperativeHandle(ref, () => ({
    refreshWishlist: refreshWishlistItems,
  }));

  const savedItemNamesKey = useMemo(() => {
    if (!savedItemNames || savedItemNames.size === 0) return '';
    return Array.from(savedItemNames).sort().join(',');
  }, [savedItemNames]);

  useEffect(() => {
    setItems(initialItems);
  }, [initialItems]);

  useEffect(() => {
    refreshWishlistItems();
    loadQuoteHistory();
  }, [vehicleId, savedItemNamesKey]);

  const loadQuoteHistory = async () => {
    setLoadingQuotes(true);
    const result = await getQuoteRequestHistory(vehicleId, 50);
    if (result.success && result.data) {
      setQuoteHistory(result.data);
    } else if (result.error) {
      logger.error('SERVICE_ITEMS:QUOTE_HISTORY', new Error(result.error), { vehicleId });
    }
    setLoadingQuotes(false);
  };

  const handleQuoteSaved = async (_quoteRequestId: string) => {
    await loadQuoteHistory();
  };

  const refreshWishlistItems = async () => {
    try {
      const result = await getWishlistItems(vehicleId);
      if (result.success && result.data) {
        setItems(result.data);
      }
    } catch (error) {
      logger.error('SERVICE_ITEMS:WISHLIST_REFRESH', error as Error, { vehicleId });
    }
  };

  const handleAddItem = async () => {
    setLoading(true);

    const result = await createServiceItem({
      vehicle_id: vehicleId,
      description: formData.description,
      category: formData.category,
      status: formData.status,
      cost_parts: parseFloat(formData.cost_parts) || 0,
      cost_labor: parseFloat(formData.cost_labor) || 0,
      notes: formData.notes,
    });

    if (result.success) {
      setItems([...items, result.data]);
      setShowAddDialog(false);
      setFormData({
        description: '',
        category: 'maintenance',
        status: 'wishlist',
        cost_parts: '',
        cost_labor: '',
        notes: '',
      });
      toast.success('Service item added');
    } else {
      toast.error('Failed to add service item');
    }

    setLoading(false);
  };

  const handleStatusUpdate = async (itemId: string, newStatus: string, item: any) => {
    if (newStatus === 'remove_from_wishlist') {
      await handleRemoveFromWishlist(itemId, item.description);
      return;
    }

    if (newStatus === 'completed') {
      setSelectedItemForCompletion(item);
      setShowCompletionDialog(true);
      return;
    }

    const result = await updateServiceItem(itemId, { status: newStatus });

    if (result.success) {
      setItems(items.map(i => i.id === itemId ? result.data : i));
      toast.success('Status updated');
    } else {
      toast.error('Failed to update status');
    }
  };

  const handleRemoveFromWishlist = async (itemId: string, description: string) => {
    const result = await deleteServiceItem(itemId);

    if (result.success) {
      setItems(items.filter(i => i.id !== itemId));
      toast.success('Removed from wishlist');
    } else {
      toast.error('Failed to remove item');
    }
  };

  const handleCompletionConfirm = async (details: CompletionDetails) => {
    if (!selectedItemForCompletion) return;

    setLoading(true);
    const result = await moveServiceItemToHistory(selectedItemForCompletion.id, vehicleId, details);

    if (result.success) {
      setItems(items.filter(i => i.id !== selectedItemForCompletion.id));
      setShowCompletionDialog(false);
      setSelectedItemForCompletion(null);
      toast.success('Service item moved to maintenance history');
    } else {
      toast.error(result.error || 'Failed to complete service item');
    }
    setLoading(false);
  };

  const wishlistItems = items.filter((item) => item.status === 'wishlist');

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'maintenance':
        return <Wrench className="h-4 w-4" />;
      case 'repair':
        return <Wrench className="h-4 w-4" />;
      case 'modification':
        return <TrendingUp className="h-4 w-4" />;
      case 'upgrade':
        return <TrendingUp className="h-4 w-4" />;
      default:
        return <Wrench className="h-4 w-4" />;
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case 'scheduled':
        return <Clock className="h-4 w-4 text-cyan-600" />;
      default:
        return null;
    }
  };

  return (
    <>
      <Card className="bg-slate-900/50 border-info-border">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-white flex items-center gap-2">
              <Heart className="h-5 w-5 text-info" />
              My Wishlist
            </CardTitle>
            <Button onClick={() => setShowAddDialog(true)} className="bg-primary hover:bg-cyan-700 text-primary-foreground border-0">
              <Plus className="mr-2 h-4 w-4" />
              Add Item
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {bundles.length > 0 && (
            <div className="mb-6 p-4 bg-info-wash border border-info-border rounded-lg">
              <h4 className="font-semibold text-info mb-2">Smart Bundling Opportunities</h4>
              {bundles.map((bundle: any) => (
                <div key={bundle.id} className="bg-slate-800/50 p-3 rounded mb-2 border border-info-border">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <p className="text-sm font-medium mb-1 text-white">{bundle.bundle_reason}</p>
                      <p className="text-sm text-slate-300">
                        Save {bundle.labor_saved_hours}h labor (≈${bundle.estimated_savings})
                      </p>
                    </div>
                    <Button size="sm" variant="outline" className="border-info-border text-info hover:bg-cyan-400/10">
                      View Bundle
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <Tabs defaultValue="wishlist" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="wishlist">
                Wishlist ({wishlistItems.length})
              </TabsTrigger>
              <TabsTrigger value="quotes">
                Past Quotes ({quoteHistory.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="wishlist" className="space-y-2">
              {wishlistItems.length > 0 && (
                <div className="flex items-center justify-between mb-4">
                  <p className="text-sm text-slate-400">
                    {wishlistItems.length} {wishlistItems.length === 1 ? 'item' : 'items'} on wishlist
                  </p>
                  <Button
                    onClick={() => setShowQuoteDialog(true)}
                    className="bg-primary hover:bg-cyan-700 text-primary-foreground border-0"
                    size="sm"
                  >
                    <Mail className="mr-2 h-4 w-4" />
                    Request Quotes
                  </Button>
                </div>
              )}
              {wishlistItems.length === 0 ? (
                <div className="text-center py-8 text-slate-400">
                  No items on wishlist. Add items you&apos;re planning to do.
                </div>
              ) : (
                wishlistItems.map((item: any) => (
                  <div key={item.id} className="p-4 border border-info-border rounded-lg hover:border-cyan-400/30 transition-colors bg-slate-800/30">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <div className="p-1.5 bg-slate-950/50 rounded border border-info-border">
                            {getCategoryIcon(item.category)}
                          </div>
                          <span className="font-medium text-white">{item.description}</span>
                          <Badge variant="outline" className="capitalize bg-info-wash text-info border-info-border">
                            {item.category}
                          </Badge>
                        </div>
                        {item.notes && (
                          <p className="text-sm text-slate-300 mt-1">{item.notes}</p>
                        )}
                        {(item.cost_parts > 0 || item.cost_labor > 0) && (
                          <p className="text-sm text-slate-400 mt-1">
                            Est. Cost: ${(parseFloat(item.cost_parts) + parseFloat(item.cost_labor)).toFixed(2)}
                          </p>
                        )}
                      </div>
                      <Select
                        value={item.status}
                        onValueChange={(value) => handleStatusUpdate(item.id, value, item)}
                      >
                        <SelectTrigger className="w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="wishlist">Wishlist</SelectItem>
                          <SelectItem value="remove_from_wishlist">Remove from Wishlist</SelectItem>
                          <SelectItem value="completed">Completed</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                ))
              )}
            </TabsContent>

            <TabsContent value="quotes" className="space-y-2">
              {loadingQuotes ? (
                <div className="text-center py-8 text-slate-400">
                  Loading quotes...
                </div>
              ) : quoteHistory.length === 0 ? (
                <div className="text-center py-8 text-slate-400">
                  No quotes created yet. Request quotes from your wishlist to get started.
                </div>
              ) : (
                quoteHistory.map((quote: any) => (
                  <div
                    key={quote.id}
                    className="p-4 border border-info-border rounded-lg hover:border-cyan-400/30 transition-colors bg-slate-800/30 cursor-pointer"
                    onClick={() => {
                      setSelectedQuote(quote);
                      setShowQuoteDetailDialog(true);
                    }}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <FileText className="h-4 w-4 text-cyan-400" />
                          <span className="font-medium text-white text-lg">
                            {quote.name || `Quote for ${quote.selected_items?.length || 0} items`}
                          </span>
                          <Badge variant="outline" className="bg-info-wash text-info border-info-border">
                            {quote.zip_code}
                          </Badge>
                        </div>
                        <p className="text-sm text-slate-400 mb-2">
                          Created {new Date(quote.created_at).toLocaleDateString()}
                        </p>
                        {quote.estimated_total_low && quote.estimated_total_high && (
                          <p className="text-sm font-medium text-info">
                            Estimate: ${quote.estimated_total_low.toFixed(0)} - ${quote.estimated_total_high.toFixed(0)}
                          </p>
                        )}
                      </div>
                      <div className="flex gap-2 ml-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-info border-info-border hover:bg-cyan-400/10"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedQuote(quote);
                            setShowQuoteDetailDialog(true);
                          }}
                        >
                          <Eye className="h-3 w-3 mr-1" />
                          View
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-info border-info-border hover:bg-cyan-400/10"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (quote.email_draft) {
                              navigator.clipboard.writeText(quote.email_draft);
                              toast.success('Email copied to clipboard');
                            }
                          }}
                        >
                          <Mail className="h-3 w-3 mr-1" />
                          Copy
                        </Button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Service Item</DialogTitle>
            <DialogDescription>
              Track maintenance, repairs, or upgrades you&apos;re planning
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label>Description</Label>
              <Input
                placeholder="e.g., Replace brake pads"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Category</Label>
                <Select
                  value={formData.category}
                  onValueChange={(value) => setFormData({ ...formData, category: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="maintenance">Maintenance</SelectItem>
                    <SelectItem value="repair">Repair</SelectItem>
                    <SelectItem value="modification">Modification</SelectItem>
                    <SelectItem value="upgrade">Upgrade</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Status</Label>
                <Select
                  value={formData.status}
                  onValueChange={(value) => setFormData({ ...formData, status: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="wishlist">Wishlist</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Parts Cost</Label>
                <Input
                  type="number"
                  placeholder="0.00"
                  value={formData.cost_parts}
                  onChange={(e) => setFormData({ ...formData, cost_parts: e.target.value })}
                />
              </div>

              <div>
                <Label>Labor Cost</Label>
                <Input
                  type="number"
                  placeholder="0.00"
                  value={formData.cost_labor}
                  onChange={(e) => setFormData({ ...formData, cost_labor: e.target.value })}
                />
              </div>
            </div>

            <div>
              <Label>Notes (Optional)</Label>
              <Textarea
                placeholder="Additional details..."
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                rows={3}
              />
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setShowAddDialog(false)}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                onClick={handleAddItem}
                disabled={loading || !formData.description}
                className="flex-1"
              >
                {loading ? 'Adding...' : 'Add Item'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <QuoteRequestDialogV2
        open={showQuoteDialog}
        onOpenChange={setShowQuoteDialog}
        vehicleId={vehicleId}
        wishlistItems={wishlistItems}
        preferredZipCode={vehicle?.preferred_zip_code}
        onQuoteSaved={handleQuoteSaved}
      />

      <QuoteDetailDialog
        open={showQuoteDetailDialog}
        onOpenChange={setShowQuoteDetailDialog}
        quote={selectedQuote}
      />

      <CompletionDetailsDialog
        open={showCompletionDialog}
        onOpenChange={setShowCompletionDialog}
        serviceItem={selectedItemForCompletion}
        onConfirm={handleCompletionConfirm}
        isLoading={loading}
      />
    </>
  );
  }
);

ServiceItemsComponent.displayName = 'ServiceItems';

export default ServiceItemsComponent;
