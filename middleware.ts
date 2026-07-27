import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { resolveRoute } from '@/lib/routes';

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

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
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
