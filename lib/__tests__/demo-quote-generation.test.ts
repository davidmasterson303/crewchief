/**
 * `$rules.demoQuote` — a demo may generate a quote, and may never store one.
 *
 * @jest-environment node
 *
 * ── The change this guards ──────────────────────────────────────────────────
 *
 * Until 17 Aug the public demo refused quote generation outright:
 * `authorizeVehicleAccess(..., { intent: 'write' })` → *"Demo vehicles are
 * read-only"*. That blocked the most convincing thing the product does — a
 * wishlist turned into priced work with an email a shop can answer — so anyone
 * evaluating Well Kept saw the setup and never the payoff.
 *
 * The block was right about the database and wrong about the feature.
 * **Generating** costs an AI call; **storing** is what would let an anonymous
 * visitor write rows against a car they do not own. So the demo path now runs
 * the whole computation and returns before the one write.
 *
 * ── Why this is a source scan and not a call ────────────────────────────────
 *
 * The property is an **ordering** one — the demo return must come before the
 * insert — and ordering inside a 200-line server action is exactly what a
 * refactor rearranges without noticing. Calling the function would need
 * Supabase, Gemini and a request context, and would still only prove the path
 * it happened to take.
 *
 * ⚠ What is at stake if this inverts: an anonymous visitor writing
 * `quote_requests` rows against a shared demo vehicle, which is both data
 * someone else owns and an unbounded write path on a public page.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ── ⚠ Why the quote, and not the other four ─────────────────────────────────
 *
 * Audited 17 Aug after this change, because "the demo refuses it" is a bad
 * reason to leave a feature hidden and a good reason to check the siblings.
 * Five actions authorize `write` and then call a model:
 *
 *   generateVehicleHealthSummary   demo cars already carry one — the dial on
 *                                  the demo page is reading it. Regenerating
 *                                  would spend money to redraw what is shown.
 *   parseInvoiceLineItems          the impressive one, and the one that must
 *                                  stay shut: it reads a document that has to
 *                                  be uploaded first, so opening it opens an
 *                                  anonymous write to storage. See below.
 *   generateModificationDetails    persists to `modification_tracking`; the
 *                                  output *is* the row.
 *   generateBackfillMod            same, and only reachable from that flow.
 *   ensureAggressiveModMinimum     same again.
 *
 * The quote was the only one where the write is **incidental**. Its product is
 * a breakdown and an email draft handed to the caller; the row is a
 * convenience for an owner who wants it later, and a demo visitor has no
 * "later". The other four either produce a row as their output or would need a
 * second, genuinely dangerous permission to run at all.
 *
 * That is the test to apply to the next one somebody asks about: **does the
 * caller get the value without the row?** If not, unblocking it is not showing
 * the feature, it is letting a stranger write into a shared car.
 */

const ACTIONS = readFileSync(join(__dirname, '..', '..', 'app', 'actions.ts'), 'utf8');

/** The body of `generateQuoteRequestV2`, to the next top-level export. */
function quoteAction(): string {
  const start = ACTIONS.indexOf('export async function generateQuoteRequestV2(');
  expect(start).toBeGreaterThan(-1);

  const next = ACTIONS.indexOf('\nexport async function ', start + 1);
  return ACTIONS.slice(start, next === -1 ? undefined : next);
}

