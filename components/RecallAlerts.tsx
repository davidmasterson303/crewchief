'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ShieldAlert, ExternalLink, X, ChevronDown, ChevronUp, Check, Loader as Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

interface RecallAlertsProps {
  recalls: any[];
  vehicleId?: string;
  addressedCampaigns?: string[];
  onRecallAddressed?: (campaignNumber: string) => void;
}

export default function RecallAlerts({ recalls, vehicleId, addressedCampaigns = [], onRecallAddressed }: RecallAlertsProps) {
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [addressingId, setAddressingId] = useState<string | null>(null);
  const [localAddressed, setLocalAddressed] = useState<string[]>(addressedCampaigns);

  if (dismissed || !recalls || recalls.length === 0) {
    return null;
  }

  const activeRecalls = recalls.filter(r => !localAddressed.includes(r.NHTSACampaignNumber));
  const addressedCount = localAddressed.filter(id => recalls.some(r => r.NHTSACampaignNumber === id)).length;

  const visibleRecalls = expanded ? activeRecalls : activeRecalls.slice(0, 2);
  const hasMore = activeRecalls.length > 2;

  const handleMarkAddressed = async (campaignNumber: string) => {
    if (!vehicleId || !supabase) return;

    setAddressingId(campaignNumber);
    try {
      const { error } = await supabase
        .from('recall_actions')
        .upsert({
          vehicle_id: vehicleId,
          campaign_number: campaignNumber,
          addressed_at: new Date().toISOString().split('T')[0],
        }, { onConflict: 'vehicle_id,campaign_number' });

      if (error) throw error;

      setLocalAddressed(prev => [...prev, campaignNumber]);
      toast.success('Recall marked as addressed');

      if (onRecallAddressed) {
        onRecallAddressed(campaignNumber);
      }
    } catch (err) {
      toast.error('Failed to mark recall as addressed');
    } finally {
      setAddressingId(null);
    }
  };

  if (activeRecalls.length === 0) {
    return null;
  }

  return (
    <div className="bg-red-500/8 border border-red-400/25 rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-red-400/15">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-red-500/15 border border-red-400/25 flex items-center justify-center flex-shrink-0">
            <ShieldAlert className="h-5 w-5 text-red-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white leading-tight">
              {activeRecalls.length} Active Recall{activeRecalls.length !== 1 ? 's' : ''}
              {addressedCount > 0 && (
                <span className="ml-2 text-xs text-green-400/70 font-normal">({addressedCount} addressed)</span>
              )}
            </h3>
            <p className="text-xs text-red-300/70 mt-0.5">Action may be required</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => window.open('https://www.nhtsa.gov/recalls', '_blank')}
            className="text-red-300/70 hover:text-red-300 hover:bg-red-500/12 h-8 px-3 text-xs gap-1.5"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            NHTSA
          </Button>
          <button
            onClick={() => setDismissed(true)}
            className="tap-target-44 w-7 h-7 flex items-center justify-center rounded-lg text-white/30 hover:text-white/60 hover:bg-white/8 transition-colors"
            aria-label="Dismiss recalls"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="divide-y divide-red-400/10">
        {visibleRecalls.map((recall: any, index: number) => {
          const campaignNum = recall.NHTSACampaignNumber;
          const isAddressing = addressingId === campaignNum;

          return (
            <div key={index} className="px-5 py-4">
              <div className="flex items-start gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-red-400 mt-2 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white leading-snug">
                        {recall.Component || 'Component Unknown'}
                      </p>
                      {recall.Summary && (
                        <p className="text-xs text-white/55 mt-1 leading-relaxed line-clamp-2">
                          {recall.Summary}
                        </p>
                      )}
                      {campaignNum && (
                        <p className="text-xs text-white/50 mt-1.5 font-mono">
                          Campaign #{campaignNum}
                        </p>
                      )}
                    </div>
                    {vehicleId && campaignNum && (
                      <button
                        onClick={() => handleMarkAddressed(campaignNum)}
                        disabled={isAddressing}
                        className="tap-target-44 flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/12 hover:border-white/20 text-white/70 hover:text-white text-xs font-medium transition-all disabled:opacity-50"
                      >
                        {isAddressing ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Check className="h-3.5 w-3.5" />
                        )}
                        Mark addressed
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {hasMore && (
        <div className="px-5 pb-4">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1.5 text-xs text-red-300/60 hover:text-red-300 transition-colors font-medium"
          >
            {expanded ? (
              <>
                <ChevronUp className="h-3.5 w-3.5" />
                Show less
              </>
            ) : (
              <>
                <ChevronDown className="h-3.5 w-3.5" />
                {activeRecalls.length - 2} more recall{activeRecalls.length - 2 !== 1 ? 's' : ''}
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
