/**
 * Wait for a hostname to serve a specific commit.
 *
 * ── ⚠ Why this is shared, and why it was not (BLD-02) ───────────────────────
 *
 * `promote-web.mjs` polled `/api/version` every 15s for six minutes and exited
 * 1 with a specific diagnosis. `promote-demo.mjs` printed *"Netlify is building
 * the demo now. When it finishes: node scripts/verify-demo.mjs"* — an
 * instruction, and trust that somebody would follow it.
 *
 * That is **inverted relative to the risk that actually matters**. The demo is
 * recruiter-facing during an active job search, and the failure mode of a
 * broken `demo-live` build is a stale or dead portfolio piece with nothing
 * anywhere saying so. `verify-demo.mjs` runs *before* the merge, against the
 * candidate, and never after — so nothing in the pipeline ever looked at what
 * the demo hostname ended up serving.
 *
 * One implementation, so the two hostnames are held to the same standard and
 * the poll's timing lives in one place.
 *
 * ── ⚠ The commit to expect is the MERGE commit ──────────────────────────────
 *
 * `/api/version` reports the head of the branch Netlify built, which is the
 * `--no-ff` merge — **never** the `main` commit named in the merge message.
 * Checking for the latter and concluding a good deploy failed has cost real
 * time on this project already, so both callers pass the merge commit and this
 * file says so where somebody changing it will read it.
 */

const POLL_MS = 15_000;
const DEPLOY_TIMEOUT_MS = 6 * 60_000;

export async function awaitDeploy({
  hostname,
  expectCommit,
  label,
  pollMs = POLL_MS,
  timeoutMs = DEPLOY_TIMEOUT_MS,
}) {
  const short = String(expectCommit).slice(0, 8);
  console.log(`\nWaiting for Netlify — expecting ${short} at ${hostname}`);

  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    /*
      Waits first, then asks. A build has not started when the push returns, so
      the immediate poll is guaranteed to report the previous commit and would
      only add a confusing line to the top of the log.
    */
    await new Promise((resolve) => setTimeout(resolve, pollMs));

    try {
      const res = await fetch(`${hostname}/api/version`, { cache: 'no-store' });
      const body = await res.json();

      if (body.commit === expectCommit) {
        console.log(`  \x1b[32m✓\x1b[0m serving ${short} on ${body.branch}`);
        return true;
      }

      console.log(`    still ${String(body.commit).slice(0, 8)} (${body.branch})`);
    } catch {
      /*
        Not a failure on its own. A deploying site can refuse connections or
        answer with an old function for a few seconds, and treating that as
        fatal would abort a promote that was about to succeed.
      */
      console.log('    no answer yet');
    }
  }

  console.error(`
\x1b[31mThe ${label} deploy did not appear within ${timeoutMs / 60000} minutes.\x1b[0m

The merge is pushed, so this is a Netlify problem rather than a git one. Until
the build succeeds the hostname is serving its previous build — which is safe,
but it is NOT what you just promoted, and nothing else will tell you that.
`);

  return false;
}
