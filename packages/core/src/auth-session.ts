/**
 * What to do when the auth state changes underneath a page.
 *
 * Task 1.6's second done-condition: an expired session should return the user
 * to /login, not leave them on a page whose queries have started 401-ing.
 *
 * The middleware already handles this on *navigation*. What it cannot see is a
 * session that dies while someone is sitting still — a refresh token that has
 * been revoked, a password changed in another tab, or simply a laptop that was
 * shut for long enough. Supabase reports those through `onAuthStateChange`,
 * and this module is the policy for reading them.
 *
 * **The trap this is written around.** An anonymous visitor browsing the demo
 * has no session *by design*, and Supabase tells them so — `INITIAL_SESSION`
 * fires with a null session on every page load for a signed-out visitor, and
 * `SIGNED_OUT` can arrive without any session ever having existed. Treating
 * "no session" as "session expired" would redirect every recruiter looking at
 * the demo to a login page. §3 item 6 records the last time route protection
 * did that.
 *
 * So the decision needs one bit of history — has this tab ever observed a live
 * session — and that is the caller's job to track. Everything here is pure.
 */

import { isProtectedRoute } from './routes';

/** The subset of Supabase auth events this policy reasons about. */
export type AuthChangeEvent =
  | 'INITIAL_SESSION'
  | 'SIGNED_IN'
  | 'SIGNED_OUT'
  | 'TOKEN_REFRESHED'
  | 'USER_UPDATED'
  | 'PASSWORD_RECOVERY'
  | (string & {});

export type AuthDecision =
  /** Nothing to do. */
  | { type: 'none' }
  /** A session that existed is gone. Drop cached data; redirect if given one. */
  | { type: 'session-lost'; redirectTo: string | null };

export interface AuthEventInput {
  event: AuthChangeEvent;
  /** Whether the event carried a live session. */
  hasSession: boolean;
  /** Whether this tab has previously observed a live session. */
  hadSession: boolean;
  /** The path the user is currently on. */
  pathname: string;
}

/**
 * Decide what a single auth-state event means.
 *
 * Session loss is recognised two ways:
 *
 *   - `SIGNED_OUT`, which supabase-js also emits when a token refresh fails
 *     outright — a revoked or expired refresh token surfaces here, not as an
 *     error.
 *   - `TOKEN_REFRESHED` carrying no session, which is the degenerate form of
 *     the same thing.
 *
 * Either only counts when a session was previously seen. Redirection is
 * further limited to protected routes: someone whose session lapses while
 * reading the landing page or a demo vehicle should keep reading it. Their
 * cache is still dropped — the data belonged to the session that just ended.
 */
export function resolveAuthEvent({
  event,
  hasSession,
  hadSession,
  pathname,
}: AuthEventInput): AuthDecision {
  if (hasSession) return { type: 'none' };

  const lostSession =
    event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED';

  // No session and none before it: an anonymous visitor. Leave them alone.
  if (!lostSession || !hadSession) return { type: 'none' };

  return {
    type: 'session-lost',
    redirectTo: isProtectedRoute(pathname) ? loginUrlFor(pathname) : null,
  };
}

/** `/login` with a `redirect` param, matching what the middleware sets. */
export function loginUrlFor(pathname: string): string {
  return `/login?redirect=${encodeURIComponent(pathname)}`;
}
