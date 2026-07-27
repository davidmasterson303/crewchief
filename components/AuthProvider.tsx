'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { User, Session } from '@supabase/supabase-js';
import { createBrowserSupabaseClient, hasSupabaseConfig } from '@/lib/supabase';
import { queryClient } from '@/lib/query-client';
import { resolveAuthEvent } from '@/lib/auth-session';

/**
 * The app's one auth-state listener.
 *
 * This was a stub: a context that returned `{ user: null, session: null }`
 * unconditionally, with `OnboardingWizard` as its only consumer. It is now
 * what task 1.6 asks for — a single subscription to `onAuthStateChange`,
 * mounted once in the root layout, that notices when a session ends and acts
 * on it. Per-page listeners were the alternative and would have given every
 * page its own slightly different answer.
 *
 * Two behaviours, and the second is the one with a history:
 *
 *   1. A session that ends — sign-out elsewhere, a revoked or expired refresh
 *      token — drops the query cache and, on a protected route, returns the
 *      user to /login. Without this they sit on a page whose queries quietly
 *      start failing.
 *   2. An anonymous visitor is untouched. Supabase reports "no session" to
 *      the signed-out demo visitor on every page load; only a session that
 *      *was* live and then went away counts as expiry. The policy for that
 *      distinction is `lib/auth-session.ts`, kept pure so it can be tested
 *      without a browser.
 */

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  loading: boolean;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  session: null,
  loading: false,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  /**
   * Whether a live session has been observed in this tab. A ref, not state:
   * the listener callback needs the current value without re-subscribing, and
   * re-subscribing on every session change would tear down the subscription
   * mid-flight.
   */
  const hadSession = useRef(false);
  /** Same reasoning — the callback needs the path without re-subscribing. */
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  useEffect(() => {
    // Without config there is no client to subscribe to. The demo and landing
    // pages still render; this simply has nothing to say about them.
    if (!hasSupabaseConfig()) {
      setLoading(false);
      return;
    }

    const client = createBrowserSupabaseClient();
    let active = true;

    client.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        if (data.session) hadSession.current = true;
        setSession(data.session);
      })
      .catch(() => {
        // An unreachable auth server is not an expired session. Stay quiet
        // rather than bouncing someone to /login over a network blip.
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;

      const decision = resolveAuthEvent({
        event,
        hasSession: !!nextSession,
        hadSession: hadSession.current,
        pathname: pathnameRef.current,
      });

      if (nextSession) hadSession.current = true;
      setSession(nextSession);

      if (decision.type !== 'session-lost') return;

      // The session that owned this data is gone — same privacy argument as
      // the explicit sign-out path in `lib/sign-out.ts`.
      hadSession.current = false;
      queryClient.clear();

      if (decision.redirectTo) {
        router.replace(decision.redirectTo);
        router.refresh();
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
    // Subscribe once. `router` is stable and the path is read through a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AuthContext.Provider value={{ user: session?.user ?? null, session, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
