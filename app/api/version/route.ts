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
 * ── Why the values come via next.config.js ──────────────────────────────────
 *
 * Reading process.env here looks like it should be enough, and isn't. Netlify
 * sets COMMIT_REF, BRANCH and HEAD during the **build** only — they are not
 * among the variables passed to functions at runtime, so at request time they
 * are simply absent. The first version of this route did exactly that and the
 * CI site, deployed from git at main@fb5f7cb, answered `commit: "unknown"`.
 *
 * The `env` block in next.config.js inlines them at build time, which is the
 * one moment they exist. The indirection is load-bearing — do not "simplify"
 * it back to a bare process.env read.
 *
 * `unknown` is kept as the fallback because it is honest for local dev, and
 * because a promote against a build that cannot identify itself should fail
 * rather than proceed on a guess.
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
      /*
        ── ⚠ The product version, added 24 Aug ──────────────────────────────

        The commit answers *"is this the build I pushed"*, which is what the
        promote gate needs. It does not answer *"which release is this"*, which
        is what a person asks — and a support conversation that starts "which
        version are you on" cannot be answered from a SHA by anybody who is not
        holding the repository.

        Read from `package.json` at **build** time through `next.config.js`, for
        exactly the reason `COMMIT_REF` is: a route reading it at request time
        would need the file in the function bundle.

        ⚠ It is the same number as the binary's. `apps/mobile/app.json`,
        `apps/mobile/package.json` and the root `package.json` are held in step
        by `lib/__tests__/one-product-one-version.test.ts` — one product, one
        version, and a mismatch between the API and the app that talks to it is
        a support conversation nobody can resolve.
      */
      version: process.env.NEXT_PUBLIC_APP_VERSION || 'unknown',
    },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      },
    }
  );
}
