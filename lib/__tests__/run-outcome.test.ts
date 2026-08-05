/**
 * The exit-code rules for a partial verification run.
 *
 * @jest-environment node
 *
 * Same argument as `response-contract.test.ts`: the behaviour lives in a
 * verification script, so running the script cannot establish it. A green run
 * against a healthy target proves nothing about what the script would have
 * returned against a sick one — and the specific bug here was that a *partial*
 * run returned the same code as a clean one.
 *
 * The rules are therefore pure, in `scripts/lib/run-outcome.mjs`, and pinned
 * here against the exact states this repo has actually been in.
 */

import {
  classifyRun,
  exitCodeFor,
  parseArgs,
  OUTCOME,
} from '../../scripts/lib/run-outcome.mjs';

describe('classifyRun', () => {
  it('calls a clean run a pass', () => {
    expect(classifyRun({ failures: 0, notRun: 0 })).toBe(OUTCOME.PASS);
  });

  it('calls a skipped check a partial, not a pass', () => {
    // The state after `MOBILE_TEST_TOKEN` is unset: three credentialed checks
    // skip. This is the one the old code reported as exit 0.
    expect(classifyRun({ failures: 0, notRun: 3 })).toBe(OUTCOME.PARTIAL);
  });

  it('lets a failure outrank a skip', () => {
    // Something ran and was wrong. That is the headline regardless of how many
    // other checks were skipped — reporting PARTIAL here would bury it.
    expect(classifyRun({ failures: 1, notRun: 3 })).toBe(OUTCOME.FAIL);
  });
});

describe('exitCodeFor', () => {
  it('keeps a partial run non-blocking by default', () => {
    // A developer with no token wants the four anonymous checks and an honest
    // summary, not a red build for a credential they never had.
    expect(exitCodeFor(OUTCOME.PARTIAL)).toBe(0);
  });

  it('blocks a partial run under --strict', () => {
    expect(exitCodeFor(OUTCOME.PARTIAL, { strict: true })).toBe(1);
  });

  it('does not let strict mode change a pass or a failure', () => {
    // Strict is a question about skips only. If it changed either of these it
    // would be a different check depending on how it was invoked.
    expect(exitCodeFor(OUTCOME.PASS, { strict: true })).toBe(0);
    expect(exitCodeFor(OUTCOME.PASS, { strict: false })).toBe(0);
    expect(exitCodeFor(OUTCOME.FAIL, { strict: true })).toBe(1);
    expect(exitCodeFor(OUTCOME.FAIL, { strict: false })).toBe(1);
  });

  it('closes the hole that deleting the credential opened', () => {
    /*
      The two states the token can be in, and the reason this file exists.

      Set-but-expired → the checks run and fail → exit 1.
      Unset           → the checks skip        → exit 0, before --strict.

      So the cheapest cure for the red build was to remove the input. Under
      --strict both are 1, and the only way to a zero is to supply a working
      credential.
    */
    const expired = classifyRun({ failures: 3, notRun: 0 });
    const deleted = classifyRun({ failures: 0, notRun: 3 });

    expect(exitCodeFor(expired, { strict: false })).toBe(1);
    expect(exitCodeFor(deleted, { strict: false })).toBe(0);

    expect(exitCodeFor(expired, { strict: true })).toBe(1);
    expect(exitCodeFor(deleted, { strict: true })).toBe(1);
  });
});

describe('parseArgs', () => {
  const defaultBase = 'http://localhost:3000';

  it('defaults to localhost with no arguments', () => {
    expect(parseArgs(['node', 'script'], { defaultBase })).toMatchObject({
      base: defaultBase,
      strict: false,
    });
  });

  it('takes a deployment URL positionally and strips a trailing slash', () => {
    expect(
      parseArgs(['node', 'script', 'https://example.com/'], { defaultBase })
    ).toMatchObject({ base: 'https://example.com', strict: false });
  });

  it('does not mistake a flag for the target', () => {
    // The bug this replaced: argv[2] was read straight as the base URL, so
    // `--strict` with no URL would have been tested as a website.
    expect(parseArgs(['node', 'script', '--strict'], { defaultBase })).toMatchObject({
      base: defaultBase,
      strict: true,
    });
  });

  it('takes a URL and a flag in either order', () => {
    const a = parseArgs(['node', 's', 'https://x.dev', '--strict'], { defaultBase });
    const b = parseArgs(['node', 's', '--strict', 'https://x.dev'], { defaultBase });
    expect(a).toMatchObject({ base: 'https://x.dev', strict: true });
    expect(b).toMatchObject({ base: 'https://x.dev', strict: true });
  });

  it('reports an unknown flag rather than ignoring it', () => {
    // A typo'd `--strick` that silently ran non-strict would be the same class
    // of quiet degradation this whole change is about.
    expect(parseArgs(['node', 's', '--strick'], { defaultBase }).unknownFlags).toEqual([
      '--strick',
    ]);
  });
});
