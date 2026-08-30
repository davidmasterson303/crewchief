'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader as Loader2, CircleAlert as AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { enrichVehicle, getResearchStatus } from '@/app/actions';
import { logger } from '@wellkept/core/logger';

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
/**
 * How often to ask, and for how long.
 *
 * Four seconds against a measured ~60s of work is about fifteen reads of one
 * column — cheap enough not to think about, frequent enough that the spinner
 * does not outlive the dossier by much. Three minutes is the ceiling: research
 * has three attempts with backoff behind a 30s timeout each, so a run still
 * going at three minutes is not going to finish.
 */
const POLL_EVERY_MS = 4_000;
const POLL_CEILING_MS = 180_000;

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
  const liveRef = useRef(true);

  useEffect(() => {
    liveRef.current = true;
    return () => {
      liveRef.current = false;
    };
  }, []);

  /**
   * Start the research, then ask the database how it went.
   *
   * ── ⚠ Why the action's return value is no longer the answer ───────────────
   *
   * 22 Aug, a real run: a complete dossier and 24 NHTSA recalls were written
   * in about sixty seconds, and this component showed the failure state with a
   * retry button. The request outlived its response, `enrichVehicle` came back
   * with no body, and `result.success` threw on `undefined` —
   * `RESEARCH_STATUS:THREW`, which is what the log said.
   *
   * The work was never the problem. **The answer had nowhere to arrive.**
   * Awaiting one long response gives the client exactly one chance to hear the
   * outcome, spent on the leg most likely to be cut — and the outcome is
   * sitting in `research_status` the entire time.
   *
   * So the call still happens, because §11's rule stands: work started and
   * abandoned on a serverless platform may be frozen with the response, so it
   * needs a request that owns it. What changed is that its return value is now
   * a *hint*, and the database is the verdict.
   *
   * ⚠ A rejected call is deliberately not a failure any more. The most likely
   * reason for one is the timeout above, and that happens while the work is
   * succeeding.
   */
  async function run() {
    if (startedRef.current) return;
    startedRef.current = true;
    setRunning(true);
    setFailed(false);

    try {
      const result = await enrichVehicle(vehicleId);

      if (result?.success) {
        onComplete();
        return;
      }

      /*
        A returned failure is real — the server reached the end and said so —
        but it is still not the last word, because `enrichVehicle` can report
        failure for a dossier that has since completed. Fall through and ask.
      */
      logger.warn('RESEARCH_STATUS:REPORTED_FAILURE', 'Enrichment reported failure; checking the record', {
        vehicleId,
        error: result?.error,
      });
    } catch (error) {
      logger.warn('RESEARCH_STATUS:NO_RESPONSE', 'Enrichment returned nothing; checking the record', {
        vehicleId,
        error: (error as Error)?.message,
      });
    }

    await waitForRecord();
  }

  /**
   * Poll `research_status` until it settles.
   *
   * `completed` finishes, `failed` is the only thing that shows the retry
   * button, and the ceiling exists so a job that never settles does not leave
   * a spinner up forever — that would be the §21 problem again, a UI implying
   * something it cannot support.
   */
  async function waitForRecord() {
    const deadline = Date.now() + POLL_CEILING_MS;
    let first = true;

    while (Date.now() < deadline) {
      /*
        ⚠ Read **before** the first wait. By the time the call above settled,
        the work it started may already have finished — that is precisely the
        case this whole mechanism exists for. Sleeping first would sit on a
        spinner for four seconds with the answer already in the database.
      */
      if (!first) {
        await new Promise((resolve) => setTimeout(resolve, POLL_EVERY_MS));
      }
      first = false;

      // The user navigated away. Nothing below should touch state.
      if (!liveRef.current) return;

      const record = await getResearchStatus(vehicleId);
      if (!record.success) continue;

      if (record.status === 'completed') {
        setRunning(false);
        startedRef.current = false;
        onComplete();
        return;
      }

      if (record.status === 'failed') {
        setRunning(false);
        startedRef.current = false;
        setFailed(true);
        logger.error('RESEARCH_STATUS:FAILED', new Error('research_status = failed'), { vehicleId });
        return;
      }
    }

    if (!liveRef.current) return;

    /*
      Still `pending` at the ceiling. Reported as failed because that is what
      the user can act on — the retry button — and the guard in
      `researchVehicleDossier` means pressing it costs nothing if the dossier
      turned up in the meantime.
    */
    setRunning(false);
    startedRef.current = false;
    setFailed(true);
    logger.error('RESEARCH_STATUS:NEVER_SETTLED', new Error('research_status still pending'), {
      vehicleId,
      waitedMs: POLL_CEILING_MS,
    });
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
