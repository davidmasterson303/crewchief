'use client';

import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, CircleCheck as CheckCircle, Wrench, TriangleAlert as AlertTriangle, Sparkles, Loader as Loader2, FileText, History, Eye, ListChecks } from 'lucide-react';
import { toast } from 'sonner';
import { getQuoteRequestHistory } from '@/app/actions';
import { logger } from '@wellkept/core/logger';
import { MarkCompleteDialog } from './MarkCompleteDialog';
import { AddWishlistItemDialog } from './AddWishlistItemDialog';
import { QuoteRequestDialogV2 } from './QuoteRequestDialogV2';
import { QuoteDetailDialog } from './QuoteDetailDialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';

interface WishlistItem {
  id: string;
  vehicle_id: string;
  item_type: 'issue' | 'maintenance' | 'modification';
  item_name: string;
  item_identifier: string;
  description: string | null;
  category: string | null;
  estimated_cost_parts: number;
  estimated_cost_labor: number;
  estimated_labor_hours: number;
  notes: string | null;
  source: string;
  created_at: string;
  updated_at: string;
}

interface WishlistSectionProps {
  vehicleId: string;
}

export function WishlistSection({ vehicleId }: WishlistSectionProps) {
  const queryClient = useQueryClient();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<WishlistItem | null>(null);
  const [showMarkComplete, setShowMarkComplete] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showQuoteDialog, setShowQuoteDialog] = useState(false);
  const [showQuoteHistoryDialog, setShowQuoteHistoryDialog] = useState(false);
  const [selectedQuote, setSelectedQuote] = useState<any>(null);
  const [showQuoteDetailDialog, setShowQuoteDetailDialog] = useState(false);

  const { data: wishlistItems = [], isLoading: loading } = useQuery({
    queryKey: ['wishlist', vehicleId],
    queryFn: async () => {
      const response = await fetch(`/api/v1/wishlist?vehicleId=${vehicleId}`);
      const data = await response.json();
      if (!response.ok) throw new Error('Failed to load wishlist');
      return data.wishlistItems || [];
    },
    staleTime: 0,
  });

  const { data: quoteHistory = [], isLoading: loadingQuotes } = useQuery({
    queryKey: ['quoteHistory', vehicleId],
    queryFn: async () => {
      const result = await getQuoteRequestHistory(vehicleId, 50);
      if (result.success && result.data) return result.data;
      return [];
    },
    staleTime: 1000 * 60 * 2,
  });

  /**
   * The item awaiting confirmation — UX-05.
   *
   * ⚠ **A stray tap used to delete a wishlist item, permanently, with no
   * question asked.** The delete control sits 6px from "Done" and carries
   * `.tap-target-44`, whose invisible hit area extends 8px each side — so the
   * last two pixels of "Done" fired Delete instead. No confirmation, no undo,
   * and the row is gone.
   *
   * The phone already asks. Two clients, one destructive action, and only one
   * of them was careful — this codebase's most repeated defect, on the one
   * control here that cannot be taken back.
   */
  const [pendingDelete, setPendingDelete] = useState<WishlistItem | null>(null);

  const handleDelete = async (itemId: string) => {
    try {
      setDeletingId(itemId);
      const response = await fetch(`/api/v1/wishlist?itemId=${itemId}`, { method: 'DELETE' });
      const data = await response.json();
      if (response.ok && data.success) {
        queryClient.invalidateQueries({ queryKey: ['wishlist', vehicleId] });
        toast.success('Item removed from wishlist');
      } else {
        logger.error('WISHLIST_SECTION:DELETE', new Error(data.error || 'Delete failed'));
        toast.error(data.error || 'Failed to remove item');
      }
    } catch (error) {
      logger.error('WISHLIST_SECTION:DELETE_EXCEPTION', error as Error);
      toast.error('Failed to remove item');
    } finally {
      setDeletingId(null);
    }
  };

  const handleMarkComplete = (item: WishlistItem) => {
    setSelectedItem(item);
    setShowMarkComplete(true);
  };

  const handleCompleteSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ['wishlist', vehicleId] });
    setShowMarkComplete(false);
    setSelectedItem(null);
    toast.success('Item marked as complete!');
  };

  const handleAddSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ['wishlist', vehicleId] });
    setShowAddDialog(false);
    toast.success('Item added to wishlist!');
  };

  const handleViewQuote = (quote: any) => {
    setSelectedQuote(quote);
    setShowQuoteDetailDialog(true);
  };

  const handleQuoteSaved = async () => {
    queryClient.invalidateQueries({ queryKey: ['quoteHistory', vehicleId] });
  };

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'issue': return <AlertTriangle className="h-4 w-4 text-orange-400" />;
      case 'modification': return <Sparkles className="h-4 w-4 text-amber-400" />;
      case 'maintenance': return <Wrench className="h-4 w-4 text-blue-400" />;
      default: return <Wrench className="h-4 w-4 text-white/40" />;
    }
  };

  const getTypeBadge = (type: string) => {
    switch (type) {
      case 'issue': return <Badge className="bg-orange-500/12 text-orange-300 border border-orange-400/25 text-xs px-2 py-0.5 font-medium">Issue</Badge>;
      case 'modification': return <Badge className="bg-amber-500/18 text-amber-300 border border-amber-400/40 text-xs px-2 py-0.5 font-semibold" style={{ boxShadow: '0 0 6px rgba(251,191,36,0.18)' }}>Mod</Badge>;
      case 'maintenance': return <Badge className="bg-blue-500/12 text-blue-300 border border-blue-400/25 text-xs px-2 py-0.5 font-medium">Maintenance</Badge>;
      default: return <Badge className="bg-white/8 text-white/50 border border-white/12 text-xs px-2 py-0.5">Other</Badge>;
    }
  };

  const totalEstimate = wishlistItems.reduce((sum: number, item: WishlistItem) => {
    return sum + (item.estimated_cost_parts || 0) + (item.estimated_cost_labor || 0);
  }, 0);

  if (loading) {
    return (
      <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-4 sm:p-6">
        <div className="flex items-center justify-between mb-5">
          <div className="h-6 w-24 bg-white/8 rounded-lg animate-pulse" />
          <div className="h-8 w-24 bg-white/5 rounded-lg animate-pulse" />
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-20 bg-white/5 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="bg-slate-900/60 border border-white/10 rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 sm:px-6 py-5 border-b border-white/8">
          <div className="flex items-center gap-3">
            <ListChecks className="h-5 w-5 text-info" />
            <div>
              <h2 className="text-base font-semibold text-white leading-tight">Wishlist</h2>
              {wishlistItems.length > 0 && (
                <p className="text-xs text-white/50 mt-0.5">
                  {wishlistItems.length} item{wishlistItems.length !== 1 ? 's' : ''}{totalEstimate > 0 ? ` · Est. ${formatCurrency(totalEstimate)}` : ''}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {quoteHistory.length > 0 && (
              <Button
                onClick={() => setShowQuoteHistoryDialog(true)}
                variant="ghost"
                size="sm"
                className="text-white/50 hover:text-white hover:bg-white/8 h-8 px-3 text-xs gap-1.5"
              >
                <History className="h-3.5 w-3.5" />
                {quoteHistory.length} Quote{quoteHistory.length !== 1 ? 's' : ''}
              </Button>
            )}
            <Button
              onClick={() => setShowAddDialog(true)}
              size="sm"
              className="bg-primary hover:bg-primary/90 text-primary-foreground h-8 px-3 text-xs gap-1.5 rounded-lg"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Item
            </Button>
          </div>
        </div>

        {wishlistItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 px-4 sm:px-6 text-center">
            <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-4">
              <ListChecks className="h-6 w-6 text-white/25" />
            </div>
            <p className="text-sm font-medium text-white/50 mb-1">Your wishlist is empty</p>
            <p className="text-xs text-white/50 mb-5 max-w-xs leading-relaxed">
              Track repairs, upgrades, and modifications you want done on your vehicle.
            </p>
            <Button
              onClick={() => setShowAddDialog(true)}
              size="sm"
              className="bg-primary hover:bg-primary/90 text-primary-foreground h-9 px-4 text-xs gap-1.5 rounded-xl"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Your First Item
            </Button>
          </div>
        ) : (
          <>
            <div className="divide-y divide-white/6">
              {wishlistItems.map((item: WishlistItem) => {
                const totalCost = (item.estimated_cost_parts || 0) + (item.estimated_cost_labor || 0);

                return (
                  <div
                    key={item.id}
                    className="px-4 sm:px-6 py-4 hover:bg-white/3 transition-colors group/item"
                  >
                    <div className="flex items-start gap-4">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${
                        item.item_type === 'modification'
                          ? 'bg-amber-500/12 border border-amber-400/30'
                          : 'bg-white/5 border border-white/8'
                      }`}>
                        {getTypeIcon(item.item_type)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <h3 className="text-sm font-semibold text-white leading-snug">{item.item_name}</h3>
                          {getTypeBadge(item.item_type)}
                        </div>
                        {item.description && (
                          <p className="text-xs text-white/55 mb-2 leading-relaxed">{item.description}</p>
                        )}
                        <div className="flex flex-wrap gap-3 text-xs text-white/50">
                          {totalCost > 0 && (
                            <span className="font-medium text-white/60">{formatCurrency(totalCost)} est.</span>
                          )}
                          {item.estimated_labor_hours > 0 && (
                            <span>{item.estimated_labor_hours}h labor</span>
                          )}
                          {item.category && (
                            <span>{item.category}</span>
                          )}
                          {item.notes && (
                            <span className="italic text-white/50">{item.notes}</span>
                          )}
                        </div>
                      </div>
                      {/* RB0 rule 4. `opacity-0` is dropped rather than kept
                          alongside `.reveal-on-hover`: the touch pin is
                          `@media (hover: none) { .reveal-on-hover { opacity: 1 } }`
                          at (0,1,0), and a Tailwind `.opacity-0` is also
                          (0,1,0) — a specificity tie decided by source order,
                          which is not something to leave to a build. The named
                          group still reveals it on hover at (0,2,0).

                          These are Mark complete and delete on a wishlist row,
                          and on a phone they were the only path to either. */}
                      <div className="reveal-on-hover flex items-center gap-1.5 flex-shrink-0 group-hover/item:opacity-100 transition-opacity">
                        <Button
                          size="sm"
                          onClick={() => handleMarkComplete(item)}
                          className="bg-green-500/10 text-green-400 border border-green-400/25 hover:bg-green-500/20 h-7 px-2.5 text-xs gap-1"
                        >
                          <CheckCircle className="h-3.5 w-3.5" />
                          Done
                        </Button>
                        <button
                          /*
                            UX-05. Asks first. The overlapping hit areas are
                            worth fixing too, but a confirmation is what makes
                            the mistake recoverable rather than merely less
                            likely.
                          */
                          onClick={() => setPendingDelete(item)}
                          disabled={deletingId === item.id}
                          className="tap-target-44 w-7 h-7 flex items-center justify-center rounded-lg text-white/25 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                          aria-label="Remove item"
                        >
                          {deletingId === item.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="px-4 sm:px-6 py-4 border-t border-white/8 sticky bottom-0 bg-[#0d1117]/95 backdrop-blur-sm z-10">
              <Button
                onClick={() => setShowQuoteDialog(true)}
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground h-11 rounded-xl text-sm font-semibold gap-2 transition-all hover:scale-[1.005] shadow-lg shadow-cyan-900/30"
              >
                <FileText className="h-4 w-4" />
                Get Quote for {wishlistItems.length} {wishlistItems.length === 1 ? 'Item' : 'Items'}
              </Button>
            </div>
          </>
        )}
      </div>

      {selectedItem && (
        <MarkCompleteDialog
          open={showMarkComplete}
          onOpenChange={setShowMarkComplete}
          wishlistItem={selectedItem}
          onSuccess={handleCompleteSuccess}
        />
      )}

      <AddWishlistItemDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        vehicleId={vehicleId}
        onSuccess={handleAddSuccess}
      />

      <QuoteRequestDialogV2
        open={showQuoteDialog}
        onOpenChange={setShowQuoteDialog}
        vehicleId={vehicleId}
        wishlistItems={wishlistItems.map((item: WishlistItem) => ({
          id: item.id,
          description: item.item_name,
          category: item.category || 'repair',
        }))}
        onQuoteSaved={() => {
          toast.success('Quote request saved!');
          handleQuoteSaved();
        }}
      />

      <Dialog open={showQuoteHistoryDialog} onOpenChange={setShowQuoteHistoryDialog}>
        <DialogContent className="max-w-2xl bg-slate-950 border-white/15">
          <DialogHeader>
            <DialogTitle className="text-white">Past Quotes</DialogTitle>
          </DialogHeader>

          <div className="space-y-2 mt-2">
            {loadingQuotes ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-info" />
              </div>
            ) : quoteHistory.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-sm text-white/50">No quotes found</p>
              </div>
            ) : (
              quoteHistory.map((quote) => (
                <Card
                  key={quote.id}
                  className="bg-white/4 border-white/10 hover:border-cyan-400/30 cursor-pointer transition-all"
                  onClick={() => {
                    setShowQuoteHistoryDialog(false);
                    handleViewQuote(quote);
                  }}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-semibold text-white mb-1 truncate">
                          {quote.name || 'Unnamed Quote'}
                        </h3>
                        <div className="flex flex-wrap gap-3 text-xs text-white/50">
                          <span>{formatDate(quote.created_at)}</span>
                          <span>{quote.selected_items?.length || 0} items</span>
                          <span>{quote.zip_code}</span>
                        </div>
                        {(quote.estimated_total_low || quote.estimated_total_high) && (
                          <p className="text-xs font-semibold text-info mt-1.5">
                            {formatCurrency(quote.estimated_total_low)} – {formatCurrency(quote.estimated_total_high)}
                          </p>
                        )}
                      </div>
                      <button className="tap-target-44 w-8 h-8 flex items-center justify-center rounded-lg text-white/30 hover:text-cyan-400 hover:bg-cyan-400/8 transition-colors flex-shrink-0">
                        <Eye className="h-4 w-4" />
                      </button>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      <QuoteDetailDialog
        open={showQuoteDetailDialog}
        onOpenChange={setShowQuoteDetailDialog}
        quote={selectedQuote}
      />

      {/*
        ── ⚠ UX-05 · one stray tap used to delete an item forever ─────────────

        The delete control sits 6px from "Done" and carries `.tap-target-44`,
        whose invisible hit area extends 8px each side — so the last two pixels
        of "Done" fired Delete. No confirmation, no undo, and the row was gone.
        **iOS asks first; web did not.**

        The item is **named** rather than "are you sure?", because the person
        who hit this by accident was reaching for a different button and needs to
        find out *which* row is about to go, not merely that something is.
      */}
      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {pendingDelete?.item_name}?</AlertDialogTitle>
            <AlertDialogDescription>
              It comes off this car&apos;s list. Nothing else changes — any work you have already
              recorded stays in the service history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const item = pendingDelete;
                setPendingDelete(null);
                if (item) void handleDelete(item.id);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
