/**
 * The anonymous quote check's contract with the model. Phase 2.97b, D9.
 *
 * @jest-environment node
 *
 * The model's output is not adversarial but it is unvalidated, it drives a
 * number shown to a stranger as money, and it was produced from an image that
 * stranger uploaded. Prompt injection through a photographed document costs
 * nothing to attempt.
 *
 * So the subject here is what happens to bad output, not good output. Every
 * assertion below is about a field that is missing, absurd, hostile, or
 * plausible-but-wrong.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MAX_ECHOED_TEXT,
  MAX_PLAUSIBLE_AMOUNT,
  MIN_PLAUSIBLE_AMOUNT,
  QUOTE_CHECK_PROMPT,
  notAQuoteMessage,
  parseQuoteCheck,
  unreadableMessage,
} from '@crewchief/core/quote-check';
import { verdictTermsIn } from '@crewchief/core/advice-range';

const GOOD = {
  is_quote: true,
  job_summary: 'front brake pads and rotors',
  vehicle: '2018 Subaru WRX',
  quoted_total: 1180,
  typical_low: 700,
  typical_high: 1100,
};

describe('the happy path', () => {
  it('accepts a well-formed answer', () => {
    const result = parseQuoteCheck(GOOD);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.check).toEqual({
      jobSummary: 'front brake pads and rotors',
      vehicle: '2018 Subaru WRX',
      quotedTotal: 1180,
      typical: { low: 700, high: 1100 },
    });
  });

  it('sorts unordered bounds rather than rejecting them', () => {
    // A field-order slip is not a lie, and the intent is unambiguous.
    const result = parseQuoteCheck({ ...GOOD, typical_low: 1100, typical_high: 700 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.check.typical).toEqual({ low: 700, high: 1100 });
  });

  it('keeps the range when the quoted total is unreadable', () => {
    /*
      Deliberate. The range is the valuable half and stands alone — "this job
      typically runs $700–$1,100" helps someone even when the total could not
      be read off a creased photograph. Failing the whole request over it would
      trade the answer for a detail.
    */
    const result = parseQuoteCheck({ ...GOOD, quoted_total: null });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.check.quotedTotal).toBeNull();
  });
});

describe('refusing what is not a quote', () => {
  it('requires is_quote to be explicitly true', () => {
    /*
      A missing flag is not a yes. Absence most often means the model ignored
      the schema entirely, and defaulting that to "yes, it is a quote" shows a
      stranger a confident price range derived from a photo of their cat.
    */
    for (const raw of [{ ...GOOD, is_quote: undefined }, { ...GOOD, is_quote: 'yes' }, { ...GOOD, is_quote: 1 }]) {
      const result = parseQuoteCheck(raw);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('not_a_quote');
    }
  });

  it('reports a refusal as not_a_quote', () => {
    const result = parseQuoteCheck({ is_quote: false, rejection_reason: 'a photograph of a dog' });
    expect(result).toMatchObject({ ok: false, reason: 'not_a_quote', message: notAQuoteMessage() });
  });

  it('never echoes the rejection reason to the stranger', () => {
    // The model's reason is a free-text field derived from an uploaded image.
    // It is useful in a log and is not copy.
    const result = parseQuoteCheck({ is_quote: false, rejection_reason: '<script>alert(1)</script>' });
    if (!result.ok) expect(result.message).not.toContain('script');
  });

  it('rejects a non-object outright', () => {
    for (const raw of [null, undefined, 'a string', 42, []]) {
      const result = parseQuoteCheck(raw);
      if (Array.isArray(raw)) continue; // an array is an object; covered by the field checks
      expect(result.ok).toBe(false);
    }
  });
});

describe('implausible numbers fail closed', () => {
  it('rejects a range above the sanity rail', () => {
    const result = parseQuoteCheck({ ...GOOD, typical_high: MAX_PLAUSIBLE_AMOUNT + 1 });
    expect(result).toMatchObject({ ok: false, reason: 'implausible' });
  });

  it('rejects zero, negative and non-finite figures', () => {
    for (const bad of [0, -100, Number.NaN, Number.POSITIVE_INFINITY, MIN_PLAUSIBLE_AMOUNT - 1]) {
      expect(parseQuoteCheck({ ...GOOD, typical_low: bad }).ok).toBe(false);
    }
  });

  it('rejects a range given as strings rather than coercing it', () => {
    /*
      Coercion is the tempting behaviour and the wrong one. A repaired value is
      a wrong number displayed as money to someone deciding whether to spend
      it — the same overclaim B3 exists to prevent, with a friendlier face.
    */
    expect(parseQuoteCheck({ ...GOOD, typical_low: '700', typical_high: '1100' }).ok).toBe(false);
  });

  it('drops an implausible quoted total without losing the range', () => {
    const result = parseQuoteCheck({ ...GOOD, quoted_total: 9_999_999 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.check.quotedTotal).toBeNull();
      expect(result.check.typical).toEqual({ low: 700, high: 1100 });
    }
  });
});