describe('a demo can generate a quote', () => {
  const body = quoteAction();

  it('authorizes for read, so a demo vehicle is not turned away', () => {
    expect(body).toContain("authorizeVehicleAccess(vehicleId, { intent: 'read' })");
    expect(body).not.toContain("intent: 'write'");
  });

  it('still refuses an anonymous caller on someone else s real car', () => {
    /*
      The half that must not have been weakened. `read` is not "no auth" — for
      a non-demo id `authorizeVehicleAccess` still resolves a caller and 401s
      without one. This asserts the seam is intact rather than re-testing it:
      the intent is the only thing that changed.
    */
    const authSource = readFileSync(join(__dirname, '..', 'api-auth.ts'), 'utf8');
    expect(authSource).toContain("if (intent === 'write')");
    expect(authSource).toContain('Demo vehicles are read-only');
    expect(authSource).toMatch(/if \(!caller\) \{\s*return deny\('Unauthorized', 401\)/);
  });
});

describe('and may never store one', () => {
  const body = quoteAction();

  it('returns on the demo path before the insert', () => {
    /*
      ⚠ The assertion this file exists for, and it is about **order**. Both
      lines can be present and correct while the insert runs first, which would
      be an anonymous write to a shared car that still returned a plausible
      quote — no error, no symptom.
    */
    const demoReturn = body.indexOf('if (access.isDemo) {');
    const insert = body.indexOf("from('quote_requests')");

    expect(demoReturn).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(-1);
    expect(demoReturn).toBeLessThan(insert);
  });

  it('hands back a synthetic id rather than a row it did not create', () => {
    expect(body).toContain('quoteRequestId: DEMO_QUOTE_ID');
    expect(ACTIONS).toMatch(/const DEMO_QUOTE_ID = 'demo-quote'/);
  });

  it('writes nothing else on the way there', () => {
    /*
      The early return is only safe if nothing before it persists. Everything
      ahead of it must be a read or a model call.
    */
    const upTo = body.slice(0, body.indexOf('if (access.isDemo) {'));

    expect(upTo).not.toMatch(/\.insert\(/);
    expect(upTo).not.toMatch(/\.upsert\(/);
    expect(upTo).not.toMatch(/\.update\(/);
    expect(upTo).not.toMatch(/\.delete\(/);
  });
});

describe('the sibling that must stay shut', () => {
  it('keeps anonymous uploads blocked, so invoice scan cannot be opened by halves', () => {
    /*
      ⚠ `parseInvoiceLineItems` is the most demo-worthy feature in the product —
      photograph a receipt, get line items — and it is the one this change must
      not be read as precedent for.

      Reading an invoice requires an invoice, so the flow starts at
      `upload-document`. Opening that for demo traffic is an **anonymous write
      to storage** on a public page: unbounded bytes, arbitrary content, from
      anyone. The quote path has no such door — it computes from rows that are
      already there.

      Pinned because the reasoning is easy to lose: someone who reads only "the
      demo can generate quotes now" has every reason to think invoice scan
      should follow.
    */
    const upload = readFileSync(
      join(__dirname, '..', '..', 'app', 'api', 'v1', 'upload-document', 'route.ts'),
      'utf8'
    );

    expect(upload).toContain("intent: 'write'");
  });
});

describe('the spend it opens is bounded twice', () => {
  const body = quoteAction();

  it('caps a single visitor with the ai-tier bucket', () => {
    // Bursts. Two model calls per quote on an anonymous public page.
    expect(body).toContain("checkRateLimit(`demoquote:${ip}`, 'ai')");
  });

  it('caps the day with the shared demo allowance', () => {
    // And the day as a whole, so one enthusiastic afternoon cannot spend it.
    expect(body).toContain('checkDemoBudget()');
    expect(body).toContain('demoBudgetMessage(demo)');
  });

  it('bounds only the demo path, leaving a signed-in owner alone', () => {
    /*
      An owner generating quotes on their own car is the paid product working.
      Both caps sit inside `if (access.isDemo)`, so this checks the limiter is
      not reachable from the owner path — the failure would be silent and would
      look like the feature being flaky under load.
    */
    const demoBlock = body.slice(
      body.indexOf('if (access.isDemo) {'),
      body.indexOf("from('quote_requests')")
    );

    expect(demoBlock).toContain('checkRateLimit');
    expect(demoBlock).toContain('checkDemoBudget');
  });

  it('degrades with a sentence rather than an error', () => {
    // The person hitting this cap is evaluating the product. A stack trace is
    // a worse answer than "come back tomorrow".
    expect(body).toMatch(/Try again in \$\{limit\.retryAfterSeconds\} seconds/);
  });

  it('can still detect the old shape, so this is not vacuous', () => {
    const before = "const access = await authorizeVehicleAccess(vehicleId, { intent: 'write' });";
    expect(before).toContain("intent: 'write'");
    expect(quoteAction()).not.toContain(before);
  });
});
