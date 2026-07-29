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
  images: {
    unoptimized: true,
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
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
  env: {
    COMMIT_REF: process.env.COMMIT_REF,
    BRANCH: process.env.BRANCH,
    BUILD_TIME: new Date().toISOString(),
  },
};

module.exports = nextConfig;
