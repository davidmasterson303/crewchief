'use client';

import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Calendar, DollarSign, FileText, MapPin, Wrench, Hash, Package } from 'lucide-react';
import { useSignedUrl } from '@/hooks/useSignedUrl';

interface MaintenanceItemDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: {
    id: string;
    description: string;
    date_completed: string;
    shop_name?: string;
    cost_labor?: number;
    cost_parts?: number;
    total_cost?: number;
    part_number?: string;
    quantity?: number;
    unit_cost?: number;
    is_combined?: boolean;
    category?: string;
    notes?: string;
    location_zone?: string;
  };
  invoiceUrl?: string;
}

export default function MaintenanceItemDetailsDialog({
  open,
  onOpenChange,
  item,
  invoiceUrl,
}: MaintenanceItemDetailsDialogProps) {
  const totalCost = item.total_cost || (item.cost_labor || 0) + (item.cost_parts || 0);

  /*
    On failure this used to fall back to `invoiceUrl` itself — the stored
    `placeholder://…` path, rendered as an href. That link could not work: it
    is not a URL, and the bucket behind it is private. The shared hook returns
    undefined instead, and the row below simply does not render.
  */
  const signedUrl = useSignedUrl(invoiceUrl);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg bg-[#0f1318] border-white/10 overflow-y-auto">
        <SheetHeader className="pb-4 border-b border-white/8">
          <SheetTitle className="text-white text-lg leading-snug pr-6">{item.description}</SheetTitle>
          {item.category && (
            <Badge variant="outline" className="w-fit capitalize bg-info-wash text-info border-info-border text-xs">
              {item.category}
            </Badge>
          )}
        </SheetHeader>

        <div className="space-y-5 pt-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 bg-white/4 rounded-xl border border-white/8">
              <p className="text-xs text-white/45 flex items-center gap-1.5 mb-1.5 font-medium uppercase tracking-wide">
                <Calendar className="h-3.5 w-3.5" />
                Service Date
              </p>
              <p className="text-sm font-semibold text-white">
                {item.date_completed ? new Date(item.date_completed).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
              </p>
            </div>

            {item.shop_name && (
              <div className="p-3 bg-white/4 rounded-xl border border-white/8">
                <p className="text-xs text-white/45 flex items-center gap-1.5 mb-1.5 font-medium uppercase tracking-wide">
                  <MapPin className="h-3.5 w-3.5" />
                  Shop
                </p>
                <p className="text-sm font-semibold text-white">{item.shop_name}</p>
              </div>
            )}

            {item.part_number && (
              <div className="p-3 bg-white/4 rounded-xl border border-white/8">
                <p className="text-xs text-white/45 flex items-center gap-1.5 mb-1.5 font-medium uppercase tracking-wide">
                  <Hash className="h-3.5 w-3.5" />
                  Part #
                </p>
                <p className="text-sm font-semibold text-white font-mono">{item.part_number}</p>
              </div>
            )}

            {item.quantity && item.quantity > 1 && (
              <div className="p-3 bg-white/4 rounded-xl border border-white/8">
                <p className="text-xs text-white/45 flex items-center gap-1.5 mb-1.5 font-medium uppercase tracking-wide">
                  <Package className="h-3.5 w-3.5" />
                  Quantity
                </p>
                <p className="text-sm font-semibold text-white">{item.quantity}</p>
              </div>
            )}

            {item.location_zone && (
              <div className="p-3 bg-white/4 rounded-xl border border-white/8">
                <p className="text-xs text-white/45 flex items-center gap-1.5 mb-1.5 font-medium uppercase tracking-wide">
                  <Wrench className="h-3.5 w-3.5" />
                  Zone
                </p>
                <p className="text-sm font-semibold text-white capitalize">{item.location_zone.replace(/_/g, ' ')}</p>
              </div>
            )}
          </div>

          {item.is_combined ? (
            <div className="bg-white/4 border border-white/8 rounded-xl p-4">
              <p className="text-xs font-semibold text-white/50 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                <DollarSign className="h-3.5 w-3.5" />
                Cost Breakdown
              </p>
              <div className="grid grid-cols-3 gap-3">
                <div className="text-center p-3 bg-white/3 rounded-lg">
                  <p className="text-xs text-white/40 mb-1">Labor</p>
                  <p className="text-base font-bold text-white tabular-nums">${(item.cost_labor || 0).toFixed(2)}</p>
                </div>
                <div className="text-center p-3 bg-white/3 rounded-lg">
                  <p className="text-xs text-white/40 mb-1">Parts</p>
                  <p className="text-base font-bold text-white tabular-nums">${(item.cost_parts || 0).toFixed(2)}</p>
                </div>
                <div className="text-center p-3 bg-info-wash border border-info-border rounded-lg">
                  <p className="text-xs text-info/70 mb-1">Total</p>
                  <p className="text-base font-bold text-white tabular-nums">${totalCost.toFixed(2)}</p>
                </div>
              </div>
            </div>
          ) : totalCost > 0 ? (
            <div className="bg-white/4 border border-white/8 rounded-xl p-4">
              <p className="text-xs font-semibold text-white/50 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <DollarSign className="h-3.5 w-3.5" />
                Total Cost
              </p>
              <p className="text-2xl font-bold text-white tabular-nums">${totalCost.toFixed(2)}</p>
              {item.quantity && item.unit_cost && item.quantity > 1 && item.unit_cost > 0 && (
                <p className="text-xs text-white/40 mt-1">{item.quantity} × ${item.unit_cost.toFixed(2)}</p>
              )}
            </div>
          ) : null}

          {item.notes && (
            <div className="bg-white/4 border border-white/8 rounded-xl p-4">
              <p className="text-xs font-semibold text-white/50 uppercase tracking-wide mb-2">Notes</p>
              <p className="text-sm text-white/75 leading-relaxed">{item.notes}</p>
            </div>
          )}

          {invoiceUrl && signedUrl && (
            <a
              href={signedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 p-4 bg-white/4 border border-white/8 rounded-xl hover:border-cyan-400/30 hover:bg-cyan-400/5 transition-all group"
            >
              <div className="w-10 h-10 bg-info-wash border border-info-border rounded-xl flex items-center justify-center flex-shrink-0">
                <FileText className="h-5 w-5 text-cyan-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white group-hover:text-cyan-300 transition-colors">View Invoice PDF</p>
                <p className="text-xs text-white/40">Opens in new tab</p>
              </div>
              <svg className="h-4 w-4 text-white/25 group-hover:text-cyan-400 transition-colors flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </a>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
