'use client';

import InvoiceProcessingLoader from '@/components/InvoiceProcessingLoader';
import type { ScanProgress } from '@crewchief/core/scan-progress';

/*
 * Visual states for the invoice scanner's progress panel. Development only.
 *
 * ── ⚠ Why this page exists at all (UX-15) ───────────────────────────────────
 *
 * The component it renders used to drive itself from a `setInterval` over four
 * hard-coded stages, advancing with `(prev + 1) % steps.length`. The modulo
 * **wrapped**, so any upload slower than 8.5 seconds ticked the final stage
 * green and then began the first one again — the panel announced the work
 * complete two or three times while it was still running.
 *
 * That shipped and stayed shipped, and the reason is visible from here: the
 * only way to see this component was to upload a real invoice, on a real
 * account, and watch. Nobody watches a loader for nine seconds. On a page like
 * this it would have been obvious in one screenful.
 *
 * The states below are the ones the upload loop can actually produce. If a
 * change to the panel cannot be checked here, add the state — the same rule
 * `card-states` carries, for the same reason.
 *
 * ⚠ These are fixtures, not live scans. The panel is a pure function of its
 * props now, which is what makes them sufficient: there is no internal clock
 * left for a fixture to fail to reproduce.
 */

const states: Array<{ title: string; note: string; progress: ScanProgress }> = [
  {
    title: 'One file, preparing',
    note:
      'The local image reduction, before anything leaves the device. Nothing has come back, so ' +
      'no line-item count and no queue position — the panel says the one true thing and stops.',
    progress: {
      stage: 'preparing',
      fileName: 'service-invoice.jpg',
      fileIndex: 1,
      fileCount: 1,
      itemsExtracted: 0,
    },
  },
  {
    title: 'One file, reading',
    note:
      'The long wait — the model is reading the document. Still nothing to count. This is the ' +
      'state the old panel filled with four marching stages.',
    progress: {
      stage: 'reading',
      fileName: 'service-invoice.jpg',
      fileIndex: 1,
      fileCount: 1,
      itemsExtracted: 0,
    },
  },
  {
    title: 'Second of three, with items landed',
    note:
      'The queue position and the running count are both real: one file has been answered for. ' +
      'The green tick marks a fact rather than a timer expiry.',
    progress: {
      stage: 'reading',
      fileName: 'oil-change-march.pdf',
      fileIndex: 2,
      fileCount: 3,
      itemsExtracted: 7,
    },
  },
  {
    title: 'A file that genuinely had no line items',
    note:
      '“0 line items so far” is a result, not an absence of one — the model read it and found ' +
      'nothing. Distinct from the states above, where nothing had come back yet.',
    progress: {
      stage: 'reading',
      fileName: 'receipt-carwash.png',
      fileIndex: 2,
      fileCount: 2,
      itemsExtracted: 0,
    },
  },
  {
    title: 'A long filename',
    note: 'Truncates rather than wrapping the panel — the name is recognisable from its head.',
    progress: {
      stage: 'reading',
      fileName: 'IMG_20260824_121500_bmw_m235i_major_service_dealer_invoice_scan_final.jpeg',
      fileIndex: 1,
      fileCount: 1,
      itemsExtracted: 0,
    },
  },
];

export default function ScanProgressStatesPage() {
  return (
    <main className="min-h-screen bg-background p-8">
      <header className="mb-8 max-w-2xl">
        <h1 className="text-2xl font-bold text-white">
          InvoiceProcessingLoader — visual states
        </h1>
        <p className="mt-2 text-sm text-white/60">
          Development only. Every figure below is one the upload loop actually holds — the file
          name it kept, its index in the queue, and the line items already returned. There is no
          timer and no percentage, because the client cannot honestly measure either.
        </p>
      </header>

      <div className="space-y-10">
        {states.map((state) => (
          <section key={state.title}>
            <h2 className="text-xs font-semibold uppercase tracking-widest text-white/50">
              {state.title}
            </h2>
            <p className="mt-1 mb-3 max-w-2xl text-sm text-white/60">{state.note}</p>
            <div className="rounded-2xl border border-white/10 bg-[#0d0d0d]">
              <InvoiceProcessingLoader isProcessing progress={state.progress} />
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
