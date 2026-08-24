import type { MetadataRoute } from 'next';

/**
 * What crawlers may index.
 *
 * ── ⚠ There was no robots.txt at all (SEC-10) ───────────────────────────────
 *
 * `crewchief.davidmasterson.co` is the App Store listing's marketing URL and
 * the origin the mobile app talks to, and it served **no `robots.txt`** — so
 * every route on it was crawlable, including `/dev/rls-check`, which renders
 * the results of eight live RLS probes and returned 200 in production because
 * its guard ran in the browser.
 *
 * ⚠ **This file is the second lock, never the first.** A `Disallow` is a
 * request, not a control — a crawler that ignores it is not misbehaving in any
 * way that can be prevented from here, and an attacker reads this file as a
 * *list of interesting paths*. `app/dev/layout.tsx` is what actually makes
 * `/dev` unreachable; this stops a well-behaved crawler putting the URLs into
 * search results.
 *
 * The paths are named narrowly for that reason: a broad `Disallow: /api` would
 * advertise the API surface to anyone who fetched this, for no benefit — those
 * routes carry their own authorization and none of them is something a crawler
 * would follow to.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        /*
          `/auth/` because the callback sets a session cookie and takes a
          `redirect` parameter — there is nothing there for a crawler and every
          reason not to have its URLs indexed. `/garage` and the dashboards are
          behind auth and simply 302 to sign-in.
        */
        disallow: ['/dev/', '/auth/'],
      },
    ],
  };
}
