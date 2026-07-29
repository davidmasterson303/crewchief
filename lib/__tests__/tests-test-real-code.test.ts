/**
 * Every suite must exercise shipped code, not a copy of it.
 *
 * @jest-environment node
 *
 * This repo's signature failure, three times over:
 *
 *   - `security.test.ts` defined its own `runMiddlewareLogic()` and tested
 *     that, while the exported middleware was a no-op with an empty matcher.
 *     11 green tests asserting protection the app did not have.
 *   - `rls-ownership.test.ts` tests a `mockVehicleDb` and `simulate*` helpers
 *     defined in its own file. It was titled "RLS Ownership Verification"
 *     while the `vehicles` table's real policies were `USING (true)`.
 *   - `tco-calculator.test.ts` defined its own `calculateTCO` and
 *     `estimateResaleValue` while the shipped math lived in a component. The
 *     two copies drifted into different depreciation models and the suite
 *     stayed green for months.
 *
 * Each was found by hand, long after the fact. The rule that would have caught
 * all three is one line: **a test that imports nothing is testing itself.**
 *
 * Phase 2.4 asked for a sweep for a third instance. This is that sweep, made
 * permanent — moving files between packages is exactly when a test quietly
 * stops pointing at the thing it names, so the guard matters more during the
 * shared-package work than it did before it.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const TESTS_DIR = __dirname;

/**
 * Suites that legitimately import no application module because they *are*
 * static analysis — they read source files off disk and assert about their
 * contents. Each is verified below to actually do that, so an entry cannot be
 * used as a blanket excuse.
 */
const STATIC_ANALYSIS_SUITES = [
  'auth-posture.test.ts',
  'internal-fetch-posture.test.ts',
  'vehicles-rls-posture.test.ts',
  'portability.test.ts',
  'ws-optional-deps.test.ts',
  'illustration-tokens.test.ts',
  'env-parity.test.ts',
  'tests-test-real-code.test.ts',
  // Reads @google/genai's own dist entries to prove the protobufjs CRITICAL is
  // never loaded. Importing the tokenizer to test it would load the very module
  // the suite exists to show is unreachable.
  'protobufjs-unreachable.test.ts',
  // Reads app/actions.ts to prove a parameter is actually referenced. An unused
  // parameter raises no type error, so only a source scan catches it returning.
  'performance-goal.test.ts',
];

/**
 * Suites that deliberately model behaviour rather than exercise it.
 *
 * **This list may only shrink.** An entry here is an admission that the suite
 * proves nothing about shipped code, and it must say so in its own header so a
 * reader is not misled by the filename.
 */
const DECLARED_SIMULATIONS = ['rls-ownership.test.ts'];

/*
  App code is `@/…`, a relative path, or the shared workspace package.

  The `@crewchief/` arm was added when Phase 2.4 moved the first module into
  packages/core — and this suite failed the moment it did, which is the
  behaviour to keep. A suite whose subject moves out from under it should stop
  the build, not quietly start passing for the wrong reason.
*/
const IMPORTS_APP_CODE =
  /(?:from\s+|require\()\s*['"](?:@crewchief\/|@\/|\.\.?\/)(?!.*__tests__)/;

/*
  `.tsx` as well as `.ts`.

  Globbing only `.test.ts` was a silent hole in exactly the guard whose job is
  to catch tests that do not test anything: every component suite escaped it,
  and the way to evade the check was to name a file `.tsx`. Found when the
  illustration grid suite — a `.tsx` — was not picked up at all. Both existing
  `.tsx` suites already imported real modules, so closing it cost nothing;
  leaving it open would have cost the next one.
*/
function suites(): string[] {
  return readdirSync(TESTS_DIR).filter((f) => /\.test\.tsx?$/.test(f));
}

describe('every suite exercises shipped code', () => {
  const all = suites();

  it('found suites to check', () => {
    expect(all.length).toBeGreaterThan(15);
  });

  it.each(
    suites().filter(
      (f) => !STATIC_ANALYSIS_SUITES.includes(f) && !DECLARED_SIMULATIONS.includes(f)
    )
  )('%s imports a real module', (file) => {
    const source = readFileSync(join(TESTS_DIR, file), 'utf8');
    expect(source).toMatch(IMPORTS_APP_CODE);
  });

  it.each(STATIC_ANALYSIS_SUITES)('%s really is static analysis', (file) => {
    // An exemption that stopped being true is how an allowlist rots. If one of
    // these stops reading source off disk, it is an ordinary suite again and
    // should be importing what it tests.
    const source = readFileSync(join(TESTS_DIR, file), 'utf8');
    expect(source).toMatch(/readFileSync|readdirSync/);
  });

  it.each(DECLARED_SIMULATIONS)('%s admits in its header that it is a model', (file) => {
    // The failure mode is not the simulation, it is a simulation whose name
    // and docblock claim it verifies the real thing.
    const source = readFileSync(join(TESTS_DIR, file), 'utf8');
    const header = source.slice(0, source.indexOf('*/'));
    expect(header).toMatch(/does not test|simulation|model/i);
  });

  it('keeps the simulation list from growing', () => {
    // Deliberately pinned rather than compared to a count, so adding an entry
    // is a decision someone has to write down here.
    expect(DECLARED_SIMULATIONS).toEqual(['rls-ownership.test.ts']);
  });
});
