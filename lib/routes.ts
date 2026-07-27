/**
 * Routing policy — which paths need a session, and where a caller without one
 * is sent.
 *
 * Pure. No `next/server`, no Supabase, no network. It lives here rather than
 * in `middleware.ts` because two callers now need it: the middleware, which
 * decides on navigation, and `components/AuthProvider.tsx`, which decides when
 * a session dies underneath a page the user is already sitting on. A client
 * component cannot import `middleware.ts` — that module pulls in `next/server`.
 *
 * `middleware.ts` re-exports everything below, so it remains the import site
 * the existing security suites use and there is still only one definition.
 */

import { isDemoVehicleId } from '@/lib/demo';

export const PROTECTED_ROUTES = [
  '/garage',
  '/dashboard',
  '/consultant',
  '/documents',
  '/vehicle-info',
  '/onboard',
  '/settings',
] as const;

/** Pages a signed-in user has no reason to see. */
export const AUTH_ROUTES = ['/login', '/signup'] as const;

/**
 * Vehicle-detail routes are `/<section>/<vehicleId>`. When that id is one of
 * the seeded demo vehicles the page is public — the whole point of the demo
 * is browsing it without an account.
 *
 * Missing this took the demo down: an anonymous visitor clicking a car on
 * /demo was redirected to /login. The demo is a live portfolio piece, so any
 * change to PROTECTED_ROUTES must keep this path open.
 */
export function isPublicDemoPath(pathname: string): boolean {
  const [, section, id] = pathname.split('/');
  if (!section || !id) return false;
  return isDemoVehicleId(id);
}

export function isProtectedRoute(pathname: string): boolean {
  if (isPublicDemoPath(pathname)) return false;
  return PROTECTED_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(route + '/')
  );
}

export type RouteDecision =
  | { type: 'redirect'; location: string }
  | { type: 'next' };

/**
 * Pure routing policy. Given a path and whether the caller is authenticated,
 * decide where they go. No Supabase, no network, no side effects.
 */
export function resolveRoute({
  pathname,
  isAuthenticated,
  requestUrl,
}: {
  pathname: string;
  isAuthenticated: boolean;
  requestUrl: string;
}): RouteDecision {
  if (isProtectedRoute(pathname) && !isAuthenticated) {
    const loginUrl = new URL('/login', requestUrl);
    // Preserve where they were headed so login can send them back.
    loginUrl.searchParams.set('redirect', pathname);
    return { type: 'redirect', location: loginUrl.toString() };
  }

  if (AUTH_ROUTES.includes(pathname as (typeof AUTH_ROUTES)[number]) && isAuthenticated) {
    return { type: 'redirect', location: new URL('/garage', requestUrl).toString() };
  }

  return { type: 'next' };
}
