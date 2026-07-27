/**
 * Cross-origin policy for the versioned API.
 *
 * Phase 2 task 2.3. Pure — no `next/server`, no request objects — so the
 * decisions below can be tested without a browser, and so `middleware.ts` is
 * left holding only the plumbing.
 *
 * **CORS is not authorization.** This is the most commonly confused pair in
 * this area, so it is worth stating plainly: the allowlist tells a *browser*
 * which origins may read a response. It grants nothing. Every route is still
 * protected by `lib/api-auth.ts` regardless of where the request came from,
 * and a caller that is not a browser — curl, a native app — ignores all of
 * this entirely.
 *
 * **A native client does not need any of it.** React Native's `fetch` is not a
 * browser: no preflight, no same-origin policy. This exists for Expo Web
 * during development, for any future browser client on another origin, and to
 * get the posture written down while the API surface is still ten routes.
 * It is not on the critical path to a working native client.
 */

/** Header set returned for an allowed origin. */
export type CorsHeaders = Record<string, string>;

/**
 * Origins permitted to read API responses.
 *
 * From the environment so preview and production differ without a code change.
 * Comma-separated; blank entries ignored.
 */
export function allowedOrigins(env: string | undefined = process.env.CORS_ALLOWED_ORIGINS): string[] {
  if (!env) return [];
  return env
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

/**
 * Whether this path is part of the versioned API surface.
 *
 * `/api/version` and `/api/health/ai` are deliberately excluded: they are
 * release-tooling endpoints read by `promote-demo.mjs` and `verify-demo.mjs`
 * from outside a browser, so CORS is meaningless for them and widening the
 * middleware matcher to cover them would add a hop to the deploy path for
 * nothing.
 */
export function isVersionedApiPath(pathname: string): boolean {
  return pathname.startsWith('/api/v1/');
}

/**
 * The CORS headers to attach, or null to attach none.
 *
 * Returning null is the common case and the important one: a request with no
 * `Origin` header is same-origin or not from a browser at all. The web app and
 * the anonymous demo are same-origin, so **CORS should be completely invisible
 * to them** — if it is not, the middleware matcher is too wide.
 *
 * An `Origin` that is not on the allowlist also gets null. Omitting
 * `Access-Control-Allow-Origin` is what makes the browser refuse the response;
 * there is no "deny" header to send.
 */
export function corsHeadersFor(
  origin: string | null | undefined,
  origins: string[] = allowedOrigins()
): CorsHeaders | null {
  if (!origin) return null;
  if (!origins.includes(origin)) return null;

  return {
    // Echo the specific origin, never `*`. `*` would publish the API to every
    // page on the internet, and it is not compatible with Vary-correct caching
    // of an allowlist.
    'Access-Control-Allow-Origin': origin,
    /*
      Explicitly false, and this is the interesting consequence of task 2.1.

      The mobile client authenticates with a bearer token, so it never needs
      cookies to cross origins. That lets the policy refuse credentials
      outright, which is strictly safer: a mistaken allowlist entry cannot be
      escalated into riding a logged-in user's session.

      Do not turn this on to make something work. If something needs it, that
      something is using the cookie path and should be using the bearer path.
    */
    'Access-Control-Allow-Credentials': 'false',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    // Authorization is the whole point — without it the bearer path cannot be
    // used cross-origin at all.
    'Access-Control-Allow-Headers': 'Authorization,Content-Type',
    'Access-Control-Max-Age': '86400',
    // The response body varies by origin, so a shared cache must not serve one
    // origin's response to another.
    Vary: 'Origin',
  };
}
