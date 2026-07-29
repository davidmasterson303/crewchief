'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader as Loader2, CircleAlert as AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { enrichVehicle } from '@/app/actions';
import { logger } from '@crewchief/core/logger';

/**
 * Says what the dossier does not know yet, and does something about it.
 *
 * ── The two things this exists to prevent ───────────────────────────────────
 *
 * Onboarding no longer blocks on a ~23s research call, so a brand-new vehicle
 * reaches its dashboard before the AI has said anything about it. That trade
 * is only honest if the gap is *visible*. A vehicle showing a blank dossier
 * with no explanation is the §21 provenance problem in a new costume — a UI
 * implying data it does not have. So: say "researching", and mean it.
 *
 * And when research fails, the user gets a button. A silent empty dossier with
 * no way forward is worse than a slow one.
 *
 * ── Why the work is started from here ───────────────────────────────────────
 *
 * §11 records the wishlist recompute being fire-and-forget on a serverless
 * platform, where work started after a response "may be frozen along with it".
 * Onboarding therefore does **not** kick this off and walk away. This
 * component does, from a live request the browser is holding open, so the work
 * has an owner.
 *
 * The `startedRef` guard matters: React 18 StrictMode double-invokes effects
 * in development, and without it every dashboard visit would fire two Gemini
 * research calls — the unmetered-spend bug §3 already records once.
 */
export function VehicleResearchStatus({
  vehicleId,
  status,
  onComplete,
}: {
  vehicleId: string;
  /** `research_status` from vehicle_knowledge_base. */
  status: string | null | undefined;
  onComplete: () => void;
}) {
  const [running, setRunning] = useState(false);
  const [failed, setFailed] = useState(status === 'failed');
  const startedRef = useRef(false);

  async function run() {
    if (startedRef.current) return;
    startedRef.current = true;
    setRunning(true);
    setFailed(false);

    try {
      const result = await enrichVehicle(vehicleId);
      if (!result.success) {
        setFailed(true);
        logger.error('RESEARCH_STATUS:FAILED', new Error(result.error || 'enrichment failed'), {
          vehicleId,
        });
      } else {
        onComplete();
      }
    } catch (error) {
      setFailed(true);
      logger.error('RESEARCH_STATUS:THREW', error as Error, { vehicleId });
    } finally {
      setRunning(false);
      // Allow an explicit retry to start again, but not an automatic one.
      startedRef.current = false;
    }
  }

  useEffect(() => {
    if (status === 'pending' && !startedRef.current) {
      void run();
    }
    // Only on a genuine status change. `run` is stable enough for this and
    // adding it would re-fire on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, vehicleId]);

  if (status === 'completed' && !failed) return null;

  if (failed) {
    return (
      <div
        className="flex items-center justify-between gap-4 rounded-xl border p-4"
        style={{ background: 'var(--critical-red-wash)', borderColor: 'var(--critical-red-border)' }}
        role="status"
      >
        <div className="flex items-center gap-3">
          <AlertCircle className="h-5 w-5 flex-shrink-0 text-red-400" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium text-foreground">
              We could not finish researching this vehicle
            </p>
            <p className="text-xs text-muted-foreground">
              Everything else works. The dossier will be empty until this succeeds.
            </p>
          </div>
        </div>
        <Button size="sm" onClick={run} disabled={running} className="flex-shrink-0">
          <RefreshCw className={`mr-2 h-3.5 w-3.5 ${running ? 'animate-spin' : ''}`} aria-hidden="true" />
          {running ? 'Retrying…' : 'Retry'}
        </Button>
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-3 rounded-xl border border-info-border bg-info-wash p-4"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="h-5 w-5 flex-shrink-0 animate-spin text-info" aria-hidden="true" />
      <div>
        <p className="text-sm font-medium text-foreground">Still learning about this car</p>
        <p className="text-xs text-muted-foreground">
          Researching common issues, maintenance intervals and recalls. Usually under a minute —
          the rest of the dashboard works now.
        </p>
      </div>
    </div>
  );
}
