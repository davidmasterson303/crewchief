import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

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

interface CostBreakdownTableProps {
  costBreakdown: CostEstimate;
}

export function CostBreakdownTable({ costBreakdown }: CostBreakdownTableProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatHours = (hours: number) => {
    return hours.toFixed(1);
  };

  const range = (low: string, high: string) => (low === high ? low : `${low} – ${high}`);

  /*
    Computed once and rendered twice — as a table from `md` up and as a card per
    item below it (R8). The two presentations are genuinely different layouts,
    not one layout with a breakpoint, but they must never be different *numbers*,
    so the arithmetic happens here and neither branch does any of its own.
  */
  const rows = costBreakdown.items.map((item) => ({
    description: item.description,
    notes: item.notes,
    parts: range(formatCurrency(item.parts_cost_low), formatCurrency(item.parts_cost_high)),
    hours: range(formatHours(item.labor_hours_low), formatHours(item.labor_hours_high)),
    laborCost: range(formatCurrency(item.labor_cost_low), formatCurrency(item.labor_cost_high)),
    total: range(
      formatCurrency(item.parts_cost_low + item.labor_cost_low),
      formatCurrency(item.parts_cost_high + item.labor_cost_high)
    ),
  }));

  const estimatedTotal = range(
    formatCurrency(costBreakdown.total_low),
    formatCurrency(costBreakdown.total_high)
  );

  return (
    <Card className="bg-slate-900/50 border-info-border">
      <CardHeader>
        <CardTitle className="text-foreground flex items-center gap-2">
          Cost Breakdown
        </CardTitle>
        <div className="flex items-start gap-2 text-sm text-muted-foreground">
          <Info className="h-4 w-4 text-info mt-0.5 flex-shrink-0" />
          <span>{costBreakdown.regional_labor_rate}</span>
        </div>
      </CardHeader>
      <CardContent>
        {/*
          R8 — below `md` this is a card per line item, not a table.

          Five columns, each carrying a low *and* a high figure, inside a
          wrapper whose 231px of content at 375px is already the product of four
          nested gutters. The wrapper is `overflow-hidden`, so the usual escape
          hatch is closed on purpose and stays closed: a sideways-scrolling
          estimate is not an answer either. This is the artefact the consultant
          produces to justify a number — it *is* the answer — and on a phone it
          was a stack of clipped numerals.

          Same data, same order, no horizontal scroll. The table returns at `md`
          where scanning a column is the point.
        */}
        <div className="md:hidden space-y-3">
          {rows.map((row, index) => (
            <div key={index} className="border border-info-border rounded-lg p-3.5 bg-black/20">
              <p className="text-[15px] font-medium text-foreground leading-snug">{row.description}</p>

              {row.notes && (
                /*
                  A tooltip on touch is a hover affordance with no hover, so the
                  note is simply shown here. It is one line of context on an
                  estimate someone is about to spend money against — the desktop
                  table can afford to tuck it away, a phone cannot.
                */
                <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">{row.notes}</p>
              )}

              <dl className="mt-3 space-y-1.5 text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground">Parts</dt>
                  <dd className="num text-right">{row.parts}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground">Labor</dt>
                  <dd className="num text-right">
                    {row.hours} hr · {row.laborCost}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3 border-t border-info-border pt-1.5">
                  <dt className="font-semibold text-foreground">Total</dt>
                  <dd className="num text-right font-semibold text-info-strong">{row.total}</dd>
                </div>
              </dl>
            </div>
          ))}

          <div className="flex items-center justify-between gap-3 border border-info-border rounded-lg bg-info-wash px-3.5 py-3">
            <span className="font-bold text-info">Estimated Total</span>
            <span className="num font-bold text-info-strong text-right">{estimatedTotal}</span>
          </div>
        </div>

        <div className="hidden md:block border border-info-border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-info-border hover:bg-cyan-400/5">
                <TableHead className="text-info-strong text-xs uppercase tracking-[0.04em] font-semibold">Item</TableHead>
                <TableHead className="text-info-strong text-xs uppercase tracking-[0.04em] font-semibold text-right">Parts</TableHead>
                <TableHead className="text-info-strong text-xs uppercase tracking-[0.04em] font-semibold text-right">Labor Hrs</TableHead>
                <TableHead className="text-info-strong text-xs uppercase tracking-[0.04em] font-semibold text-right">Labor Cost</TableHead>
                <TableHead className="text-info-strong text-xs uppercase tracking-[0.04em] font-semibold text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((item, index) => {
                return (
                  <TableRow key={index} className="border-info-border hover:bg-cyan-400/5">
                    <TableCell className="font-medium">
                      <div className="flex flex-col gap-1">
                        <span>{item.description}</span>
                        {item.notes && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="text-xs text-muted-foreground cursor-help flex items-center gap-1">
                                  <Info className="h-3 w-3" />
                                  Estimate details
                                </span>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs">
                                <p className="text-xs">{item.notes}</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="num text-right text-sm">{item.parts}</TableCell>
                    <TableCell className="num text-right text-sm">{item.hours}</TableCell>
                    <TableCell className="num text-right text-sm">{item.laborCost}</TableCell>
                    <TableCell className="num text-right text-sm font-semibold">{item.total}</TableCell>
                  </TableRow>
                );
              })}
              <TableRow className="border-t-2 border-info-border bg-info-wash hover:bg-info-wash">
                <TableCell colSpan={4} className="font-bold text-info text-right">
                  Estimated Total
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex flex-col">
                    <Badge variant="outline" className="justify-center rounded-full border-transparent bg-info-wash text-info-strong px-3.5 py-1.5 font-bold tabular-nums">
                      {estimatedTotal}
                    </Badge>
                  </div>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>

        <div className="mt-4 text-xs text-muted-foreground space-y-1">
          <p>• These are estimated ranges based on typical market pricing and regional labor rates.</p>
          <p>• Actual prices may vary by shop, parts availability, and vehicle condition.</p>
          <p>• Use this breakdown to compare quotes from different shops.</p>
        </div>
      </CardContent>
    </Card>
  );
}