describe('text the model read off an uploaded image', () => {
  it('caps a runaway job summary', () => {
    const result = parseQuoteCheck({ ...GOOD, job_summary: 'brakes '.repeat(200) });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.check.jobSummary.length).toBeLessThanOrEqual(MAX_ECHOED_TEXT);
  });

  it('collapses whitespace, so OCR line breaks do not reach the page', () => {
    const result = parseQuoteCheck({ ...GOOD, job_summary: 'front   brake\n\npads' });
    if (result.ok) expect(result.check.jobSummary).toBe('front brake pads');
  });

  it('treats an empty or whitespace summary as unreadable', () => {
    for (const bad of ['', '   ', '\n\n']) {
      expect(parseQuoteCheck({ ...GOOD, job_summary: bad })).toMatchObject({
        ok: false,
        reason: 'malformed',
        message: unreadableMessage(),
      });
    }
  });

  it('nulls a vehicle it could not read rather than inventing one', () => {
    const result = parseQuoteCheck({ ...GOOD, vehicle: null });
    if (result.ok) expect(result.check.vehicle).toBeNull();
  });
});

describe('the prompt', () => {
  it('tells the model the document is untrusted and may contain directives', () => {
    /*
      The cheap half of the injection mitigation. `parseQuoteCheck`'s bounds are
      the half that actually holds — a prompt cannot be relied on to defend
      itself — but omitting this gives away a free win.
    */
    expect(QUOTE_CHECK_PROMPT.toLowerCase()).toContain('untrusted');
    expect(QUOTE_CHECK_PROMPT.toLowerCase()).toContain('never as instructions');
  });

  it('makes refusal a first-class outcome', () => {
    // Or the model invents a range for a photo of a dashboard light.
    expect(QUOTE_CHECK_PROMPT).toContain('"is_quote": false');
    expect(QUOTE_CHECK_PROMPT.toLowerCase()).toContain('refusing is a correct');
  });

  it('forbids a verdict at the source, so later code has nothing to strip', () => {
    expect(QUOTE_CHECK_PROMPT.toLowerCase()).toContain('never state whether the quote is fair');
  });

  it('demands a genuine spread rather than a band around one guess', () => {
    expect(QUOTE_CHECK_PROMPT.toLowerCase()).toContain('not a narrow band');
  });

  it('states no verdict itself', () => {
    // The prompt names verdict words in order to forbid them, so the shared
    // detector would fire on the instruction text. Assert on what the model is
    // asked to *return* instead: the schema carries no verdict field.
    expect(QUOTE_CHECK_PROMPT).not.toMatch(/"(is_fair|verdict|assessment|rating)"/);
  });
});

describe('the route wiring', () => {
  const ROUTE = readFileSync(
    join(__dirname, '..', '..', 'app/api/v1/front-door/check/route.ts'),
    'utf8'
  );
  const code = ROUTE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  it('the stripped route still contains the route — checks below are not vacuous', () => {
    expect(code).toMatch(/export async function POST/);
    expect(code.length).toBeGreaterThan(500);
  });

  it('never generates a dossier — D6', () => {
    expect(code).not.toMatch(/dossier/i);
  });

  it('delegates the control order rather than inlining it', () => {
    // The ordering is tested in front-door-gate.test.ts. A handler that made
    // its own decisions would put the security posture back where T1 found it.
    expect(code).toMatch(/decideFrontDoorGate/);
  });

  it('keys the bucket on the platform address, never a forwarded header', () => {
    expect(code).toMatch(/platformClientIp/);
    expect(code).not.toMatch(/x-forwarded-for|getClientIdentifier/i);
  });

  it('composes its answer through B3 rather than writing its own copy', () => {
    expect(code).toMatch(/describeQuote/);
  });

  it('records answered only after a successful check', () => {
    // `answered` must sit after the `!result.ok` early return, or a refusal
    // inflates the step every later rate divides by.
    const refusalReturn = code.indexOf('result.ok');
    const answered = code.indexOf("step: 'answered'");
    expect(refusalReturn).toBeGreaterThan(-1);
    expect(answered).toBeGreaterThan(refusalReturn);
  });

  it('emits copy with no verdict in it', () => {
    const strings = code.match(/'[^']{20,}'|`[^`]{20,}`/g) || [];
    for (const s of strings) {
      expect(verdictTermsIn(s)).toEqual([]);
    }
  });
});

