import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest, type NextFetchEvent } from 'next/server';
import { resolveRoute } from '@crewchief/core/routes';
import { corsHeadersFor, isVersionedApiPath } from '@crewchief/core/cors';
import { FRONT_DOOR_PATH } from '@crewchief/core/front-door';
import { VISITOR_COOKIE, visitorCookieOptions } from '@crewchief/core/funnel';
import { resolveVisitor } from '@/lib/funnel-visitor';
import { recordFunnelStep } from '@/lib/funnel';

/**
 * Route protection.
 *
 * This is a UX and defence-in-depth layer, not the security boundary. The real
 * enforcement lives in RLS and in `lib/api-auth.ts` — middleware exists so a
 * signed-out visitor lands on /login instead of an empty, broken page.
 *
 * The routing policy is deliberately split into a pure function
 * (`resolveRoute`) so it can be unit tested against the real implementation.
 * Before this, `security.test.ts` tested a private copy of this logic while the
 * exported middleware was a no-op with an empty matcher — 11 green tests
 * asserting protection the app did not actually have.
 *
 * That policy now lives in `@crewchief/core/routes` so `components/AuthProvider.tsx`
 * can share it — a client component cannot import this module, which pulls in
 * `next/server`. It is re-exported below rather than duplicated, because a
 * private copy of this logic is the exact bug described above.
 */

export {
  PROTECTED_ROUTES,
  AUTH_ROUTES,
  isPublicDemoPath,
  isProtectedRoute,
  resolveRoute,
  type RouteDecision,
} from '@crewchief/core/routes';

function readSupabaseConfig(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // Accept either key generation — see lib/supabase.ts.
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  return url && key ? { url, key } : null;
}

/**
 * Cross-origin handling for `/api/v1/*`, task 2.3.
 *
 * Runs before any session work and returns unconditionally, so adding the API
 * to the matcher does not put a `getUser()` network round trip in front of
 * every API request — which is the reason the matcher below is scoped in the
 * first place.
 *
 * Requests without an `Origin`, and origins that are not allowlisted, get no
 * CORS headers at all. For the first that is correct because they are
 * same-origin or not a browser; for the second, omitting
 * `Access-Control-Allow-Origin` *is* the refusal — there is no deny header.
 *
 * This grants nothing. Every route stays protected by `lib/api-auth.ts`
 * whatever origin it was called from.
 */
function handleApiCors(request: NextRequest): NextResponse {
  const headers = corsHeadersFor(request.headers.get('origin'));

  // Preflight is answered here and never reaches the route.
  if (request.method === 'OPTIONS') {
    // 204 with no CORS headers for an unlisted origin: the browser will refuse
    // the real request, which is the intended outcome.
    return new NextResponse(null, { status: 204, headers: headers ?? undefined });
  }

  const response = NextResponse.next({ request });
  if (headers) {
    for (const [key, value] of Object.entries(headers)) {
      /*
        KNOWN LIMITATION — `Vary: Origin` does not survive on this response.

        Next attaches its own Vary list (RSC, Next-Router-State-Tree, …) after
        middleware returns, and it replaces whatever is here. Measured on
        Next 13.5.1: neither `set` nor `append` sticks. The preflight above
        does carry `Vary: Origin`, because that response is constructed here
        and never passes through the router.

        Why it is acceptable rather than fixed: these responses embed a
        specific Access-Control-Allow-Origin, so in principle a shared cache
        that did not know they vary by Origin could serve one origin's
        response to another. In practice the routes are `force-dynamic` and
        the deployment returns `cache-control: no-cache` on them, so no shared
        cache may reuse a response without revalidating.

        `append` is kept rather than `set` so this starts working on its own if
        Next stops overwriting. Do not read the header on a passthrough
        response and conclude it is configured — it is not.
      */
      if (key === 'Vary') response.headers.append(key, value);
      else response.headers.set(key, value);
    }
  }
  return response;
}

/**
 * The front door's `landed` event, and the cookie that makes it joinable.
 *
 * Phase 2.97d's last call site. It has to be here rather than on the page for a
 * reason that is not stylistic: `cookies()` is **read-only during a Server
 * Component render** on Next 13.5, so the page that needs the id cannot mint
 * it, and middleware is the only place that holds the response before the
 * render.
 *
 * Returns before any session work. `/check` is anonymous by definition, and the
 * matcher is scoped precisely so public pages do not pay for a `getUser()` they
 * never use — adding the front door to it and then falling through would put a
 * network round trip in front of the surface whose whole job is a fast first
 * impression.
 *
 * **`event.waitUntil` is load-bearing.** An un-awaited promise in Edge
 * middleware is killed when the response is returned, so a bare
 * fire-and-forget call here would record nothing — and would do it silently,
 * which is the worst version. Awaiting it instead would put a database write in
 * front of the first paint. `waitUntil` is the only option that is neither.
 */
