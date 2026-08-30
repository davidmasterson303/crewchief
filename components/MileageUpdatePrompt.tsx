'use client';

import { AlertCircle } from 'lucide-react';
import { calculateMileageUpdateStatus, formatMileagePromptMessage } from '@wellkept/core/mileage-tracking';

interface MileageUpdatePromptProps {
  vehicle: {
    current_mileage: number;
    avg_miles_per_month: number | null;
    last_mileage_update_date: string | null;
  };
  onUpdateClick: () => void;
}

export function MileageUpdatePrompt({ vehicle, onUpdateClick }: MileageUpdatePromptProps) {
  const status = calculateMileageUpdateStatus(vehicle);

  if (!status.isDue) {
    return null;
  }

  return (
    <button
      onClick={onUpdateClick}
      className="w-full bg-white/40 border-l-4 border-cyan-500 p-3 flex items-start gap-3 hover:bg-white/50 transition-colors text-left"
    >
      <AlertCircle className="h-5 w-5 text-cyan-600 flex-shrink-0 mt-0.5" />
      <div className="flex-1">
        <p className="text-sm font-medium text-gray-900">
          {formatMileagePromptMessage(status)}
        </p>
        <p className="text-xs text-muted-foreground mt-1">Tap to update mileage</p>
      </div>
    </button>
  );
}
