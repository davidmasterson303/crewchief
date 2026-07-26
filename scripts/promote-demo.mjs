/**
 * Promote the current `main` to the public demo.
 *
 * ── The problem this solves ─────────────────────────────────────────────────
 *
 * crewchief-demo.davidmasterson.co is linked from David's portfolio and shown
 * to recruiters during an active job search. Two bad options were available
 * before this script existed:
 *
 *   - Point the demo domain at `main`. Every push goes live instantly,
 *     including a half-finished refactor at 11pm.
 *   - Leave the demo frozen. Safe, but it drifts: none of the design-system
 *     work is visible to anyone, so the portfolio piece slowly stops
 *     representing the product.
 *
 * So the demo builds from its own branch, `demo-live`, and this is the only
 * way that branch moves. UI improvements reach the demo on a cadence we
 * choose, and can never arrive by accident.
 *
 * ── The gate ────────────────────────────────────────────────────────────────
 *
 * Everything is verified against the CI site, which already builds `main` —
 * meaning we check the *exact build* that is about to become the demo, before
 * it becomes the demo. Verifying afterwards would only tell us what we broke.
 *
 * The version check matters more than it looks. This project once read a
 * cached 200 as proof a new build was live. /api/version reports the commit
 * it was built from, so "the deploy finished" stops being an assumption.
 *
 *   node scripts/promote-demo.mjs            # dry run — checks, no merge
 *   node scripts/promote-demo.mjs --apply    # promote
 */

import { execSync } from 'node:child_process';

const APPLY = process.argv.includes('--apply');

const CANDIDATE = process.env.CREWCHIEF_CI_URL
  || 'https://effulgent-blancmange-6adfdf.netlify.app';
const DEMO = 'https://crewchief-demo.davidmasterson.co';
const RELEASE_BRANCH = 'demo-live';

const sh = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();

let failed = 0;
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => { failed++; console.log(`  \x1b[31m✗\x1b[0m ${m}`); };

console.log(`\n${APPLY ? 'PROMOTING' : 'DRY RUN — nothing will be merged'}`);
console.log(`candidate: ${CANDIDATE}\ndemo:      ${DEMO}\n`);

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
  : bad(`${ahead} unpushed commit(s) — CI cannot have built them yet`);

const head = sh('git rev-parse HEAD');
console.log(`    HEAD ${head.slice(0, 8)}`);

/* 2 ── local checks -------------------------------------------------------- */
console.log('\nLocal checks');
for (const [label, cmd] of [['typecheck', 'npm run typecheck'], ['tests', 'npx jest --silent']]) {
  try {
    execSync(cmd, { stdio: 'pipe' });
    ok(label);
  } catch {
    bad(`${label} failed — run it directly to see why`);
  }
}

/* 3 ── is the candidate actually serving this commit? ---------------------- */
console.log('\nCandidate build');
try {
  const res = await fetch(`${CANDIDATE}/api/version`, { cache: 'no-store' });
  const { commit } = await res.json();

  if (commit === head) {
    ok(`serving ${commit.slice(0, 8)} — matches HEAD`);
  } else if (commit === 'unknown') {
    bad('reports "unknown" — set COMMIT_REF in the Netlify build env');
  } else {
    bad(`serving ${String(commit).slice(0, 8)}, expected ${head.slice(0, 8)} — deploy still building, or it failed`);
  }
} catch (e) {
  bad(`/api/version unreachable (${e.message}) — deploy this route before promoting`);
}

/* 4 ── the demo contract, against the candidate ---------------------------- */
console.log('\nDemo contract (against the candidate)');
try {
  execSync(`node scripts/verify-demo.mjs ${CANDIDATE}`, { stdio: 'pipe' });
  ok('verify-demo passed');
} catch {
  bad('verify-demo failed — run it directly; this is the release blocker');
}

/* 5 ── promote ------------------------------------------------------------- */
console.log('\n' + '─'.repeat(60));

if (failed > 0) {
  console.log(`\x1b[31m${failed} check(s) failed\x1b[0m — not promoting.\n`);
  process.exit(1);
}
if (!APPLY) {
  console.log('\x1b[32mAll checks passed.\x1b[0m Re-run with --apply to promote.\n');
  process.exit(0);
}

console.log(`\nMerging main into ${RELEASE_BRANCH}`);
try {
  // --no-ff keeps each promotion a single, revertible point in history. If a
  // promotion turns out badly, reverting one merge commit restores the demo.
  sh(`git checkout ${RELEASE_BRANCH}`);
  sh(`git merge --no-ff main -m "Promote ${head.slice(0, 8)} to the public demo"`);
  sh(`git push origin ${RELEASE_BRANCH}`);
  ok(`${RELEASE_BRANCH} pushed`);
} catch (e) {
  console.error(`\npromotion failed: ${e.message}`);
  console.error(`you may be left on ${RELEASE_BRANCH} — check "git status" before continuing.\n`);
  process.exit(1);
} finally {
  try { sh('git checkout main'); } catch {}
}

console.log(`
Netlify is building the demo now. When it finishes:

  node scripts/verify-demo.mjs

and confirm ${DEMO}/api/version reports ${head.slice(0, 8)}.

To undo: revert the merge commit on ${RELEASE_BRANCH} and push. The demo
returns to its previous build without touching main.
`);
