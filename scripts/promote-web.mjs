/**
 * Promote the current `main` to the web release branch.
 *
 * ── What this publishes, which is more than it sounds ───────────────────────
 *
 * `web-live` is served by `effulgent-blancmange-6adfdf`, which holds
 * **crewchief.davidmasterson.co** — the App Store listing's privacy-policy URL
 * and the origin every installed copy of the mobile app talks to. Merging here
 * is the act that moves both.
 *
 * Nothing else does. `main` takes every commit and never deploys, which is what
 * took the Netlify bill from 111 builds in 17 days to a merge you performed
 * on purpose.
 *
 *   node scripts/promote-web.mjs            # dry run — checks, no merge
 *   node scripts/promote-web.mjs --apply    # promote
 *
 * ── ⚠ How this gate differs from `promote-demo.mjs`, and why ────────────────
 *
 * The demo gate verifies **the exact build that is about to become the demo,
 * before it becomes the demo** — it can, because that commit is already live on
 * `web-live`'s hostname. This gate has no such luxury: nothing deploys `main`,
 * so there is no running build of the candidate to interrogate. That is the
 * cost of the change that removed the always-on CI site, and it was accepted
 * knowingly.
 *
 * So the honest split is:
 *
 *   before merging   everything decidable from the source — typecheck, both
 *                    suites, a clean tree, main actually pushed
 *   after merging    that the deploy landed and is serving the merge commit
 *
 * The second half is not decoration. Netlify can accept a push and fail the
 * build, and the failure mode of *this* branch is a hostname silently frozen on
 * its last good deploy — the 29 July failure wearing a new hat. So this script
 * waits and looks, rather than printing an instruction and trusting you to.
 *
 * ── The pipeline this sits in ───────────────────────────────────────────────
 *
 *   main  ->  promote-web   ->  web-live   ->  promote-demo  ->  demo-live
 *                               (verified live, and is then
 *                                the demo gate's candidate)
 */

import { execSync } from 'node:child_process';

const APPLY = process.argv.includes('--apply');

const RELEASE_BRANCH = 'web-live';
const SITE = 'https://crewchief.davidmasterson.co';

/** How long to wait for Netlify. A cold Next build here runs about a minute. */
const DEPLOY_TIMEOUT_MS = 6 * 60 * 1000;
const POLL_MS = 15 * 1000;

const sh = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();

let failed = 0;
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => { failed++; console.log(`  \x1b[31m✗\x1b[0m ${m}`); };

console.log(`\n${APPLY ? 'PROMOTING' : 'DRY RUN — nothing will be merged'}`);
console.log(`branch:  ${RELEASE_BRANCH}\nserves:  ${SITE}\n`);

/* 1 ── the working tree ---------------------------------------------------- */
console.log('Working tree');

const branch = sh('git rev-parse --abbrev-ref HEAD');
branch === 'main'
  ? ok('on main')
  : bad(`on "${branch}" — promote from main, so what ships is what was reviewed`);

sh('git status --porcelain') === ''
  ? ok('clean')
  : bad('uncommitted changes — commit or stash first');

sh('git fetch origin --quiet || true');
const ahead = sh('git rev-list --count origin/main..main');
ahead === '0'
  ? ok('main is pushed')
  : bad(`${ahead} unpushed commit(s) — push before promoting`);

const head = sh('git rev-parse HEAD');
console.log(`    HEAD ${head.slice(0, 8)}`);

/* 2 ── what this would actually change ------------------------------------- */
console.log(`\nWhat moves`);
const pending = sh(`git log --oneline ${RELEASE_BRANCH}..main`);
if (pending === '') {
  ok(`${RELEASE_BRANCH} is already at main — nothing to promote`);
} else {
  const lines = pending.split('\n');
  ok(`${lines.length} commit(s) would go live`);
  /*
    Printed, not counted. This is the one moment somebody can notice that a
    commit they did not expect is about to reach a public hostname, and a
    number cannot be read for that.
  */
  for (const line of lines.slice(0, 12)) console.log(`      ${line}`);
  if (lines.length > 12) console.log(`      … and ${lines.length - 12} more`);
}

