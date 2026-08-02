/**
 * AI usage metering — the arithmetic and the vocabulary.
 *
 * @jest-environment node
 *
 * The database write needs a service-role client and is not tested here. What
 * is tested is everything around it, because those are the parts that fail
 * without failing: a row of zeroes that drags every average down, a total that
 * silently omits thinking tokens, a purpose the application knows and the CHECK
 * constraint refuses.
 *
 * That last one is the reason this file reads the migration. The write path is
 * fire-and-forget by design — it cannot throw, so a rejected INSERT is a warn
 * line and a missing row, and the first symptom is a cost report that is quietly
 * incomplete for one feature. There is no runtime signal. A build-time one is
 * the only kind available.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AI_USAGE_PURPOSES,
  readUsageMetadata,
  isWorthRecording,
  billableTokens,
} from '@crewchief/core/ai/usage';

const ROOT = join(__dirname, '..', '..');
const MIGRATION = readFileSync(
  join(ROOT, 'supabase/migrations/20260802150000_meter_ai_usage_per_account.sql'),
  'utf8'
);

/**
 * The migration with its prose removed.
 *
 * Every assertion below runs against this rather than the raw file, and the
 * first draft of this suite is why. It asserted the file contains no
 * `USING (true)` — and failed, on the migration's own header comment saying it
 * contains no `USING (true)`. The test was reading documentation and reporting
 * it as schema.
 *
 * That is the same instrument failure this codebase keeps finding in its own
 * checks: a green result is evidence only of what was actually examined, and a
 * check that examines prose can be turned green by editing a sentence.
 */
const SQL = MIGRATION.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');

describe('readUsageMetadata', () => {
  it('reads a real Gemini response', () => {
    // Shape and numbers taken from an actual gemini-3.6-flash response, 2 Aug.
    expect(
      readUsageMetadata({
        promptTokenCount: 56,
        candidatesTokenCount: 168,
        thoughtsTokenCount: 861,
        totalTokenCount: 1085,
      })
    ).toEqual({
      promptTokens: 56,
      outputTokens: 168,
      thoughtsTokens: 861,
      cachedTokens: 0,
      totalTokens: 1085,
    });
  });

  it('does not trust a reported total that omits thinking', () => {
    /*
      The failure this guards. A total that excludes the most expensive
      component is worse than no total at all: every cost figure derived from it
      is low, consistently, and plausibly enough that nobody checks.
    */
    const usage = readUsageMetadata({
      promptTokenCount: 56,
      candidatesTokenCount: 168,
      thoughtsTokenCount: 861,
      totalTokenCount: 224, // prompt + output only
    });

    expect(usage.totalTokens).toBe(1085);
  });

  it('keeps the reported total when it is the larger figure', () => {
    // The API may count things the sum does not. Trust whichever is bigger.
    const usage = readUsageMetadata({
      promptTokenCount: 10,
      candidatesTokenCount: 10,
      totalTokenCount: 99,
    });

    expect(usage.totalTokens).toBe(99);
  });

  it('survives metadata that is absent or the wrong shape', () => {
    // These paths must not throw — the caller is on a request that already
    // succeeded, and the meter is not allowed to disturb it.
    for (const bad of [undefined, null, {}, 'nonsense', 42, []]) {
      const usage = readUsageMetadata(bad);
      expect(usage.promptTokens).toBe(0);
      expect(usage.totalTokens).toBe(0);
    }
  });

  it('refuses negative, fractional and non-numeric counts', () => {
    const usage = readUsageMetadata({
      promptTokenCount: -5,
      candidatesTokenCount: 12.6,
      thoughtsTokenCount: '900',
      cachedContentTokenCount: NaN,
    });

    expect(usage.promptTokens).toBe(0);
    expect(usage.outputTokens).toBe(13);
    expect(usage.thoughtsTokens).toBe(0);
    expect(usage.cachedTokens).toBe(0);
  });
});

describe('isWorthRecording', () => {
  it('records a call that actually happened', () => {
    expect(isWorthRecording(readUsageMetadata({ promptTokenCount: 56, candidatesTokenCount: 168 }))).toBe(true);
  });

  it('records a call that produced only thinking', () => {
    // A response truncated at the thinking stage still cost money.
    expect(isWorthRecording(readUsageMetadata({ thoughtsTokenCount: 400 }))).toBe(true);
  });

  it('refuses an all-zero reading', () => {
    /*
      Gemini does not serve free calls, so all-zero means the metadata was
      missing or malformed. A row of zeroes is invisible in exactly the
      statistic it corrupts — it drags the per-call average down and appears
      nowhere as a fault. A gap can be noticed; a zero cannot.
    */
    expect(isWorthRecording(readUsageMetadata({}))).toBe(false);
    expect(isWorthRecording(readUsageMetadata({ cachedContentTokenCount: 100 }))).toBe(false);
  });
});

