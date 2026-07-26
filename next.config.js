/** @type {import('next').NextConfig} */
const nextConfig = {
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
