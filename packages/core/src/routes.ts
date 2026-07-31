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

import { isDemoVehicleId } from './demo';

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
 * The demo garage. A signed-in user has no reason to be here either.
 *
 * `/` shows three seeded cars that belong to nobody. Someone with their own
 * garage landing on it has been taken somewhere strictly less useful than where
 * they were, and the two surfaces look near enough alike that it reads as their
 * data having vanished. Clicking the CrewChief mark in the nav did exactly that.
 *
 * Deliberately *only* the garage, not every public demo path. A demo vehicle's
 * dashboard is a shareable link — someone may well send one to a signed-in user,
 * and silently bouncing them off it would break sharing to solve a problem
 * nobody has. `/garage` is the surface that needs separating from `/`.
 */
export const DEMO_GARAGE_ROUTE = '/';

/** Where a signed-in user belongs instead. */
export const SIGNED_IN_HOME = '/garage';

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
    return { type: 'redirect', location: new URL(SIGNED_IN_HOME, requestUrl).toString() };
  }

  /*
    A signed-in user does not get the demo garage. See DEMO_GARAGE_ROUTE.

    **This rule is enforced on the client, not by middleware**, and that is a
    cost decision rather than an oversight. `/` is deliberately absent from the
    middleware matcher — the config records why, at length: matching it would put
    a `getUser()` network round trip in front of every anonymous load of the most
    visited page on the site, which is the recruiter-facing demo. Paying that on
    every visit to slightly tidy the experience of the one signed-in user is the
    wrong trade.

    `components/AuthProvider.tsx` applies it, and it is written here so the policy
    has one definition and can be tested without a browser. If `/` is ever added
    to the matcher this starts working there too, with no change.
  */
  if (pathname === DEMO_GARAGE_ROUTE && isAuthenticated) {
    return { type: 'redirect', location: new URL(SIGNED_IN_HOME, requestUrl).toString() };
  }

  return { type: 'next' };
}
