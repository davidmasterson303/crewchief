import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { resolveRoute } from '@/lib/routes';
import { corsHeadersFor, isVersionedApiPath } from '@/lib/cors';

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
 * That policy now lives in `lib/routes.ts` so `components/AuthProvider.tsx`
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
} from '@/lib/routes';

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

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Before the session work, and before anything else: the API surface is not
  // route-protected here (lib/api-auth.ts owns that) and must not pay for a
  // session lookup it does not use.
  if (isVersionedApiPath(pathname)) {
    return handleApiCors(request);
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
  ],
};
