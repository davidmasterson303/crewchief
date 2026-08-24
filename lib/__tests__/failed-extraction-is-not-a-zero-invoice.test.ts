/**
 * A failed invoice extraction is a failure, not a $0 invoice.
 *
 * @jest-environment node
 *
 * ── The defect, from the 24 Aug audit (FN-05) ───────────────────────────────
 *
 * `parseInvoiceLineItems` built a defaults object that **assumes success**,
 * caught the extraction failure, logged it, and **carried on**. The row was
 * written with `total_cost: 0` and `extraction_status: 'completed'`, and the
 * function returned `{ success: true }`.
 *
 * Three consequences, and the third is the expensive one:
 *
 *   1. The UI reported success. The maintenance list showed nothing.
 *   2. `completed` meant nothing would ever retry it — the invoice was gone.
 *   3. **The advisor's guard was defeated, because `0` is a number.**
 *      `if (typeof data.total_cost !== 'number') return null;` — with the
 *      comment above it saying older documents *"are skipped entirely rather
 *      than reported as $0, which would be a confident lie about a real bill."*
 *
 * Failure scenario, end to end: an owner photographs a $1,519.44 invoice, the
 * vision call times out, the UI says it worked, TCO shows $0 of service spend,
 * and asked *"what did my last service cost?"* the advisor answers **"$0"**.
 *
 * ── Why a source scan ───────────────────────────────────────────────────────
 *
 * Executing the path needs a live Gemini vision call that fails in a specific
 * way, plus a live Supabase. What regressed is structural and on disk: whether
 * the catch returns, what it writes, and whether the reader downstream accepts
 * a zero. All three are decidable from the text.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ACTIONS = readFileSync(join(__dirname, '..', '..', 'app', 'actions.ts'), 'utf8');

/** One exported function's body, so a neighbour cannot satisfy these. */
function bodyOf(name: string): string {
  const start = ACTIONS.indexOf(`export async function ${name}`);
  expect(start).toBeGreaterThan(-1);

  const end = ACTIONS.indexOf('\nexport ', start + 1);
  return ACTIONS.slice(start, end === -1 ? undefined : end);
}

describe('parseInvoiceLineItems', () => {
  const body = bodyOf('parseInvoiceLineItems');

  it('finds the extraction catch it is meant to be checking', () => {
    // Anti-vacuous: a rename of the catch variable must fail here loudly rather
    // than turning every assertion below into a check against an empty string.
    expect(body).toMatch(/catch \(parseError\)/);
    expect(body.length).toBeGreaterThan(1000);
  });

  it('stops on a failed extraction instead of writing a row', () => {
    /*
      The whole finding. `console.error` and fall through was the shipped
      behaviour; the row that followed said `completed` and `$0`.
    */
    const start = body.indexOf('catch (parseError)');
    const handler = body.slice(start, start + 2500);

    expect(handler).toMatch(/return \{[\s\S]*?success: false/);
    expect(handler).toMatch(/EXTRACTION_FAILED/);
  });

  it('marks the document retryable rather than completed', () => {
    /*
      ⚠ `completed` is what made the loss permanent — nothing selects a
      completed document for a retry, so a timed-out vision call consumed the
      invoice. `failed` is a state a retry path can find.
    */
    const start = body.indexOf('catch (parseError)');
    const handler = body.slice(start, start + 2500);

    expect(handler).toMatch(/extraction_status: 'failed'/);
  });

  it('scopes that write to the vehicle it authorized', () => {
    // SEC-01's rule, applied to the row this handler touches: `documentId`
    // alone is not an ownership claim.
    const start = body.indexOf('catch (parseError)');
    const handler = body.slice(start, start + 2500);

    expect(handler).toMatch(/\.eq\('vehicle_id', vehicleId\)/);
  });
});

describe('the advisor never quotes a zero total', () => {
  it('requires a positive number, not merely a number', () => {
    /*
      ⚠ The second lock, and the one that holds for every row already written
      as a $0 completed invoice before the upstream fix landed. `0` is a number,
      so the type check alone passed it straight through to a prompt.

      A genuinely free service is not something an invoice records, so refusing
      zero loses nothing real.
    */
    const context = bodyOf('sendConsultantMessage');

    expect(context).toMatch(/invoiceTotals/);
    expect(context).toMatch(/total_cost !== 'number' \|\| !\(data\.total_cost > 0\)/);
  });
});
