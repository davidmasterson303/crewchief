'use client';

import { SCHEDULE_BASIS_LABELS } from '@crewchief/core/service-provenance';
import MaintenanceItemCard from '@/components/MaintenanceItemCard';

interface MaintenanceItem {
  item: string;
  [key: string]: unknown;
}

interface MaintenanceTabProps {
  schedule: MaintenanceItem[];
  vehicleId: string;
  savedItemNames: Set<string>;
  loading: boolean;
  onAddToHistory: (itemName: string) => void;
  onWishlistToggleComplete: () => Promise<void>;
}

export default function MaintenanceTab({
  schedule,
  vehicleId,
  savedItemNames,
  loading,
  onAddToHistory,
  onWishlistToggleComplete,
}: MaintenanceTabProps) {
  if (schedule.length === 0) {
    return <p className="text-sm text-white/60 text-center py-8">No maintenance schedule available.</p>;
  }

  return (
    <div className="space-y-3">
      {/*
        ── ⚠ UX-16 / D11 · provenance the phone had and the web did not ──────

        `ServiceMilestoneScreen` has rendered
        `SCHEDULE_BASIS_LABELS['generated-schedule']` under its schedule since
        the provenance module was written. This tab renders the same
        `maintenance_schedule` array, from the same column, and said nothing —
        so the identical list of intervals read as manufacturer fact on the web
        and as an AI-generated typical schedule on the phone.

        That is this codebase's most repeated defect, and the fix is to read the
        same constant rather than to write a second sentence. The wording is
        deliberately "typical" rather than "manufacturer-recommended": we do not
        hold a manufacturer document, we hold a model's account of one, and
        `service-provenance.ts` carries that argument.
      */}
      <p className="text-xs text-white/50">{SCHEDULE_BASIS_LABELS['generated-schedule']}</p>

      {schedule.map((item) => (
        <MaintenanceItemCard
          key={item.item}
          item={item}
          vehicleId={vehicleId}
          isInWishlist={savedItemNames.has(item.item)}
          onAddToHistory={onAddToHistory}
          onWishlistToggleComplete={onWishlistToggleComplete}
          loading={loading}
        />
      ))}
    </div>
  );
}
