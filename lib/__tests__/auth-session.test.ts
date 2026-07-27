/**
 * Session expiry returns you to /login. Being anonymous does not.
 *
 * @jest-environment node
 *
 * Task 1.6's second done-condition, and the whole difficulty is in the
 * negative case. Supabase reports "no session" to an anonymous visitor on
 * every page load, so a listener that reads "no session" as "session expired"
 * redirects every recruiter browsing the public demo to a login page. §3 item
 * 6 records route protection doing exactly that once already; the demo is
 * linked from David's portfolio during an active job search.
 *
 * So these tests are mostly about what must *not* happen.
 */

import { resolveAuthEvent, loginUrlFor } from '@crewchief/core/auth-session';
import { PUBLIC_DEMO_ROUTES } from '@crewchief/core/demo-contract';
import { PROTECTED_ROUTES } from '@/middleware';

describe('a session that expires', () => {
  it('sends the user to /login from a protected route', () => {
    const decision = resolveAuthEvent({
      event: 'SIGNED_OUT',
      hasSession: false,
      hadSession: true,
      pathname: '/dashboard/8f14e45f-ceea-467a-9f6e-2f0e6b6a1234',
    });

    expect(decision).toEqual({
      type: 'session-lost',
      redirectTo: loginUrlFor('/dashboard/8f14e45f-ceea-467a-9f6e-2f0e6b6a1234'),
    });
  });

  it.each([...PROTECTED_ROUTES])('redirects from %s', (route) => {
    const decision = resolveAuthEvent({
      event: 'SIGNED_OUT',
      hasSession: false,
      hadSession: true,
      pathname: route,
    });

    expect(decision.type).toBe('session-lost');
    expect(decision).toHaveProperty('redirectTo', loginUrlFor(route));
  });

  it('preserves where the user was, so login can send them back', () => {
    const decision = resolveAuthEvent({
      event: 'SIGNED_OUT',
      hasSession: false,
      hadSession: true,
      pathname: '/settings',
    });

    expect(decision).toHaveProperty('redirectTo', '/login?redirect=%2Fsettings');
  });

  it('treats a token refresh that returns no session as expiry', () => {
    // supabase-js emits SIGNED_OUT when a refresh fails outright, but a
    // TOKEN_REFRESHED carrying nothing is the same event wearing a different
    // name, and it must not be read as "still signed in".
    const decision = resolveAuthEvent({
      event: 'TOKEN_REFRESHED',
      hasSession: false,
      hadSession: true,
      pathname: '/garage',
    });

    expect(decision.type).toBe('session-lost');
  });

  it('drops the cache but stays put on a public route', () => {
    // Someone whose session lapses while reading the landing page should keep
    // reading it. Their cached data still goes.
    const decision = resolveAuthEvent({
      event: 'SIGNED_OUT',
      hasSession: false,
      hadSession: true,
      pathname: '/',
    });

    expect(decision).toEqual({ type: 'session-lost', redirectTo: null });
  });
});

describe('an anonymous visitor is never redirected', () => {
  it('ignores the null INITIAL_SESSION every signed-out page load fires', () => {
    expect(
      resolveAuthEvent({
        event: 'INITIAL_SESSION',
        hasSession: false,
        hadSession: false,
        pathname: '/demo',
      })
    ).toEqual({ type: 'none' });
  });

  it('ignores SIGNED_OUT when no session ever existed', () => {
    // This is the distinction the whole module exists for: "no session" and
    // "session expired" arrive as the same event with the same payload, and
    // only the history tells them apart.
    expect(
      resolveAuthEvent({
        event: 'SIGNED_OUT',
        hasSession: false,
        hadSession: false,
        pathname: '/garage',
      })
    ).toEqual({ type: 'none' });
  });

  it.each([...PUBLIC_DEMO_ROUTES])('leaves %s alone', (route) => {
    for (const event of ['INITIAL_SESSION', 'SIGNED_OUT', 'TOKEN_REFRESHED'] as const) {
      expect(
        resolveAuthEvent({
          event,
          hasSession: false,
          hadSession: false,
          pathname: route,
        })
      ).toEqual({ type: 'none' });
    }
  });

  it('does not redirect a signed-out visitor off a demo vehicle page even mid-session', () => {
    // Demo vehicle paths are public by id. Even a real expiry should not
    // bounce someone off one — they can keep browsing what anyone can browse.
    const decision = resolveAuthEvent({
      event: 'SIGNED_OUT',
      hasSession: false,
      hadSession: true,
      pathname: `/dashboard/${require('@crewchief/core/demo').DEMO_VEHICLE_IDS[0]}`,
    });

    expect(decision).toEqual({ type: 'session-lost', redirectTo: null });
  });
});

describe('a live session is not an event worth acting on', () => {
  it.each(['SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED', 'INITIAL_SESSION'] as const)(
    '%s with a session does nothing',
    (event) => {
      expect(
        resolveAuthEvent({
          event,
          hasSession: true,
          hadSession: true,
          pathname: '/garage',
        })
      ).toEqual({ type: 'none' });
    }
  );

  it('ignores PASSWORD_RECOVERY, which reset-password owns', () => {
    // app/reset-password/page.tsx has its own listener for this flow. A
    // second opinion from the global provider would fight it.
    expect(
      resolveAuthEvent({
        event: 'PASSWORD_RECOVERY',
        hasSession: false,
        hadSession: false,
        pathname: '/reset-password',
      })
    ).toEqual({ type: 'none' });
  });
});
