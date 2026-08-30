'use client';

import { CheckCircle2, FileText, Loader2 } from 'lucide-react';
import {
  hasScanDetailToNarrate,
  scanExtractedLine,
  scanFilePosition,
  scanStageLabel,
  type ScanProgress,
} from '@wellkept/core/scan-progress';

/**
 * What the invoice scanner is doing, while it does it.
 *
 * ── ⚠ UX-15 · this component used to be a timer with a document on it ───────
 *
 * It took one boolean, `isProcessing`, and ran its own `setInterval` over four
 * hard-coded stages, advancing with `(prev + 1) % steps.length`. Nothing it
 * displayed was observed. Worse than that, the **modulo wrapped**: any upload
 * slower than 8.5 seconds ticked "Processing line items" complete with a green
 * check and then began "Uploading file" again, having already claimed the
 * entire sequence finished. A user watching a slow scan saw the work complete
 * two or three times.
 *
 * ── What it renders now, and where each figure comes from ───────────────────
 *
 * `CODE_HANDOFF_2026-08-24.md` §1.4 asks for the beat to survive and the
 * fiction to go: *"count up the records actually read, name the file being
 * parsed, show the fields extracted as they land."* Every value below is passed
 * in by `DocumentUploadDialog` from state it already held:
 *
 *   - the file name, which it deliberately keeps as the *original* rather than
 *     the reduced copy's — telling somebody their `invoice.jpg` failed as
 *     `invoice.webp` is a small lie in the message they read most closely;
 *   - the position in the queue, which is its loop index;
 *   - the line items, which arrive per file in `result.itemsExtracted` and are
 *     already summed for the completion toast.
 *
 * ⚠ **Two stages, because there are two awaits.** `prepareForUpload` and one
 * `fetch`. Everything the server does inside that request is a single opaque
 * wait from here, and splitting it invented a boundary the client cannot see.
 * `scan-progress.ts` carries the argument.
 *
 * ── The spinner is not a progress bar, and that is deliberate ───────────────
 *
 * There is no percentage here and there cannot honestly be one: the client
 * knows how many files are left but nothing at all about how far through a
 * given model call it is. An indeterminate spinner says "working, duration
 * unknown", which is exactly the state. A bar that fills on a timer says
 * "measured", which is what the old one said and could not support.
 */
export default function InvoiceProcessingLoader({
  isProcessing,
  progress,
}: {
  isProcessing: boolean;
  /**
   * Real state from the upload loop.
   *
   * ⚠ Required. The old signature took an optional `fileName` and invented
   * everything else, which is precisely how it came to display work nobody had
   * reported. A caller that cannot say what is happening should not render this.
   */
  progress: ScanProgress;
}) {
  if (!isProcessing) return null;

  const position = scanFilePosition(progress);
  const extracted = scanExtractedLine(progress);

  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 sm:px-6">
      <div className="mb-8">
        <div className="relative w-24 h-24 mx-auto flex items-center justify-center">
          <div className="absolute inset-0 bg-info-wash rounded-full animate-pulse blur-xl" />
          {/*
            The document mark stays — it says what kind of thing is being worked
            on, which is true. What is gone is the pair of counter-rotating rings
            and the orbiting dot: they depicted a machine working through stages,
            and the stages were fictional. An indeterminate spinner claims only
            that something is in progress.
          */}
          <FileText className="h-12 w-12 text-info relative" aria-hidden="true" />
        </div>
      </div>

      <div className="max-w-md w-full space-y-4">
        {/*
          `aria-live="polite"` rather than a silent visual. The old component
          announced nothing at all to a screen reader — its steps were divs that
          changed colour — so a blind user got a spinner and no account of it.
          Polite so it does not interrupt, and on the container so the stage and
          the count are read as one update rather than two.
        */}
        <div
          className="rounded-lg border border-info-border bg-info-wash p-4 space-y-2"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-2.5">
            <Loader2 className="h-4 w-4 text-info animate-spin flex-shrink-0" aria-hidden="true" />
            <p className="text-sm font-semibold text-info">{scanStageLabel(progress)}</p>
          </div>

          {progress.fileName && (
            <div className="flex items-center gap-2 min-w-0">
              <FileText className="h-3.5 w-3.5 text-white/50 flex-shrink-0" aria-hidden="true" />
              <p className="text-sm text-white/70 truncate">{progress.fileName}</p>
            </div>
          )}
        </div>

        {/*
          ⚠ Rendered only when there is something true to put in it — handoff
          §1.4, "show nothing rather than a timer". A single file with nothing
          back yet has exactly one true thing to say, and it is already said
          above; this block stays absent rather than holding open a slot for
          figures that do not exist.
        */}
        {hasScanDetailToNarrate(progress) && (
          <div className="space-y-2">
            {position && (
              <div className="flex items-center gap-2.5 p-3 rounded-lg bg-white/[0.03] border border-white/8">
                <span className="text-sm text-white/60">{position}</span>
              </div>
            )}

            {extracted && (
              <div className="flex items-center gap-2.5 p-3 rounded-lg bg-green-400/5 border border-green-400/20">
                {/*
                  The one green tick in this component, and it marks a fact: at
                  least one file has come back with an answer. The old ticks
                  marked timer expiries.
                */}
                <CheckCircle2 className="h-4 w-4 text-green-400 flex-shrink-0" aria-hidden="true" />
                <span className="text-sm text-green-300">{extracted}</span>
              </div>
            )}
          </div>
        )}

        {/*
          ⚠ `/50`, not `/40`. `text-contrast-floor.test.ts` caught this on the
          first draft: 40% white does not clear AA against this background, and
          the fact that it is a quiet reassurance line is not a licence — it is
          the line somebody stares at while they wait.
        */}
        <p className="text-xs text-white/50 text-center">
          {/*
            ⚠ No estimate. "This may take a moment" is the honest shape of a
            wait whose length nobody here knows; "about 10 seconds" would be the
            old defect stated in prose.
          */}
          Reading an invoice takes a few seconds. Leave this open.
        </p>
      </div>
    </div>
  );
}