describe('billableTokens', () => {
  it('bills thinking at the output rate', () => {
    // This sum is what made 2.95a the largest single cost lever in the app:
    // 168 tokens of visible answer, 1029 billed as output.
    const usage = readUsageMetadata({
      promptTokenCount: 56,
      candidatesTokenCount: 168,
      thoughtsTokenCount: 861,
    });

    expect(billableTokens(usage)).toEqual({ input: 56, output: 1029 });
  });
});

describe('the purpose vocabulary matches the CHECK constraint', () => {
  /*
    Two lists that must agree, in two languages, in two files. The write path
    cannot throw, so a disagreement produces a warn line and a silently
    incomplete cost report rather than an error anyone would see.
  */
  /** The values inside `CHECK (purpose IN (…))`, read from the SQL itself. */
  const listed = (() => {
    const block = SQL.match(/CHECK\s*\(\s*purpose\s+IN\s*\(([\s\S]*?)\)\s*\)/i);
    if (!block) throw new Error('Could not find the purpose CHECK constraint in the migration');
    return (block[1].match(/'([a-z_]+)'/g) || []).map((s) => s.replace(/'/g, ''));
  })();

  it.each(AI_USAGE_PURPOSES)('the database accepts %s', (purpose) => {
    expect(listed).toContain(purpose);
  });

  it('the application knows every purpose the database accepts', () => {
    // The other direction: a value in the CHECK that nothing writes is dead
    // vocabulary, and dead vocabulary is how the next reader concludes the two
    // lists were never meant to match.
    expect([...listed].sort()).toEqual([...AI_USAGE_PURPOSES].sort());
  });
});

describe('the migration keeps the meter unforgeable', () => {
  /*
    An account that can write its own usage rows can under-report itself, which
    is the entire attack against a metered tier (5.1). The protection is that
    there is no INSERT policy and no INSERT grant — writes go through the
    service role, which bypasses RLS.
  */
  it('enables row-level security', () => {
    expect(SQL).toMatch(/ALTER TABLE public\.ai_usage_events ENABLE ROW LEVEL SECURITY/);
  });

  it('gives authenticated users SELECT and nothing else', () => {
    expect(SQL).toMatch(/GRANT SELECT ON public\.ai_usage_events TO authenticated/);
    expect(SQL).not.toMatch(/GRANT[^;]*INSERT[^;]*ai_usage_events/i);
    expect(SQL).not.toMatch(/GRANT ALL[^;]*ai_usage_events/i);
  });

  it('scopes the read policy to the owner, with no blanket arm', () => {
    // `rls-blanket-policies.test.ts` freezes the blanket baseline and it may
    // only shrink. A `USING (true)` here would also let any signed-in user read
    // every other account's usage history.
    expect(SQL).toMatch(/USING \(user_id = auth\.uid\(\)\)/);
    expect(SQL).not.toMatch(/USING \(true\)/);
  });

  it('gives anon nothing', () => {
    // The demo writes rows here. It has no business reading them.
    expect(SQL).toMatch(/REVOKE ALL ON public\.ai_usage_events FROM anon/);
  });

  it('cascades on account deletion', () => {
    /*
      5.1.1(v) and the privacy policy 5.0 has to publish both require that
      "everything is deleted" be true. A usage table that outlives its account
      makes that sentence false, and `cc-tech-0011` is the precedent for how
      easily an uncascaded row is missed.
    */
    expect(SQL).toMatch(/user_id uuid REFERENCES auth\.users\(id\) ON DELETE CASCADE/);
  });

  it('keeps usage history when a vehicle is deleted, not when an account is', () => {
    // Deleting one car should not erase what it cost to run; the account-level
    // cascade above is what makes deletion honest.
    expect(SQL).toMatch(/vehicle_id uuid REFERENCES public\.vehicles\(id\) ON DELETE SET NULL/);
  });

  it('contains no DROP-class statement', () => {
    /*
      Migrations here are applied by hand through a dashboard whose "Potential
      issue detected" modal fires on DROP and blocks the whole run until a human
      clicks through. Confirmed 1 Aug. A pure-addition migration will not stall.
    */
    expect(SQL).not.toMatch(/\bDROP\s+(TABLE|POLICY|COLUMN|CONSTRAINT|INDEX)\b/i);
  });
});