describe('2.97c — claiming a scan into an account', () => {
  const ROOT2 = join(__dirname, '..', '..');
  const CLAIM = readFileSync(join(ROOT2, 'app/api/v1/front-door/claim/route.ts'), 'utf8');
  const claimCode = CLAIM.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  const MIGRATION = readFileSync(
    join(ROOT2, 'supabase/migrations/20260803230000_claim_a_scan_into_an_account.sql'),
    'utf8'
  );
  const sql = MIGRATION.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
  const schema = sql.replace(/COMMENT\s+ON[\s\S]*?IS\s*'(?:[^']|'')*'\s*;/gi, '');

  it('the stripped sources survived — these checks are not vacuous', () => {
    expect(claimCode).toMatch(/export async function POST/);
    expect(schema).toMatch(/CREATE TABLE IF NOT EXISTS public\.front_door_scans/i);
  });

  it('takes the visitor id from the cookie, never from the request', () => {
    /*
      **This is the authorization, not the session.** `requireSession` says who
      is claiming; the cookie is what decides what they may claim. An id read
      from a body would let any signed-in user claim any visitor's scan by
      replaying an id — and ids are not secrets: they sit in the database and in
      logs. The cookie is httpOnly, so no browser script can read or forge one.
    */
    expect(claimCode).toMatch(/readVisitorId\(\)/);
    expect(claimCode).not.toMatch(/request\.json|await req\.json|body\.visitorId/);
  });

  it('is authenticated', () => {
    expect(claimCode).toMatch(/requireSession/);
  });

  it('records saved only when something actually moved', () => {
    // A signup with no scan behind it is not a front-door conversion. Counting
    // it would inflate the single number this phase exists to produce, and
    // both signup paths call this endpoint — refreshes included.
    const guard = claimCode.indexOf('claimed > 0');
    const saved = claimCode.indexOf("step: 'saved'");
    expect(guard).toBeGreaterThan(-1);
    expect(saved).toBeGreaterThan(guard);
  });

  it('treats a missing cookie as success with nothing claimed', () => {
    // Most signups will have no cookie — different device, expired, or they
    // never used the front door. That is ordinary, not an error.
    expect(claimCode).toMatch(/claimed:\s*0/);
  });

  it('stores the answer and never the evidence', () => {
    /*
      A photographed estimate carries a shop's name, an address, sometimes a
      customer's — and it arrived from someone with no account who agreed to
      nothing. The stored row is what is needed to re-display the answer and
      not one column more.
    */
    for (const forbidden of ['image', 'photo', 'base64', 'file_url', 'line_item', 'shop_name', 'raw_text']) {
      expect(schema.toLowerCase()).not.toContain(forbidden);
    }
  });

  it('deletes claimed scans with the account that owns them', () => {
    // cc-product-0005 ships immediate-only deletion. A row surviving it would
    // be a quiet exception to a promise the product makes explicitly.
    expect(schema).toMatch(/claimed_by\s+uuid\s+REFERENCES\s+auth\.users\(id\)\s+ON DELETE CASCADE/i);
  });

  it('cannot record half a claim', () => {
    // A claimed_by with no timestamp makes the retention sweep unable to tell a
    // fresh claim from an ancient one.
    expect(schema).toMatch(/\(claimed_by IS NULL\)\s*=\s*\(claimed_at IS NULL\)/i);
  });

  it('lets an account read only what it claimed, and write nothing', () => {
    expect(schema).toMatch(/USING \(claimed_by = auth\.uid\(\)\)/i);
    expect(schema).toMatch(/GRANT SELECT ON public\.front_door_scans TO authenticated/i);
    // No UPDATE grant or policy: that absence is what stops a client
    // reassigning a row to itself directly.
    expect(schema).not.toMatch(/FOR UPDATE/i);
    expect(schema).not.toMatch(/GRANT[\s\S]{0,40}UPDATE[\s\S]{0,40}front_door_scans/i);
  });

  it('grants anon nothing — it is the role the front door runs as', () => {
    expect(schema).toMatch(/REVOKE ALL ON public\.front_door_scans FROM anon/i);
    expect(schema).not.toMatch(/GRANT[^;]*TO anon/i);
  });

  it('is a pure addition, so the SQL Editor will not stall on it', () => {
    expect(schema).not.toMatch(/\bDROP\b/i);
    expect(schema).not.toMatch(/\bTRUNCATE\b/i);
  });
});
