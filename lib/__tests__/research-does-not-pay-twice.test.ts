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
import {
  RESEARCH_TIMEOUT_MS,
  SWEEP_RESEARCH_TIMEOUT_MS,
  researchVehicleDossier,
} from '@/lib/vehicle-research';
import { SWEEP_GENERATE_CAP } from '@wellkept/core/notification-sweep';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

describe('nobody is watching the sweep, so it waits longer', () => {
  /*
    ⚠ Measured 22 Aug, after a 30s budget lost a car permanently. The dossier
    call takes 23-30 seconds and `RESEARCH_TIMEOUT_MS` is 30 — not a timeout, a
    coin flip. Both faces were observed the same day: one run finished at ~30s,
    a sweep run an hour later timed out on the same kind of car.

    The sweep's timeout is not recoverable the way an interactive one is. It
    writes `research_status = 'failed'`, and filter 1 in `vehiclesToGenerate`
    never offers a failed car again — correctly, since retrying a genuine
    failure nightly is the runaway that module prevents. The escape hatch is
    the retry button, and the sweep exists for owners who are not in the app to
    press it.
  */

  it('gives the unwatched path a longer budget than the watched one', () => {
    expect(SWEEP_RESEARCH_TIMEOUT_MS).toBeGreaterThan(RESEARCH_TIMEOUT_MS);
  });

  it('leaves room above the measured call time rather than sitting on it', () => {
    // 23-30s observed. A budget inside that range is the defect being fixed.
    expect(SWEEP_RESEARCH_TIMEOUT_MS).toBeGreaterThanOrEqual(45_000);
  });

  it('cannot outlast the scheduled function it runs inside', () => {
    /*
      ⚠ The second-order failure, asserted rather than left in prose: the
      budget multiplies against the generation cap. Ten cars at sixty seconds
      is ten minutes of a Netlify scheduled function that gets fifteen, before
      NHTSA fetches. Raising either number alone is how a sweep starts dying
      halfway through and reporting a partial night as a whole one.
    */
    const worstCaseMs = SWEEP_GENERATE_CAP * SWEEP_RESEARCH_TIMEOUT_MS;
    const functionCeilingMs = 15 * 60 * 1000;

    expect(worstCaseMs).toBeLessThan(functionCeilingMs * 0.8);
  });

  it('is what the sweep actually passes', () => {
    // The constant existing is not the same as the sweep using it.
    const route = readFileSync(
      join(__dirname, '..', '..', 'app', 'api', 'internal', 'notify-sweep', 'route.ts'),
      'utf8'
    ).replace(/\/\*[\s\S]*?\*\//g, ' ');

    expect(route).toMatch(/timeoutMs:\s*SWEEP_RESEARCH_TIMEOUT_MS/);
  });

  it('honours a caller-supplied budget instead of the default', async () => {
    /*
      Behavioural, and the reason the option exists at all. A model call that
      never answers must be abandoned at the budget the caller set — proven
      with a tiny one so the test does not wait.
    */
    serviceRole.mockReturnValue(clientReturning({ research_status: 'pending' }));
    generateContent.mockImplementation(() => new Promise(() => {}));

    const outcome = await researchVehicleDossier(ACCORD, 'user-1', { timeoutMs: 40 });

    expect(outcome.success).toBe(false);
  });

  it('still defaults to the interactive budget when no option is given', () => {
    /*
      ⚠ Anti-vacuous in the direction that would go unnoticed: defaulting to
      the *longer* value would quietly make every dashboard visit willing to
      hang for a minute, which is the trade the interactive docblock refuses.
    */
    const source = readFileSync(join(__dirname, '..', 'vehicle-research.ts'), 'utf8');
    expect(source).toMatch(/options\.timeoutMs\s*\?\?\s*RESEARCH_TIMEOUT_MS/);
  });
});
