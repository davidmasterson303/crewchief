import { NextResponse } from 'next/server';

/**
 * Reports which commit this deployment was built from.
 *
 * Public and deliberately so — it exposes a commit SHA for a public repo and
 * nothing else. No database, no session, no service role.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * "Is the site serving the build I think it is?" turns out to be hard to
 * answer from outside, and guessing wrong is expensive. This project already
 * shipped that mistake once: a page returned 200, that was read as proof the
 * new build was live, and the 200 was cached from the previous deploy. The
 * workaround then was to check a content-addressed asset, which works but only
 * tells you *something* changed, not *what*.
 *
 * scripts/promote-demo.mjs refuses to promote unless this reports the exact
 * commit being promoted, so a slow or failed deploy can't be mistaken for a
 * verified one.
 *
 * COMMIT_REF is set by Netlify. NEXT_PUBLIC_COMMIT_SHA is the local/dev
 * fallback. `unknown` is honest rather than convenient — a promote against an
 * unknown build should fail, not proceed on a guess.
 */

// Must never be cached — a stale answer here defeats the entire point.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const commit =
    process.env.COMMIT_REF ||
    process.env.NEXT_PUBLIC_COMMIT_SHA ||
    'unknown';

  return NextResponse.json(
    {
      commit,
      branch: process.env.BRANCH || process.env.HEAD || 'unknown',
      builtAt: process.env.BUILD_TIME || null,
    },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      },
    }
  );
}
