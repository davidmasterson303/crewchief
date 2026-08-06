/**
 * Filing an invoice has to change the number the owner is shown.
 *
 * @jest-environment node
 *
 * On 5 Aug the mobile invoice flow completed for the first time: five line
 * items filed against the M235i, confirmed in the database. The vehicle detail
 * screen then still read **70 / FAIR**, with a summary describing a "complete
 * lack of documented maintenance" — immediately after the app had accepted the
 * owner's records.
 *
 * **Two independent defects produced that, and either alone would have.**
 *
 * ── 1. The summary could not see the data ───────────────────────────────────
 *
 * `generateVehicleHealthSummary` read `service_items`. Scanning an invoice
 * writes `maintenance_line_items`. The M235i had **0 rows in the first table
 * and 5 in the second**, so the prompt was told "Recent Service Items: None
 * provided yet" and concluded exactly that.
 *
 * This was never a caching problem: a forced recompute produced the same
 * answer. **The web has always had it too** — its upload dialog does force a
 * refresh, and still got a summary that ignored the invoice it had just
 * processed.
 *
 * ── 2. Nothing on mobile triggered a recompute ──────────────────────────────
 *
 * The refresh lived in `components/DocumentUploadDialog.tsx`, a **web
 * component**, called after the upload returned. The mobile client posts to the
 * same endpoint and had no equivalent, so nothing ran at all.
 *
 * A capability living in one client's component is one the second client
 * silently lacks. That is this codebase's most repeated defect — `VehicleCard`'s
 * unauthorized delete, the health band, the context-kind labels — and the fix is
 * always to move it into the path both callers already share.
 *
 * ── Why a source scan ───────────────────────────────────────────────────────
 *
 * Executing either half needs a live Supabase and a Gemini call. What regressed
 * is structural: which tables are read, and whether the refresh sits in shared
 * server code or in one client. Both are on disk.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');

const actions = readFileSync(join(ROOT, 'app', 'actions.ts'), 'utf8');

/** The body of `generateVehicleHealthSummary`, so neighbours cannot satisfy these. */
function healthSummarySource(): string {
  const start = actions.indexOf('export async function generateVehicleHealthSummary');
  expect(start).toBeGreaterThan(-1);

  const end = actions.indexOf('\nexport ', start + 1);
  return actions.slice(start, end === -1 ? undefined : end);
}

/** The body of `uploadInvoice`. */
function uploadInvoiceSource(): string {
  const start = actions.indexOf('export async function uploadInvoice');
  expect(start).toBeGreaterThan(-1);

  const end = actions.indexOf('\nexport ', start + 1);
  return actions.slice(start, end === -1 ? undefined : end);
}

describe('the health summary reads what an invoice actually writes', () => {
  const source = healthSummarySource();

  it('queries maintenance_line_items, not only service_items', () => {
    expect(source).toMatch(/from\('maintenance_line_items'\)/);
    // Both, not either: manually added service items are still real history.
    expect(source).toMatch(/from\('service_items'\)/);
  });

  it('puts those line items in front of the model', () => {
    /*
      Loading them and not prompting with them would leave the defect exactly
      as it was — the model's answer is the product here, not the query.
    */
    const prompt = source.slice(source.indexOf('const prompt ='));
    expect(prompt).toMatch(/DOCUMENTED WORK FROM UPLOADED INVOICES/);
    expect(prompt).toMatch(/item_description/);
  });

  it('tells the model that invoices are completed work', () => {
    // Without this the model can read the list and still describe the history
    // as absent, which is the sentence a real owner saw.
    expect(source).toMatch(/must not\s*\n?\s*describe their records as absent|completed, documented work/);
  });

  it('bounds the history it sends', () => {
    // A prompt is a budget. An unbounded service history pushes the recall and
    // known-issue sections out of the model's attention.
    const query = source.slice(source.indexOf("from('maintenance_line_items')"));
    expect(query.slice(0, 400)).toMatch(/\.limit\(\d+\)/);
  });
});

describe('the refresh runs for every client', () => {
  const source = uploadInvoiceSource();

  it('refreshes the score inside the shared upload path', () => {
    expect(source).toMatch(/generateVehicleHealthSummary\(vehicleId,\s*true\)/);
  });

  it('does NOT await it, so a model call cannot fail a filed invoice', () => {
    /*
      Reversed within the same session, deliberately. Awaiting stacked a second
      Gemini call onto a request that already spends ~8s in vision, against a
      serverless ceiling with no configured override. Timing out there fails an
      upload whose document and line items are **already written** — reporting a
      filing that succeeded as a failure, which is the class of defect the whole
      night was spent removing.

      A stale score is recoverable; a lost confirmation is not. And the other
      half of this fix carries the weight: the summary now reads
      `maintenance_line_items`, so any later recompute produces the right answer
      rather than the wrong one.

      Matches `app/api/v1/wishlist/complete/route.ts`, which recomputes stats
      the same way for the same stated reason.
    */
    expect(source).not.toMatch(/await generateVehicleHealthSummary/);
    expect(source).toMatch(/generateVehicleHealthSummary\(vehicleId,\s*true\)\.catch\(/);
  });

  it('refreshes performance stats too, which also read invoice line items', () => {
    // `lib/performance-stats.ts:118` queries maintenance_line_items, so an
    // invoice changes them as surely as it changes the health score. This was
    // the other refresh the web fired and mobile never did.
    expect(source).toMatch(/recomputePerformanceStats\(/);
    expect(source).toMatch(/forceRefresh:\s*true/);
  });

  it('rate limits the stats recompute before spending on it', () => {
    // Its own docblock puts authorization and rate limiting on the caller.
    const refresh = source.slice(source.indexOf('itemsExtracted > 0'));
    expect(refresh).toMatch(/checkRateLimit\([^)]*'ai'\)/);
  });

  it('never fails the upload over a stale score', () => {
    /*
      By this point the document is stored and its line items are written. A
      missing summary is a worse dashboard, not a lost invoice — the same
      judgement `runVehicleResearch` makes about its own health call.
    */
    const refresh = source.slice(source.indexOf('generateVehicleHealthSummary'));
    expect(refresh).toMatch(/\.catch\(/);
    expect(source.slice(source.indexOf('recomputePerformanceStats'))).toMatch(/\.catch\(/);
  });

  it('does not leave the web as the only trigger', () => {
    /*
      The dialog may keep its own call — it also invalidates caches and
      refreshes the router, which are web concerns. What must not happen is the
      server path losing its refresh and the web silently covering for it,
      because that is precisely the state that shipped.
    */
    expect(uploadInvoiceSource()).toMatch(/generateVehicleHealthSummary/);
  });
});
