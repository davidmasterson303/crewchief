'use client';

import { useEffect, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle } from 'lucide-react';
import { fetchPowertrainOptions } from '@/app/actions';

interface PowertrainSelectorProps {
  year: number;
  make: string;
  model: string;
  trim?: string;
  engineType: string;
  transmissionType: string;
  drivetrain: string;
  onEngineChange: (value: string) => void;
  onTransmissionChange: (value: string) => void;
  onDrivetrainChange: (value: string) => void;
}

interface PowertrainOptions {
  engine_options: string[];
  transmission_options: string[];
  drivetrain_options: string[];
}

export default function PowertrainSelector({
  year,
  make,
  model,
  trim,
  engineType,
  transmissionType,
  drivetrain,
  onEngineChange,
  onTransmissionChange,
  onDrivetrainChange,
}: PowertrainSelectorProps) {
  const [options, setOptions] = useState<PowertrainOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadOptions() {
      setLoading(true);
      setError(false);

      const result = await fetchPowertrainOptions(year, make, model, trim);

      if (cancelled) return;

      if (result.success && result.data) {
        setOptions(result.data);

        if (result.data.engine_options.length === 1 && !engineType) {
          onEngineChange(result.data.engine_options[0]);
        }
        if (result.data.transmission_options.length === 1 && !transmissionType) {
          onTransmissionChange(result.data.transmission_options[0]);
        }
        if (result.data.drivetrain_options.length === 1 && !drivetrain) {
          onDrivetrainChange(result.data.drivetrain_options[0]);
        }
      } else {
        setError(true);
      }

      setLoading(false);
    }

    loadOptions();

    return () => {
      cancelled = true;
    };
  }, [year, make, model, trim]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div>
          <Label>Engine</Label>
          <Skeleton className="h-10 w-full mt-1" />
        </div>
        <div>
          <Label>Transmission</Label>
          <Skeleton className="h-10 w-full mt-1" />
        </div>
        <div>
          <Label>Drivetrain</Label>
          <Skeleton className="h-10 w-full mt-1" />
        </div>
        <p className="text-sm text-slate-500">Loading factory configurations...</p>
      </div>
    );
  }

  if (error || !options) {
    return (
      <div className="flex items-center gap-2 text-sm text-amber-600 bg-amber-50 p-3 rounded-lg border border-amber-200">
        <AlertCircle className="h-4 w-4 flex-shrink-0" />
        <span>Could not load powertrain options. This step will be skipped.</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {options.engine_options.length > 1 && (
        <div>
          <Label>Engine *</Label>
          <Select value={engineType} onValueChange={onEngineChange}>
            <SelectTrigger className="mt-1">
              <SelectValue placeholder="Select engine type" />
            </SelectTrigger>
            <SelectContent>
              {options.engine_options.map((opt) => (
                <SelectItem key={opt} value={opt}>
                  {opt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {options.transmission_options.length > 1 && (
        <div>
          <Label>Transmission *</Label>
          <Select value={transmissionType} onValueChange={onTransmissionChange}>
            <SelectTrigger className="mt-1">
              <SelectValue placeholder="Select transmission" />
            </SelectTrigger>
            <SelectContent>
              {options.transmission_options.map((opt) => (
                <SelectItem key={opt} value={opt}>
                  {opt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {options.drivetrain_options.length > 1 && (
        <div>
          <Label>Drivetrain *</Label>
          <Select value={drivetrain} onValueChange={onDrivetrainChange}>
            <SelectTrigger className="mt-1">
              <SelectValue placeholder="Select drivetrain" />
            </SelectTrigger>
            <SelectContent>
              {options.drivetrain_options.map((opt) => (
                <SelectItem key={opt} value={opt}>
                  {opt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {options.engine_options.length <= 1 &&
        options.transmission_options.length <= 1 &&
        options.drivetrain_options.length <= 1 && (
          <p className="text-sm text-slate-500">
            Only one configuration available for this vehicle. Auto-selected.
          </p>
        )}
    </div>
  );
}
