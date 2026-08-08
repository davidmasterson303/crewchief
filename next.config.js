/** @type {import('next').NextConfig} */
const nextConfig = {
  /*
    `next build` and `next dev` share `.next` by default, and a build run while
    a dev server holds it leaves the app serving 404s for chunks that exist.
    This project has traced four separate "the app is dead" investigations to
    exactly that, and answered it with a standing rule not to do it.

    A rule is a poor guard for a mistake this easy to make -- especially with
    nine orphaned `next dev` processes on the machine as of 28 Jul, only one of
    which is listening. So the build can now be pointed somewhere else:

        NEXT_DIST_DIR=.next-verify npm run build

    Unset everywhere it matters, so CI and Netlify keep building into `.next`
    exactly as before. This only makes a safe local verification possible; it
    does not change any deployed behaviour.
  */
  distDir: process.env.NEXT_DIST_DIR || '.next',

  /*
    /demo and / had drifted into the same page: both rendered the same three
    is_demo cars behind the same garage door, and the door carried a "Take a
    Test Drive" button pointing at a near-copy of the page it sat on.

    / is the demo now, and /demo redirects to it. The redirect is not optional
    housekeeping — README.md advertises https://crewchief-demo.davidmasterson.co
    and davidmasterson.co/ai-work.html links to the demo, so the path has to keep
    resolving. `packages/core/src/demo-contract.ts` still lists /demo among the
    routes an anonymous visitor must be able to reach, and scripts/verify-demo.mjs
    asserts it lands on / rather than on /login.

    Deliberately temporary: a 308 is cached hard by browsers and would make this
    awkward to reverse if /demo should ever become a distinct page again.
  */
  async redirects() {
    return [{ source: '/demo', destination: '/', permanent: false }];
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  /*
    `unoptimized` stays, and that is now a decision rather than an oversight.

    The audit read this flag as the reason there are no modern formats and
    suggested dropping it so Netlify's Image CDN would take over. It would not
    have: the optimizer only ever sees what `next/image` renders, and this app
    renders no `next/image` at all. Its two photo surfaces are CSS backgrounds
    in VehicleIdentity — an over-scanned blurred fill under a contained sharp
    copy — which no image component can express. Dropping the flag would have
    changed nothing except to make the wildcard below live.

    AVIF and WebP arrive instead through `scripts/build-image-derivatives.mjs`
    and `image-set()`. 5.31 MB of JPEG to 1.46 MB of AVIF, committed, with the
    JPEG still there for browsers that want it. No per-request transform, no
    CDN dependency, and it works identically in `next dev`.

    The wildcard is the part that had to go regardless. `hostname: '**'` allows
    any HTTPS host, which is inert only for as long as `unoptimized` is true —
    the moment someone drops that flag, /_next/image becomes an open proxy that
    will fetch and re-serve arbitrary URLs on this domain's behalf. It was here
    for `lib/vehicle-images.ts`, which hotlinked Google image results and has
    been deleted; the only remote images left are Supabase signed URLs.

    Derived from the Supabase URL rather than hardcoded because the host
    differs per environment. If it cannot be parsed the list is empty, which
    fails closed — no remote image is optimizable — rather than falling back to
    the wildcard.
  */
  images: {
    unoptimized: true,
    remotePatterns: (() => {
      try {
        return [
          {
            protocol: 'https',
            hostname: new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname,
          },
        ];
      } catch {
        return [];
      }
    })(),
  },
  experimental: {
    serverActions: true,
  },
  /*
    Netlify sets COMMIT_REF, BRANCH and HEAD during the **build** and does not
    pass them to functions at runtime, so a route reading process.env at
    request time gets nothing. Proven rather than assumed: the CI site,
    deployed from git at main@fb5f7cb, still answered /api/version with
    {"commit":"unknown"}.

    This block inlines the values at build time, which is the only moment they
    exist. Without it the promote gate can never pass — it would refuse every
    deploy, correctly but uselessly.

    BUILD_TIME is evaluated when this config loads, i.e. once per build.
  */
  /*
    Defaulted to '' rather than left undefined, which is a lint fix and not a
    behaviour change. Next validates this block against `Record<string, string>`
    and printed two warnings on **every dev start and every build** off a
    machine without Netlify's variables:

      "env.COMMIT_REF" is missing, expected string
      "env.BRANCH" is missing, expected string

    Real noise with a real cost: a build log that always contains warnings is a
    build log nobody reads, which is how the next genuine warning gets missed.

    `/api/version` reads these with `|| 'unknown'` (route.ts:45 and :52), and an
    empty string is falsy, so it still answers "unknown" locally exactly as
    before.

    That citation is a file and a line rather than a test name on purpose: the
    first draft of this comment cited `version-endpoint.test.ts`, which **does
    not exist**. Two places in this repo already named a `ai-usage-purposes.test.ts`
    that was never written, and both were corrected on 3 Aug — adding a third
    phantom guard on the same day would have been careless in a way this project
    has a documented history with. There is no test on this; the fallback is
    verifiable by reading two lines, and that is what is claimed.
  */
  env: {
    COMMIT_REF: process.env.COMMIT_REF ?? '',
    BRANCH: process.env.BRANCH ?? '',
    BUILD_TIME: new Date().toISOString(),
  },
};

module.exports = nextConfig;
