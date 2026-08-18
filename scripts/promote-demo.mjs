/**
 * Promote the current `main` to the public demo — and to the app's backend.
 *
 * ⚠ **Read this first if you have not run it since 17 Aug.** `demo-live` no
 * longer serves only the portfolio demo. `crewchief.davidmasterson.co` — the
 * App Store listing's privacy-policy URL, and the origin every installed copy
 * of the mobile app talks to — is served by the same project.
 *
 * So a promote is no longer a cosmetic act. Same gate, higher stakes: it
 * publishes the API that shipped apps depend on. Two things follow.
 *
 *   1. Do not run it casually to show someone a new screen.
 *   2. A mobile build needing a new `/api/v1/*` route must be promoted
 *      **before** that build ships, or it calls an endpoint that is not there.
 *
 * That gating was the point rather than a side effect: before it, anything
 * pushed to `main` was instantly live at a URL App Review reads.
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
import { readFileSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');

/*
  Waives a `degraded` consultant round trip — Gemini rate-limited or down —
  and NOTHING else. A `broken` verdict is ours and is not overridable at all.

  Deliberately command-line only, with no env-var or config-file equivalent,
  so it cannot become the default by accident. The reason it waives is printed
  in full and written into the merge commit body, because promotions are
  --no-ff and `git log demo-live` should record every time the gate was
  bypassed and why. A door that logs is what stops people making their own.
*/
const ALLOW_DEGRADED_AI = process.argv.includes('--allow-degraded-ai');

/** Set by the consultant check so the merge commit can record a waiver. */
let degradedWaiver = null;

const CANDIDATE = process.env.CREWCHIEF_CI_URL
  || 'https://effulgent-blancmange-6adfdf.netlify.app';
const DEMO = 'https://crewchief-demo.davidmasterson.co';

/** Read from the environment, never argv — a secret in argv is in the process table. */
const CONSULTANT_SECRET =
  process.env.CONSULTANT_HEALTH_SECRET ||
  (() => {
    try {
      const line = readFileSync(new URL('../.env', import.meta.url), 'utf8')
        .split('\n')
        .find((l) => l.startsWith('CONSULTANT_HEALTH_SECRET='));
      return line ? line.slice('CONSULTANT_HEALTH_SECRET='.length).trim() : '';
    } catch {
      return '';
    }
  })();
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

/* 3b ── the share card resolves to somewhere real -------------------------- */
/*
  The audit's F1, made un-repeatable.

  `openGraph.images` was a relative URL with no `metadataBase`, so Next 13.5
  silently resolved it against http://localhost:3000 — no warning, no build
  failure, and a deployed page that asked every scraper to fetch the preview
  from its own machine. The demo domain is linked from David's portfolio, so
  the one artefact that had to work was the one that never had.

  Checked here rather than in a unit test because it is a property of the
  *built and deployed* HTML: metadataBase resolves at render time and reads an
  env var, so a green local build proves nothing about what Netlify serves.
  This is the same reasoning that put the /api/version check above it.
*/
console.log('\nShare card (against the candidate)');
try {
  const html = await (await fetch(`${CANDIDATE}/`, { cache: 'no-store' })).text();
  const image = html.match(/property="og:image"\s+content="([^"]+)"/)?.[1];

  if (!image) {
    bad('no og:image in the deployed HTML — app/opengraph-image.tsx did not render');
  } else if (!/^https:\/\//.test(image)) {
    bad(`og:image is not absolute https (${image}) — metadataBase is unset or wrong`);
  } else if (/localhost|127\.0\.0\.1/.test(image)) {
    bad(`og:image points at ${image} — this is F1 returning`);
  } else {
    ok(`og:image declared absolute — ${image.replace(/\?.*$/, '')}`);

    /*
      The HEAD goes to the *candidate's* origin, not to the URL in the tag.

      metadataBase is the production literal, so a candidate build correctly
      advertises the production domain — fetching that URL would test the
      currently-promoted demo, which is the build we are trying to replace. On
      a first deploy of this route that is a guaranteed 404, and the first run
      of this gate produced exactly that: a red check describing prod while the
      candidate was fine.

      Swapping the origin keeps both halves honest: the tag is checked for what
      it claims, and the route is checked where the claim will be true once
      this build is promoted.
    */
    const path = new URL(image).pathname + new URL(image).search;
    const head = await fetch(`${CANDIDATE}${path}`, { method: 'HEAD' });
    const type = head.headers.get('content-type') || '';

    if (!head.ok) {
      bad(`${path} → ${head.status} on the candidate — the route is not in this build`);
    } else if (!type.startsWith('image/')) {
      bad(`${path} served ${type || 'no content-type'} — not an image`);
    } else {
      ok(`${path} → ${head.status} ${type} on the candidate`);
    }
  }
} catch (e) {
  bad(`share card unverifiable (${e.message})`);
}