/* 3 ── local checks -------------------------------------------------------- */
console.log('\nLocal checks');
for (const [label, cmd] of [['typecheck', 'npm run typecheck'], ['tests', 'npx jest --silent']]) {
  try {
    execSync(cmd, { stdio: 'pipe' });
    ok(label);
  } catch {
    bad(`${label} failed — run it directly to see why`);
  }
}

/*
  ⚠ The mobile suite is checked too, and it is not padding. `apps/mobile` never
  reaches this site, but `packages/core` is shared — a change that satisfies the
  web suite and breaks the phone is exactly the shape this monorepo produces,
  and promoting is when it becomes somebody else's problem.
*/
try {
  execSync('npx jest --silent', { stdio: 'pipe', cwd: 'apps/mobile' });
  ok('mobile tests (shared core)');
} catch {
  bad('mobile tests failed — packages/core is shared; check before publishing');
}

/* 4 ── stop, or go --------------------------------------------------------- */
console.log('\n' + '─'.repeat(60));
if (failed > 0) {
  console.error(`\x1b[31m${failed} check(s) failed.\x1b[0m Nothing was merged.\n`);
  process.exit(1);
}
if (!APPLY) {
  console.log('\x1b[32mAll checks passed.\x1b[0m Re-run with --apply to promote.\n');
  process.exit(0);
}
if (pending === '') {
  console.log('Nothing to promote.\n');
  process.exit(0);
}

/* 5 ── merge --------------------------------------------------------------- */
console.log(`\nMerging main into ${RELEASE_BRANCH}`);
let mergeCommit = '';
try {
  // --no-ff so each promotion is one revertible point. Reverting a single merge
  // commit restores the hostname without touching main.
  sh(`git checkout ${RELEASE_BRANCH}`);
  sh(`git merge --no-ff main -m ${JSON.stringify(`Promote ${head.slice(0, 8)} to the web release branch`)}`);
  sh(`git push origin ${RELEASE_BRANCH}`);
  mergeCommit = sh(`git rev-parse ${RELEASE_BRANCH}`);
  ok(`${RELEASE_BRANCH} pushed — ${mergeCommit.slice(0, 8)}`);
} catch (e) {
  console.error(`\npromotion failed: ${e.message}`);
  console.error(`you may be left on ${RELEASE_BRANCH} — check "git status" before continuing.\n`);
  process.exit(1);
} finally {
  try { sh('git checkout main'); } catch {}
}

/* 6 ── watch it land ------------------------------------------------------- */
/*
  ⚠ `/api/version` reports the **merge** commit, never the `main` commit named
  in the message. Netlify builds this branch, so its HEAD is the --no-ff merge
  just made. Checking for `head` instead is how somebody concludes a good deploy
  failed — it has cost real time on the demo side already.
*/
console.log(`\nWaiting for Netlify — expecting ${mergeCommit.slice(0, 8)} at ${SITE}`);

const deadline = Date.now() + DEPLOY_TIMEOUT_MS;
let live = false;

while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, POLL_MS));
  try {
    const res = await fetch(`${SITE}/api/version`, { cache: 'no-store' });
    const body = await res.json();
    if (body.commit === mergeCommit) {
      ok(`serving ${mergeCommit.slice(0, 8)} on ${body.branch}`);
      live = true;
      break;
    }
    console.log(`    still ${String(body.commit).slice(0, 8)} (${body.branch})`);
  } catch {
    console.log('    no answer yet');
  }
}

if (!live) {
  console.error(`
\x1b[31mThe deploy did not appear within ${DEPLOY_TIMEOUT_MS / 60000} minutes.\x1b[0m

The merge is pushed, so this is a Netlify problem rather than a git one. Check
the deploy log for ${RELEASE_BRANCH}. Until it succeeds the hostname is serving
its previous build — which is safe, but it is NOT what you just promoted, and
nothing else will tell you that.
`);
  process.exit(1);
}

console.log(`
\x1b[32m${SITE} is live on ${mergeCommit.slice(0, 8)}.\x1b[0m

The App Store hostname and the mobile app's API now serve this build.

To move the public demo to the same commit:   node scripts/promote-demo.mjs
To undo: revert the merge commit on ${RELEASE_BRANCH} and push. main is untouched.
`);
