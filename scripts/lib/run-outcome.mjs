/**
 * How a partial verification run reports itself to a machine.
 *
 * `verify-mobile-contract.mjs` already tells a *human* the truth: it prints
 * NOT RUN per skipped check and a PARTIAL summary saying "this is not a green
 * build". Its own header cites §25 — the health check that degraded a 404 into
 * a shrug — as the thing it refuses to do.
 *
 * **It then exits 0.** So to anything reading the exit code rather than the
 * console, a partial run and a clean run are the same event. That is the same
 * defect the header disclaims, one layer down, and it is the layer that gates
 * automation.
 *
 * ── The shape that makes it worth fixing rather than noting ─────────────────
 *
 * The credentialed checks skip when `MOBILE_TEST_TOKEN` is unset, and they
 * *fail* when it is set and expired — which is the state the repo has been in
 * since 02:58 UTC on 2 Aug. So the cheapest way to turn this red check green
 * is to **delete the credential**: failures go to zero, notRun goes to three,
 * and the exit code goes from 1 to 0. A check whose loudest failure is cured
 * by removing the input is not a check yet.
 *
 * `--strict` is the fix rather than changing the default, deliberately. A
 * developer running this locally without a token wants the four anonymous
 * checks and an honest summary, not a red build for a token they never had.
 * An automated caller wants the opposite. Those are different questions and
 * the flag is which one is being asked.
 */

export const OUTCOME = {
  PASS: 'pass',
  PARTIAL: 'partial',
  FAIL: 'fail',
};

/**
 * A failure outranks a skip: if something ran and was wrong, that is the
 * headline whether or not other checks were also skipped.
 */
export function classifyRun({ failures, notRun }) {
  if (failures > 0) return OUTCOME.FAIL;
  if (notRun > 0) return OUTCOME.PARTIAL;
  return OUTCOME.PASS;
}

/**
 * Strict mode is the only thing that changes, and it only changes PARTIAL.
 * A pass is a pass and a failure is a failure under either reading.
 */
export function exitCodeFor(outcome, { strict = false } = {}) {
  if (outcome === OUTCOME.FAIL) return 1;
  if (outcome === OUTCOME.PARTIAL) return strict ? 1 : 0;
  return 0;
}

/**
 * The target URL, separated from flags.
 *
 * `process.argv[2]` was read directly as the base URL, so
 * `node verify-mobile-contract.mjs --strict` would have treated `--strict` as
 * the site to test and reported a connection failure against it. Found while
 * adding the flag, which is the ordinary way this kind of thing is found.
 */
export function parseArgs(argv, { defaultBase }) {
  const args = argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith('--')));
  const positional = args.filter((a) => !a.startsWith('--'));
  return {
    base: (positional[0] || defaultBase).replace(/\/$/, ''),
    strict: flags.has('--strict'),
    unknownFlags: [...flags].filter((f) => f !== '--strict'),
  };
}
