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
  credentialReason,
  exitCodeFor,
  parseArgs,
  tokenExpiry,
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

describe('an expired credential is not evidence about the API', () => {
  /*
    ⚠ 22 Aug. `verify-mobile-contract.mjs` ran against a token that expired on
    2 Aug and reported three blocking failures, one of them
    "/api/v1/vehicles rejected a valid bearer token — a phone cannot load the
    garage". Every word wrong except the status code: the bearer was not
    valid, the route was not broken, and a 401 is the correct answer to an
    expired token.

    CLAUDE.md §5's second warning — a guard that fails loudly and points at the
    wrong thing — on the check that gates a mobile build.
  */

  /** A JWT with only the claim this reads. Signature is irrelevant and absent. */
  function jwtExpiring(atSeconds: number): string {
    const payload = Buffer.from(JSON.stringify({ exp: atSeconds })).toString('base64url');
    return `header.${payload}.signature`;
  }

  const NOW = new Date('2026-08-22T14:00:00Z');
  const EXPIRED = jwtExpiring(Math.floor(new Date('2026-08-02T02:58:00Z').getTime() / 1000));
  const VALID = jwtExpiring(Math.floor(new Date('2026-09-30T00:00:00Z').getTime() / 1000));

  it('reads the expiry out of a token', () => {
    expect(tokenExpiry(EXPIRED)?.toISOString()).toBe('2026-08-02T02:58:00.000Z');
  });

  it('names the expiry as the reason, with its date', () => {
    // The date is the whole point: "expired" alone still invites a debugging
    // session. "expired 2026-08-02" ends one.
    expect(credentialReason(EXPIRED, NOW)).toBe('MOBILE_TEST_TOKEN expired 2026-08-02');
  });

  it('distinguishes an expired token from an absent one', () => {
    /*
      They are different situations with different fixes, and the script
      previously treated only the absent case as "not run" — which is why the
      expired one surfaced as a broken API.
    */
    expect(credentialReason('', NOW)).toBe('MOBILE_TEST_TOKEN is not set');
    expect(credentialReason(EXPIRED, NOW)).not.toBe(credentialReason('', NOW));
  });

  it('says nothing is wrong with a token that is still good', () => {
    /*
      ⚠ Anti-vacuous, and the direction that matters. A helper that always
      reported a reason would turn every credentialed check into NOT RUN
      forever — silencing the half of the suite that gates a mobile build,
      which is worse than the false alarm it replaced.
    */
    expect(credentialReason(VALID, NOW)).toBeNull();
  });

  it('treats a token it cannot parse as usable, and lets the server decide', () => {
    /*
      A local parser failing is not grounds to skip a real check. The server's
      401 remains the authority; this only tells a human which situation they
      are in.
    */
    expect(tokenExpiry('not-a-jwt')).toBeNull();
    expect(tokenExpiry('a.!!!.c')).toBeNull();
    expect(credentialReason('not-a-jwt', NOW)).toBeNull();
  });

  it('does not treat a token expiring later today as expired', () => {
    // Boundary, in the direction that would silence a working credential.
    const laterToday = jwtExpiring(Math.floor(NOW.getTime() / 1000) + 3600);
    expect(credentialReason(laterToday, NOW)).toBeNull();
  });
});