/* 4 ── the demo contract, against the candidate ---------------------------- */
console.log('\nDemo contract (against the candidate)');
try {
  execSync(`node scripts/verify-demo.mjs ${CANDIDATE}`, { stdio: 'pipe' });
  ok('verify-demo passed');
} catch {
  bad('verify-demo failed — run it directly; this is the release blocker');
}

/* 5 ── the consultant actually answers ------------------------------------- */
console.log('\nConsultant round trip (against the candidate)');
if (!CONSULTANT_SECRET) {
  /*
    Not a warning. §25 is the record of a gate that degraded a missing check
    into a shrug and then watched the consultant die in production with every
    other check green. If the secret is not configured, this gate cannot run,
    and a promotion that cannot run its gates is not a verified promotion.
  */
  bad('CONSULTANT_HEALTH_SECRET is not set — cannot verify the consultant answers');
} else {
  try {
    const res = await fetch(`${CANDIDATE}/api/health/consultant`, {
      headers: { 'x-consultant-health-secret': CONSULTANT_SECRET },
    });
    const health = await res.json();

    if (health.status === 'good') {
      ok(`consultant answered with vehicle facts (${health.ms}ms)`);
    } else if (health.reason === 'NOT_CONFIGURED') {
      /*
        The candidate deployment has no secret, so the route fails closed.
        Still blocks — an unverified consultant is exactly what §25 shipped —
        but it is a missing env var, not a dead consultant, and saying
        "broken" would send someone hunting the wrong thing.
      */
      bad('the candidate has no CONSULTANT_HEALTH_SECRET — cannot verify the consultant');
      console.log(`    Set it in Netlify for ${CANDIDATE.replace('https://', '')} and re-run.`);
    } else if (health.status === 'degraded' && ALLOW_DEGRADED_AI) {
      degradedWaiver = `${health.reason}: ${health.detail}`;
      console.log(`  \x1b[33m!\x1b[0m WAIVED --allow-degraded-ai — ${degradedWaiver}`);
      console.log('    This will be written into the merge commit.');
    } else if (health.status === 'degraded') {
      bad(`consultant degraded (${health.reason}: ${health.detail})`);
      console.log('    Gemini, not us. Re-run with --allow-degraded-ai to promote anyway.');
    } else {
      // broken — ours, and not overridable.
      bad(`consultant is broken (${health.reason}: ${health.detail})`);
      console.log('    This is our fault, not an upstream outage. There is no override.');
    }
  } catch (e) {
    bad(`consultant health check unreachable (${e.message})`);
  }
}

/* 6 ── promote ------------------------------------------------------------- */
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
  const message = degradedWaiver
    ? `Promote ${head.slice(0, 8)} to the public demo\n\n` +
      `AI GATE WAIVED with --allow-degraded-ai.\n${degradedWaiver}\n\n` +
      `The consultant was not verified on this build. The 6-hourly canary\n` +
      `re-checks the live demo; if this was not transient it will surface there.`
    : `Promote ${head.slice(0, 8)} to the public demo`;
  sh(`git merge --no-ff main -m ${JSON.stringify(message)}`);
  sh(`git push origin ${RELEASE_BRANCH}`);
  ok(`${RELEASE_BRANCH} pushed`);
} catch (e) {
  console.error(`\npromotion failed: ${e.message}`);
  console.error(`you may be left on ${RELEASE_BRANCH} — check "git status" before continuing.\n`);
  process.exit(1);
} finally {
  try { sh('git checkout main'); } catch {}
}

/*
  The commit to expect is the *merge* commit, not the one being promoted.

  This instruction used to say `${head}`, and it is wrong in a way that has
  already cost real time. Netlify builds `demo-live`, so /api/version reports
  demo-live's HEAD — the --no-ff merge this script just made — and never the
  main commit named in its message. Following the old instruction, you check for
  a commit that will never appear and conclude the deploy failed.

  Worse, it seeds the status doc with the wrong baseline. On 28 Jul that doc
  recorded `demo-live = d0dcaff`, which is not a code commit at all but an
  *earlier promotion merge*. A later check against that stale value produced a
  false alarm that the demo had moved unexpectedly, and cost a round trip to
  disprove.
*/
const mergeCommit = sh('git rev-parse demo-live').slice(0, 8);

console.log(`
⚠ This promote also moves https://crewchief.davidmasterson.co — the App Store
listing URL and the mobile app's API origin — not only the portfolio demo.

Netlify is building both now. When it finishes:

  node scripts/verify-demo.mjs

and confirm ${DEMO}/api/version reports ${mergeCommit} — the merge commit on
${RELEASE_BRANCH}, which is what Netlify built. It will NOT report
${head.slice(0, 8)}: that is the commit being promoted, and it is recorded in
the merge message, not in the build.

Record ${mergeCommit} as ${RELEASE_BRANCH}'s new baseline.

To undo: revert the merge commit on ${RELEASE_BRANCH} and push. The demo
returns to its previous build without touching main.
`);
