import { AppState, type AppStateStatus } from 'react-native';
import type { Session } from '@supabase/supabase-js';

import { supabase } from './supabase';

/**
 * Owning the session's lifetime on a device that goes to sleep.
 *
 * `autoRefreshToken` runs on a timer, and a timer in a backgrounded React
 * Native app does not run. iOS suspends the JS thread, so an app left in the
 * background overnight wakes with an access token that expired hours ago and a
 * refresh timer that never fired. The first request 401s, which from the
 * phone looks like the server rejecting a perfectly good session.
 *
 * Supabase's documented answer is to drive the refresher off AppState: stop it
 * when the app leaves the foreground, start it when it returns — which also
 * forces an immediate refresh if the token expired while away.
 *
 * `startSessionAutoRefresh` is called once, from the root component.
 */
export function startSessionAutoRefresh(): () => void {
  const handle = (state: AppStateStatus) => {
    if (state === 'active') {
      void supabase.auth.startAutoRefresh();
    } else {
      void supabase.auth.stopAutoRefresh();
    }
  };

  // AppState does not fire for the state the app is already in.
  handle(AppState.currentState);

  const subscription = AppState.addEventListener('change', handle);
  return () => subscription.remove();
}

export interface SignInResult {
  ok: boolean;
  error?: string;
}

/**
 * Exchange an email and password for a session.
 *
 * The error is deliberately not passed through verbatim. Supabase distinguishes
 * "no such user" from "wrong password" in some configurations, and relaying
 * that turns the sign-in screen into an account-existence oracle — the same
 * argument as `NOT_FOUND_MESSAGE` in `lib/api-auth.ts`, where "not found" and
 * "not yours" are deliberately indistinguishable.
 */
export async function signIn(email: string, password: string): Promise<SignInResult> {
  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });

  if (error) {
    // Network failures are worth distinguishing: that one is actionable by the
    // user, and telling them "check your details" when the Wi-Fi is off is
    // actively misleading.
    const isNetwork = /network|fetch|timeout/i.test(error.message);
    return {
      ok: false,
      error: isNetwork
        ? 'Could not reach CrewChief. Check your connection and try again.'
        : 'That email and password did not match.',
    };
  }

  return { ok: true };
}

/**
 * End the session.
 *
 * The web has `lib/sign-out.ts` because two sign-out paths drifted and left one
 * account's cached data resident for the next — a privacy defect, not polish.
 * That helper also clears a TanStack query cache; this app has no cache yet, so
 * there is nothing here to clear.
 *
 * **When one is added, this function is where it must be cleared**, and the
 * shared rule belongs in `@crewchief/core` rather than being written a third
 * time. Recorded here because the third implementation is exactly how the web
 * bug happened.
 */
export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

/**
 * The current access token, or null.
 *
 * `getSession()` rather than a stored copy: it returns the live session and
 * refreshes it if it has expired, so callers cannot accidentally send a token
 * that was valid when they cached it. Every API request goes through this.
 */
export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/** Subscribe to session changes. Returns an unsubscribe function. */
export function onSessionChange(handler: (session: Session | null) => void): () => void {
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((_event, session) => handler(session));

  return () => subscription.unsubscribe();
}
