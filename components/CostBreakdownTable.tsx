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
        <div className="border border-info-border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-info-border hover:bg-cyan-400/5">
                <TableHead className="text-info-strong text-[11px] uppercase tracking-[0.04em] font-semibold">Item</TableHead>
                <TableHead className="text-info-strong text-[11px] uppercase tracking-[0.04em] font-semibold text-right">Parts</TableHead>
                <TableHead className="text-info-strong text-[11px] uppercase tracking-[0.04em] font-semibold text-right">Labor Hrs</TableHead>
                <TableHead className="text-info-strong text-[11px] uppercase tracking-[0.04em] font-semibold text-right">Labor Cost</TableHead>
                <TableHead className="text-info-strong text-[11px] uppercase tracking-[0.04em] font-semibold text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {costBreakdown.items.map((item, index) => {
                const totalLow = item.parts_cost_low + item.labor_cost_low;
                const totalHigh = item.parts_cost_high + item.labor_cost_high;

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
                    <TableCell className="text-right">
                      <div className="flex flex-col text-sm">
                        <span>{formatCurrency(item.parts_cost_low)}</span>
                        <span className="text-xs text-muted-foreground">to {formatCurrency(item.parts_cost_high)}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-col text-sm">
                        <span>{formatHours(item.labor_hours_low)}</span>
                        <span className="text-xs text-muted-foreground">to {formatHours(item.labor_hours_high)}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-col text-sm">
                        <span>{formatCurrency(item.labor_cost_low)}</span>
                        <span className="text-xs text-muted-foreground">to {formatCurrency(item.labor_cost_high)}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      <div className="flex flex-col">
                        <span>{formatCurrency(totalLow)}</span>
                        <span className="text-xs text-muted-foreground">to {formatCurrency(totalHigh)}</span>
                      </div>
                    </TableCell>
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
                      {formatCurrency(costBreakdown.total_low)} - {formatCurrency(costBreakdown.total_high)}
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
