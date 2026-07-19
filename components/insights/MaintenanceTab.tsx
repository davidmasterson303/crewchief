'use client';

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
