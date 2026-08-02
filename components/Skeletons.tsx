import { Skeleton } from '@/components/ui/skeleton';
import { Card } from '@/components/ui/card';

/**
 * Ragged line lengths for placeholder text.
 *
 * Uniform full-width bars read as a loading *graphic* — a spinner in bar
 * form. Varying the lengths reads as text arriving, because real prose does
 * not end flush. Cycled so a block of any length still looks irregular.
 */
const TEXT_LINE_WIDTHS = ['w-full', 'w-[70%]', 'w-[86%]', 'w-[60%]'] as const;

export function textLineWidth(index: number): string {
  return TEXT_LINE_WIDTHS[index % TEXT_LINE_WIDTHS.length];
}

export function VehicleCardSkeleton() {
  return (
    <Card className="p-4 sm:p-6 space-y-4">
      <div className="flex items-start justify-between">
        <div className="space-y-2 flex-1">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-32" />
        </div>
        <Skeleton className="h-12 w-12 rounded-full" />
      </div>
      <Skeleton className="h-20 w-full" />
      <div className="flex gap-2">
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-8 w-20" />
      </div>
    </Card>
  );
}

export function ServiceItemsSkeleton() {
  return (
    <Card className="p-4 sm:p-6 space-y-4">
      <Skeleton className="h-6 w-48" />
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="space-y-2 p-3 border rounded">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-full" />
            <div className="flex justify-between">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-16" />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function MaintenanceHistorySkeleton() {
  return (
    <Card className="p-4 sm:p-6 space-y-4">
      <Skeleton className="h-6 w-48" />
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 p-2">
            <Skeleton className="h-10 w-10 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="p-4 space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-16" />
          </Card>
        ))}
      </div>
      <ServiceItemsSkeleton />
      <MaintenanceHistorySkeleton />
    </div>
  );
}

export function IssueCardSkeleton() {
  return (
    <Card className="p-4 space-y-3">
      <Skeleton className="h-5 w-32" />
      {Array.from({ length: 2 }).map((_, i) => (
        <Skeleton key={i} className={`h-4 ${textLineWidth(i)}`} />
      ))}
      <div className="flex gap-2 pt-2">
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-8 w-24" />
      </div>
    </Card>
  );
}

export function QuoteDetailSkeleton() {
  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-2">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-4 w-24" />
      </Card>
      <Card className="p-4 space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex justify-between">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </Card>
    </div>
  );
}

export function ChatMessageSkeleton() {
  return (
    <div className="flex gap-3 mb-4">
      <Skeleton className="h-8 w-8 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-24" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className={`h-3 ${textLineWidth(i)}`} />
        ))}
      </div>
    </div>
  );
}
