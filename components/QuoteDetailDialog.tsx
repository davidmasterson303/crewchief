'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import {
  Copy,
  Mail,
  FileText,
  DollarSign,
  Calendar,
  MapPin,
  Package,
} from 'lucide-react';
import { CostEstimateBreakdown } from './CostEstimateBreakdown';

interface CostEstimateItem {
  description: string;
  parts_cost_low: number;
  parts_cost_high: number;
  labor_hours_low: number;
  labor_hours_high: number;
  labor_cost_low: number;
  labor_cost_high: number;
  notes: string;
}

interface CostEstimate {
  items: CostEstimateItem[];
  regional_labor_rate: string;
  total_low: number;
  total_high: number;
}

interface QuoteRequestData {
  id: string;
  name: string | null;
  selected_items: any[];
  zip_code: string;
  additional_notes: string | null;
  email_draft: string;
  estimated_total_low: number;
  estimated_total_high: number;
  cost_breakdown: CostEstimate;
  created_at: string;
}

interface QuoteDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quote: QuoteRequestData | null;
}

export function QuoteDetailDialog({
  open,
  onOpenChange,
  quote,
}: QuoteDetailDialogProps) {
  const { toast } = useToast();

  if (!quote) return null;

  const handleCopyEmail = async () => {
    try {
      await navigator.clipboard.writeText(quote.email_draft);
      toast({
        title: 'Email copied',
        description: 'The email draft has been copied to your clipboard.',
      });
    } catch (error) {
      toast({
        title: 'Failed to copy',
        description: 'Please select and copy the text manually.',
        variant: 'destructive',
      });
    }
  };

  const handleCopyBreakdown = async () => {
    try {
      const breakdownText = `Quote: ${quote.name || 'Unnamed Quote'}\n\nCost Breakdown:\n$${quote.estimated_total_low.toFixed(2)} - $${quote.estimated_total_high.toFixed(2)}`;
      await navigator.clipboard.writeText(breakdownText);
      toast({
        title: 'Breakdown copied',
        description: 'The cost breakdown has been copied to your clipboard.',
      });
    } catch (error) {
      toast({
        title: 'Failed to copy',
        description: 'Please select and copy the text manually.',
        variant: 'destructive',
      });
    }
  };

  const createdDate = new Date(quote.created_at).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const createdTime = new Date(quote.created_at).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] lg:max-w-3xl bg-slate-950 border-info-border">
        <DialogHeader>
          <DialogTitle className="text-info text-2xl">
            {quote.name || 'Unnamed Quote'}
          </DialogTitle>
          <DialogDescription className="text-slate-400 text-base">
            Created on {createdDate} at {createdTime}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Card className="border-info-border bg-slate-900/50">
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center gap-2 text-info">
                  <DollarSign className="h-4 w-4" />
                  <span className="text-xs font-medium">Estimated Cost</span>
                </div>
                <div className="text-lg font-semibold text-slate-200">
                  ${quote.estimated_total_low.toFixed(2)} - ${quote.estimated_total_high.toFixed(2)}
                </div>
              </CardContent>
            </Card>

            <Card className="border-info-border bg-slate-900/50">
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center gap-2 text-info">
                  <Package className="h-4 w-4" />
                  <span className="text-xs font-medium">Service Items</span>
                </div>
                <div className="text-lg font-semibold text-slate-200">
                  {quote.selected_items.length} {quote.selected_items.length === 1 ? 'item' : 'items'}
                </div>
              </CardContent>
            </Card>

            <Card className="border-info-border bg-slate-900/50">
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center gap-2 text-info">
                  <MapPin className="h-4 w-4" />
                  <span className="text-xs font-medium">Zip Code</span>
                </div>
                <div className="text-lg font-semibold text-slate-200">
                  {quote.zip_code}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium flex items-center gap-2 text-info">
                  <FileText className="h-4 w-4" />
                  Cost Breakdown
                </h3>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopyBreakdown}
                  className="gap-2 border-info-border text-info hover:bg-cyan-400/10"
                >
                  <Copy className="h-4 w-4" />
                  Copy
                </Button>
              </div>
              <Card className="border-info-border bg-slate-900/50 overflow-y-auto max-h-[400px]">
                <CardContent className="p-4">
                  {quote.cost_breakdown && (
                    <CostEstimateBreakdown estimate={quote.cost_breakdown} />
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium flex items-center gap-2 text-info">
                  <Mail className="h-4 w-4" />
                  Email Draft
                </h3>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopyEmail}
                  className="gap-2 border-info-border text-info hover:bg-cyan-400/10"
                >
                  <Copy className="h-4 w-4" />
                  Copy
                </Button>
              </div>
              <Card className="border-info-border bg-slate-900/50 overflow-y-auto max-h-[400px]">
                <CardContent className="p-4">
                  <pre className="text-xs whitespace-pre-wrap font-sans text-slate-300">
                    {quote.email_draft}
                  </pre>
                </CardContent>
              </Card>
            </div>
          </div>

          {quote.selected_items && quote.selected_items.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-info">Selected Services</h3>
              <div className="space-y-2">
                {quote.selected_items.map((item, idx) => (
                  <Card
                    key={`${item.id}-${idx}`}
                    className="border-info-border bg-slate-900/50"
                  >
                    <CardContent className="p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <p className="text-sm font-medium text-slate-200">
                            {item.description}
                          </p>
                        </div>
                        {item.category && (
                          <Badge
                            variant="secondary"
                            className="text-xs bg-info-wash text-info border-info-border whitespace-nowrap"
                          >
                            {item.category}
                          </Badge>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {quote.additional_notes && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-info">Additional Notes</h3>
              <Card className="border-info-border bg-slate-900/50">
                <CardContent className="p-4">
                  <p className="text-sm text-slate-300 whitespace-pre-wrap">
                    {quote.additional_notes}
                  </p>
                </CardContent>
              </Card>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            onClick={() => onOpenChange(false)}
            className="w-full bg-cyan-600 hover:bg-cyan-700 text-white"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
