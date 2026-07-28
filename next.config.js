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
