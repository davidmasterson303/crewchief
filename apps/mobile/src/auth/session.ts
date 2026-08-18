import { AppState, type AppStateStatus } from 'react-native';
import type { Session } from '@supabase/supabase-js';

import { API_BASE_URL } from '../config';
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
 * Say what actually went wrong, to the console, in development only.
 *
 * Every function below maps Supabase's error onto a sentence a person can act
 * on, which is right for the product and blinding for whoever is debugging it:
 * "Could not reach CrewChief" is emitted for *any* message matching
 * `network|fetch|timeout`, and the original never reaches anyone.
 *
 * That cost an hour on 13 Aug. A sign-in failed repeatedly on the simulator and
 * the mapped sentence was the only evidence available, so the endpoint, the
 * publishable key, the client version, the device's own reachability and the
 * account itself were each cleared individually — all of them fine — because
 * the one fact that would have named the cause was being discarded one line
 * before it was displayed.
 *
 * `__DEV__` is a build constant, so this is stripped from a production bundle
 * along with the raw message. It must never become a user-facing surface:
 * relaying Supabase verbatim on sign-in is the account-existence oracle the
 * docblock below exists to prevent.
 *
 * ⚠ The `typeof` guard is load-bearing, not defensive habit. `__DEV__` is
 * defined by Metro and by jest-expo, and **not** by the web suite's `node`
 * environment — and `lib/__tests__/mobile-session.test.ts` requires this module
 * directly from there. A bare `!__DEV__` throws `ReferenceError` before any
 * assertion runs, which is how this arrived: eleven passing tests turned red in
 * a file that had nothing to do with the change.
 */
function logAuthFailure(where: string, error: { message: string; status?: number }): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return;
  console.warn(`[auth:${where}] ${error.status ?? '—'} ${error.message}`);
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
/**
 * Create an account.
 *
 * ── Why this had to exist before launch ─────────────────────────────────────
 *
 * `SignInScreen` could only sign in. There was no account creation anywhere in
 * the app, and no onboarding either — so the only way to become a CrewChief
 * user was to open the web app, sign up, add a car, and *then* install this.
 * Fine for a companion. Fatal for a mobile-first product sold on the App Store:
 * a reviewer downloads it and cannot reach the product at all.
 *
 * ── Email and password only, deliberately ───────────────────────────────────
 *
 * Same reasoning `SignInScreen` already carries: adding Google or Facebook
 * login triggers Apple's Sign in with Apple requirement (guideline 4.8), which
 * is a submission-scope decision and not one to make by adding a button.
 *
 * ── Confirmation is not assumed either way ──────────────────────────────────
 *
 * Supabase returns a session immediately when email confirmation is off, and
 * returns a user with **no session** when it is on. Both are successes and they
 * need different words on screen — "you're in" versus "check your email" — so
 * this reports which happened rather than guessing at the project's setting.
 * Guessing wrong strands someone on a screen that says nothing.
 */
export async function signUp(
  email: string,
  password: string
): Promise<SignInResult & { needsConfirmation?: boolean }> {
  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
  });

  if (error) {
    logAuthFailure('signUp', error);

    const isNetwork = /network|fetch|timeout/i.test(error.message);
    if (isNetwork) {
      return {
        ok: false,
        error: 'Could not reach CrewChief. Check your connection and try again.',
      };
    }

    /*
      Supabase's own message is surfaced here rather than replaced. Sign-in can
      afford one flat "did not match" because the causes are indistinguishable
      and equally recoverable; sign-up cannot — "password too short", "already
      registered" and "invalid email" each need a different action, and a
      generic sentence would send someone round the same loop.
    */
    return { ok: false, error: error.message };
  }

  // A session means confirmation is off and they are already in. No session
  // with a user means the confirmation email is the next step.
  return { ok: true, needsConfirmation: !data.session };
}

export async function signIn(email: string, password: string): Promise<SignInResult> {
  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });

  if (error) {
    logAuthFailure('signIn', error);

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
 * Send a password reset link.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * The web app has had `/forgot-password` since before the pivot, and this app
 * had no route to it at all — verified 13 Aug: zero occurrences of "forgot" or
 * `resetPasswordForEmail` anywhere in `apps/mobile`. On a companion that was
 * survivable, because the browser was always the way in. On a mobile-first
 * product it means someone who mistypes their password at the App Store's front
 * door has no way back in without being told, somewhere else, to go and use a
 * website they have no reason to know exists.
 *
 * ── The link points at the web app on purpose ───────────────────────────────
 *
 * Supabase sends a URL, and something has to render a "choose a new password"
 * form when it is opened. `app/reset-password/page.tsx` already does, is already
 * deployed, and already handles the recovery token. A native reset screen would
 * be a second implementation of a security-sensitive flow to save one hop out to
 * a browser, and the hop is where the emailed link naturally opens anyway.
 *
 * ⚠ `redirectTo` must be allow-listed in Supabase → Authentication → URL
 * Configuration → Redirect URLs, or the link in the email lands on an error
 * page. That is a dashboard setting and cannot be read from here.
 *
 * ── This deliberately reports success it has not verified ───────────────────
 *
 * Supabase returns the same result whether or not the address has an account,
 * and this passes that through unchanged. Reporting "no such account" would
 * make an unauthenticated screen answer "does this person use CrewChief" — the
 * account-existence oracle `signIn` is written to avoid, reachable by anyone who
 * downloads the app. So the copy says what was *sent*, never what was *found*.
 */
export async function resetPassword(email: string): Promise<SignInResult> {
  const trimmed = email.trim();
  if (!trimmed) {
    return { ok: false, error: 'Enter your email address first.' };
  }

  const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
    redirectTo: `${API_BASE_URL}/reset-password`,
  });

  if (error) {
    logAuthFailure('resetPassword', error);

    const isNetwork = /network|fetch|timeout/i.test(error.message);
    return {
      ok: false,
      error: isNetwork
        ? 'Could not reach CrewChief. Check your connection and try again.'
        : 'Could not send the reset email. Try again in a moment.',
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
