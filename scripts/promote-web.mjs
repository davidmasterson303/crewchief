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
import { awaitDeploy } from './lib/await-deploy.mjs';

const APPLY = process.argv.includes('--apply');

const RELEASE_BRANCH = 'web-live';
const SITE = 'https://crewchief.davidmasterson.co';

/** How long to wait for Netlify. A cold Next build here runs about a minute. */
/* The poll's timing lives in `scripts/lib/await-deploy.mjs`, shared with the demo. */

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
/*
  ── ⚠ BLD-01 · `next build` runs here now ──────────────────────────────────

  It did not. This loop was typecheck and tests, and **nothing in either
  promote script ever built the app** — while `package.json` already provided
  the safe local build (`build:verify`, writing to `.next-verify`) and
  `next.config.js` exists partly to make that possible. The mechanism was built
  and then not wired in.

  What that let through: a Server Component that typechecks and unit-tests fine
  and **fails at build** — a static-generation error, a `next/headers` call in
  the wrong scope, an OOM on the builder. It gets merged and pushed, the script
  polls `/api/version` for six minutes, times out, and reports that the hostname
  is serving its previous build. By then the merge is already public on
  `origin/web-live`, and the App Store hostname is frozen on an old deploy with
  nothing saying why.

  ⚠ **`build:verify`, not `build`.** They share `.next`, and `package.json`'s
  own notes record what that costs: a build while `npm run dev` is running
  replaces the chunks the dev server is serving, every `/_next/static` request
  404s, and the page renders as unstyled HTML that never hydrates — presenting
  as dead buttons rather than an error. `NEXT_DIST_DIR=.next-verify` is what
  keeps a promote from breaking the terminal beside it.

  It is last in the list because it is by far the slowest, and there is no
  reason to spend two minutes building code whose types do not check.

  ⚠ **The first run of this rewrites `tsconfig.json`**, because Next adds its
  dist directory's generated types to `include` — and with `NEXT_DIST_DIR` set
  that path is `.next-verify/types`, which was not there. It reformats the file
  while it is at it.

  That is a one-time cost and it is **committed**, so subsequent runs change
  nothing. Verified: a second `build:verify` against the committed file leaves
  it byte-identical. Had it not been, this gate would have dirtied the working
  tree on every run and then failed its own "uncommitted changes" check above —
  a gate that breaks the next use of itself.
*/
for (const [label, cmd] of [
  ['typecheck', 'npm run typecheck'],
  ['tests', 'npx jest --silent'],
  ['build', 'npm run build:verify'],
]) {
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

const live = await awaitDeploy({
  hostname: SITE,
  expectCommit: mergeCommit,
  label: 'web',
});

if (!live) process.exit(1);

console.log(`
\x1b[32m${SITE} is live on ${mergeCommit.slice(0, 8)}.\x1b[0m

The App Store hostname and the mobile app's API now serve this build.

To move the public demo to the same commit:   node scripts/promote-demo.mjs
To undo: revert the merge commit on ${RELEASE_BRANCH} and push. main is untouched.
`);
