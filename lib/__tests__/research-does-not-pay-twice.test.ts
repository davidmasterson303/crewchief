/**
 * A dossier that already exists is never generated again.
 *
 * @jest-environment node
 *
 * ── The run that produced this test ─────────────────────────────────────────
 *
 * 22 Aug, live, on the product host. A 2003 Accord was added and research
 * **succeeded** — full dossier written, 24 NHTSA recalls stored,
 * `research_status = 'completed'`, all inside about sixty seconds. The browser
 * was told it had failed: the request outlived its response, `enrichVehicle`
 * returned no body, and the client read `.success` off `undefined`.
 *
 * So the screen showed the failure state and a retry button, for work that had
 * already completed. Pressing it went from the authorization check straight to
 * the prompt — nothing in between asked whether the dossier existed. That is a
 * second Pro-model call, the most expensive one in the product, measured the
 * same day at ~4,900 tokens and three to four cents.
 *
 * ⚠ **Nobody pressed it, which is the only reason this is a test and not an
 * incident.** The usage table shows exactly one `vehicle_dossier` row for that
 * vehicle.
 *
 * ── Why this suite mocks the platform and not the subject ───────────────────
 *
 * `researchVehicleDossier` is imported and run for real. What is faked is the
 * database it reads and the model it calls, because the assertion is precisely
 * **that the model is never reached** — and a test that reimplemented the
 * function to prove that would be this repo's signature failure
 * (`tests-test-real-code.test.ts`).
 */

jest.mock('@/lib/supabase', () => ({ getServiceRoleClient: jest.fn() }));
jest.mock('@/lib/gemini', () => ({
  genAI: { models: { generateContent: jest.fn() } },
  proStructuredConfig: {},
}));
jest.mock('@/lib/ai-usage', () => ({ recordAiUsageInBackground: jest.fn() }));

import { getServiceRoleClient } from '@/lib/supabase';
import { genAI } from '@/lib/gemini';
import { recordAiUsageInBackground } from '@/lib/ai-usage';
import { researchVehicleDossier } from '@/lib/vehicle-research';

const generateContent = genAI.models.generateContent as jest.Mock;
const serviceRole = getServiceRoleClient as jest.Mock;

const ACCORD = { id: 'v-1', year: 2003, make: 'HONDA', model: 'Accord' };

/**
 * A Supabase stub that answers the knowledge-base read and swallows writes.
 *
 * Every chain is thenable so `await client.from(x).update(y).eq(z)` resolves,
 * and `maybeSingle()` returns the row this test is about.
 */
function clientReturning(kbRow: Record<string, unknown> | null) {
  const from = jest.fn(() => {
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'update', 'upsert', 'insert', 'order', 'limit']) {
      chain[method] = jest.fn(() => chain);
    }
    chain.maybeSingle = jest.fn(async () => ({ data: kbRow, error: null }));
    chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null });
    return chain;
  });

  return { from };
}

beforeEach(() => {
  jest.clearAllMocks();
  generateContent.mockResolvedValue({ text: '{}', usageMetadata: {} });
});

describe('a completed dossier is not regenerated', () => {
  it('spends nothing when research has already completed', async () => {
    serviceRole.mockReturnValue(
      clientReturning({ research_status: 'completed', last_research_date: '2026-08-22T12:31:56Z' })
    );

    const outcome = await researchVehicleDossier(ACCORD, 'user-1');

    /*
      ⚠ The assertion. Not "returns quickly", not "logs something" — the model
      is never called, so there is no bill.
    */
    expect(generateContent).not.toHaveBeenCalled();
    expect(recordAiUsageInBackground).not.toHaveBeenCalled();

    expect(outcome.success).toBe(true);
    expect(outcome.alreadyResearched).toBe(true);
  });

  it('reports the short-circuit rather than passing as a generation', async () => {
    /*
      The sweep counts what it generated. A short-circuit reported as plain
      success would inflate `schedulesGenerated` with work that never happened
      — the one number that says whether C4 is earning its budget.
    */
    serviceRole.mockReturnValue(clientReturning({ research_status: 'completed' }));

    const outcome = await researchVehicleDossier(ACCORD, 'user-1');

    expect(outcome.alreadyResearched).toBe(true);
    expect(outcome.unsupported).toBeUndefined();
  });
});

describe('the guard does not disable the retry button', () => {
  /*
    ⚠ Anti-vacuous, and the direction that matters most. A guard that refused
    every call would pass both assertions above while breaking the feature the
    retry button exists for — a dossier that is genuinely missing.
  */
  it.each([['failed'], ['pending'], [null]])(
    'still generates when research_status is %p',
    async (status) => {
      serviceRole.mockReturnValue(
        clientReturning(status === null ? null : { research_status: status })
      );

      await researchVehicleDossier(ACCORD, 'user-1');

      expect(generateContent).toHaveBeenCalled();
    }
  );
});
