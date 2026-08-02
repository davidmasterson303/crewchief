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
 * Send the confirmation email again.
 *
 * ── The trap this exists to stay ahead of ───────────────────────────────────
 *
 * `signIn` collapses every credential failure into one message, deliberately.
 * One of the messages it collapses is "Email not confirmed", which today cannot
 * occur: email confirmation is **off** on this Supabase project — checked in
 * the dashboard on 1 Aug, Authentication → Sign In / Providers → Confirm email,
 * disabled. Nobody can be in an unconfirmed state, so nobody is being told
 * their password is wrong with no way forward.
 *
 * That is one toggle away from being false, and it is a plausible toggle:
 * enabling confirmation is standard pre-launch hardening and App Store review
 * is exactly what prompts it. The moment it flips, a user who signed up and did
 * not confirm gets "that email and password did not match" and no path out.
 *
 * The dependency is a dashboard fact no file in this repo can observe, which is
 * why it is written down here rather than left to be rediscovered. Same class
 * as the SQL Editor modal.
 *
 * ── Why this is unconditional, and must stay unconditional ──────────────────
 *
 * The obvious fix is to detect the unconfirmed case and offer a resend button
 * for it. **That reintroduces the oracle the collapsed message exists to
 * close.** A button that appears only for registered-but-unconfirmed addresses
 * announces exactly which addresses those are — the leak simply moves from the
 * message text into the UI.
 *
 * So resending is always available, offered to everyone, and reports the same
 * outcome whatever the address. Its presence says nothing, and its result says
 * nothing. `signIn` deliberately returns no "needs confirmation" flag: a flag
 * would exist only to be rendered conditionally, which is the leak again.
 *
 * The caller shows one message regardless — "If that address needs confirming,
 * we have sent a new link." True for a registered address, true for an
 * unregistered one, and useful to the only person who legitimately cares.
 */
export async function resendConfirmation(email: string): Promise<void> {
  /*
    The result is discarded on purpose, errors included. A caller that surfaced
    "user not found" here would undo the whole point, and there is nothing the
    user could do with it — the one actionable case, a genuinely unconfirmed
    account, is the case that succeeds.
  */
  await supabase.auth
    .resend({ type: 'signup', email: email.trim() })
    .catch(() => undefined);
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