function handleFrontDoor(request: NextRequest, event: NextFetchEvent): NextResponse {
  const response = NextResponse.next();
  const visitor = resolveVisitor(request);

  if (visitor.issue && visitor.visitorId) {
    response.cookies.set(
      VISITOR_COOKIE,
      visitor.visitorId,
      visitorCookieOptions(process.env.NODE_ENV === 'production')
    );
  }

  /*
    `resolveVisitor` returns a null id for a prefetch, so a link sitting in
    someone's viewport records nothing. That check is in `decideVisitor` and
    tested there.

    ── But it is weaker HERE than its unit tests suggest, measured 3 Aug ──────

    **Next 13.5 strips its own `next-router-prefetch` and `RSC` headers before
    middleware runs.** Verified by logging every header this function receives
    during a prefetch-shaped request: `accept`, `host`, `user-agent`, and
    nothing else. A custom `Sec-Purpose` or `purpose` *does* arrive, which is
    why two of the three signals work and Next's own does not.

    So `isPrefetchRequest` is green in its suite and partly inert in this
    position — the precise shape this file's own docstring records from
    `security.test.ts`: a test asserting protection the app does not have.
    Written down rather than deleted, because the check is correct in the route
    handler, correct for browser speculative loads (`Sec-Purpose`), and would
    start working here if Next stops stripping.

    **What actually protects the top of the funnel today:** nothing links to
    `/check` with prefetching on. A Next `<Link>` prefetch is a client `fetch()`
    that carries no browser prefetch header, so it is undetectable from here —
    which makes `prefetch={false}` on any future link to this route a
    correctness requirement, not a preference. `front-door-gate.test.ts`
    asserts it.
  */
  if (visitor.visitorId) {
    event.waitUntil(recordFunnelStep({ visitorId: visitor.visitorId, step: 'landed' }));
  }

  return response;
}

export async function middleware(request: NextRequest, event: NextFetchEvent) {
  const pathname = request.nextUrl.pathname;

  // Before the session work, and before anything else: the API surface is not
  // route-protected here (lib/api-auth.ts owns that) and must not pay for a
  // session lookup it does not use.
  if (isVersionedApiPath(pathname)) {
    return handleApiCors(request);
  }

  // Same reasoning, one surface further: anonymous by definition, so it returns
  // before the session lookup rather than after it.
  if (pathname === FRONT_DOOR_PATH) {
    return handleFrontDoor(request, event);
  }

  const supabaseConfig = readSupabaseConfig();

  // No config means no way to verify a session. Fail closed: treat the caller
  // as signed out rather than waving protected routes through.
  if (!supabaseConfig) {
    const decision = resolveRoute({
      pathname,
      isAuthenticated: false,
      requestUrl: request.url,
    });
    return decision.type === 'redirect'
      ? NextResponse.redirect(decision.location)
      : NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseConfig.url, supabaseConfig.key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  // getUser() validates the token with Supabase rather than trusting the
  // cookie's mere presence, and refreshes it when near expiry — which is also
  // what stops long sessions dying mid-use.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const decision = resolveRoute({
    pathname,
    isAuthenticated: !!user,
    requestUrl: request.url,
  });

  if (decision.type === 'redirect') {
    return NextResponse.redirect(decision.location);
  }

  // Return `response`, not a fresh one — it carries the refreshed auth cookies.
  return response;
}

export const config = {
  // Scoped deliberately. A catch-all matcher would fire a getUser() network
  // call on every asset and public page, including the anonymous demo.
  matcher: [
    // CORS only — handleApiCors returns before any session lookup, so this
    // adds no getUser() call. Deliberately /api/v1 and not /api: the
    // unversioned /api/version and /api/health/ai are read by release tooling
    // rather than browsers, and putting the deploy path through middleware
    // would be cost with no benefit.
    '/api/v1/:path*',
    '/garage/:path*',
    '/dashboard/:path*',
    '/consultant/:path*',
    '/documents/:path*',
    '/vehicle-info/:path*',
    '/onboard/:path*',
    '/settings/:path*',
    '/login',
    '/signup',
    /*
      The anonymous front door. Unlike every other entry here it is not about
      protection — `handleFrontDoor` returns before the session lookup. It is on
      the matcher because middleware is the only place that can set a cookie
      before a Server Component renders, and without that cookie the funnel has
      no top and every conversion rate below it is uncomputable.

      Kept in step with the page by `FRONT_DOOR_PATH`; a matcher that drifted
      from the route would silently stop recording rather than fail.
    */
    '/check',
  ],
};
