'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DollarSign, Check, Fuel, ShieldCheck, Gauge } from 'lucide-react';
import { updateVehicleTCOFields } from '@/app/actions';

interface TCOInputsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vehicleId: string;
  vehicle: any;
  onSaved?: (updated: { purchase_price: number | null; avg_mpg: number | null; fuel_price_per_gallon: number | null; insurance_monthly: number | null }) => void;
}

const FIELDS = [
  { key: 'purchase_price', label: 'Purchase Price', placeholder: 'e.g. 28000', prefix: '$', icon: DollarSign, hint: 'What you paid (or market value)' },
  { key: 'avg_mpg', label: 'Average MPG', placeholder: 'e.g. 28', prefix: null, icon: Gauge, hint: 'Combined city/highway estimate' },
  { key: 'fuel_price_per_gallon', label: 'Fuel Price / Gallon', placeholder: 'e.g. 3.89', prefix: '$', icon: Fuel, hint: 'Your local average' },
  { key: 'insurance_monthly', label: 'Monthly Insurance', placeholder: 'e.g. 120', prefix: '$', icon: ShieldCheck, hint: 'Full coverage monthly premium' },
] as const;

type FieldKey = typeof FIELDS[number]['key'];

export default function TCOInputsModal({ open, onOpenChange, vehicleId, vehicle, onSaved }: TCOInputsModalProps) {
  const [fields, setFields] = useState({
    purchase_price: '',
    avg_mpg: '',
    fuel_price_per_gallon: '',
    insurance_monthly: '',
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (vehicle) {
      setFields({
        purchase_price: vehicle.purchase_price != null ? String(vehicle.purchase_price) : '',
        avg_mpg: vehicle.avg_mpg != null ? String(vehicle.avg_mpg) : '',
        fuel_price_per_gallon: vehicle.fuel_price_per_gallon != null ? String(vehicle.fuel_price_per_gallon) : '',
        insurance_monthly: vehicle.insurance_monthly != null ? String(vehicle.insurance_monthly) : '',
      });
    }
  }, [vehicle?.id, open]);

  async function handleSave() {
    setSaving(true);
    try {
      const parsed = {
        purchase_price: fields.purchase_price ? parseFloat(fields.purchase_price) : null,
        avg_mpg: fields.avg_mpg ? parseFloat(fields.avg_mpg) : null,
        fuel_price_per_gallon: fields.fuel_price_per_gallon ? parseFloat(fields.fuel_price_per_gallon) : null,
        insurance_monthly: fields.insurance_monthly ? parseFloat(fields.insurance_monthly) : null,
      };
      await updateVehicleTCOFields(vehicleId, parsed);
      setSaved(true);
      onSaved?.(parsed);
      setTimeout(() => {
        setSaved(false);
        onOpenChange(false);
      }, 1200);
    } catch {
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-900 border-white/10 max-w-md w-full">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white text-base">
            <DollarSign className="h-5 w-5 text-info" />
            Cost of Ownership Inputs
          </DialogTitle>
          <p className="text-xs text-white/50 mt-1">
            These figures power your real-world cost-per-mile and TCO breakdown.
          </p>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {FIELDS.map(({ key, label, placeholder, prefix, icon: Icon, hint }) => (
            <div key={key} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <Icon className="h-3.5 w-3.5 text-white/35" />
                <label className="text-xs font-medium text-white/50 uppercase tracking-wider">{label}</label>
              </div>
              <div className="relative">
                {prefix && (
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-white/50 pointer-events-none select-none">
                    {prefix}
                  </span>
                )}
                <Input
                  type="number"
                  inputMode="decimal"
                  placeholder={placeholder}
                  value={fields[key as FieldKey]}
                  onChange={e => setFields(prev => ({ ...prev, [key]: e.target.value }))}
                  className={`bg-white/5 border-white/10 text-white placeholder:text-white/50 focus:border-cyan-400/50 h-10 ${prefix ? 'pl-7' : ''}`}
                />
              </div>
              <p className="text-xs text-white/50 leading-none">{hint}</p>
            </div>
          ))}
        </div>

        <div className="flex gap-3 mt-6">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="flex-1 border-white/12 text-white/50 hover:text-white hover:bg-white/6 text-sm"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || saved}
            className={`flex-1 text-sm transition-all duration-200 ${saved ? 'bg-emerald-600 hover:bg-emerald-600 text-white' : 'bg-cyan-600 hover:bg-cyan-500 text-white'}`}
          >
            {saved ? (
              <><Check className="h-4 w-4 mr-1.5" />Saved</>
            ) : saving ? (
              'Saving...'
            ) : (
              'Save Changes'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
