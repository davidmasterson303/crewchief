import { signIn } from './session';

/**
 * A signed-in session on a development build, without anyone typing a password.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * Verifying the invoice flow needs an authenticated session, and the session on
 * this simulator has died repeatedly mid-test — once after roughly fourteen
 * idle minutes. Every death costs a hand-typed sign-in before testing can
 * resume, and the person running the tests should not have to type a password
 * into a form to unblock an automated check. Neither should anything else.
 *
 * So a development build can sign itself in from credentials that live in
 * `apps/mobile/.env`, which is gitignored (`.env*`, root `.gitignore:37`).
 *
 * ── The rules this follows, which are not negotiable ────────────────────────
 *
 * **`__DEV__` only, and verified stripped rather than assumed.** `EXPO_PUBLIC_*`
 * values are inlined into the bundle at transform time, so a careless version
 * of this file would compile a real password into a release binary. Every read
 * is inside a `__DEV__` branch so dead-code elimination removes the branch and
 * the inlined literal with it — the same mechanism that strips the token panel,
 * which was confirmed by searching an actual production bundle and finding zero
 * occurrences. `mobile-dev-session-stripped.test.ts` re-checks that here.
 *
 * **The values never pass through a chat transcript.**
 * `crewchief-set-dev-login.command` moves them clipboard → file, the same
 * pattern `crewchief-set-eas-token.command` established for the Expo token.
 *
 * **It is opt-in by absence.** No `.env`, no behaviour — the sign-in screen is
 * exactly what it was. Nothing here weakens a build that does not configure it.
 *
 * ── What this is not ────────────────────────────────────────────────────────
 *
 * Not a fix for the session dying. It removes the *cost* of that happening
 * during testing, which is what unblocks the retest — but the underlying
 * question, why a session lapsed after ~14 idle minutes when access tokens are
 * meant to last an hour and `autoRefreshToken` is on, is still open and is a
 * real-user problem: open the app, get distracted, come back.
 */

/**
 * Read at module scope so the `__DEV__` guard wraps the *inlining*, not just
 * the use. Referencing `process.env.EXPO_PUBLIC_*` outside a dev branch would
 * put the literal in every bundle regardless of what later code does with it.
 */
const DEV_EMAIL = __DEV__ ? process.env.EXPO_PUBLIC_DEV_EMAIL : undefined;
const DEV_PASSWORD = __DEV__ ? process.env.EXPO_PUBLIC_DEV_PASSWORD : undefined;

/** Whether this build can sign itself in. False in every release build. */
export function hasDevCredentials(): boolean {
  return Boolean(__DEV__ && DEV_EMAIL && DEV_PASSWORD);
}

/**
 * Sign in using the development credentials, if there are any.
 *
 * Returns what happened, so the caller can say so on screen rather than
 * leaving a silent failure that looks like the app ignoring a tap:
 *
 *   - `unavailable` — not a dev build, or no credentials configured
 *   - `ok`          — signed in; `onAuthStateChange` swaps the screen
 *   - `failed`      — credentials present and rejected, with the reason
 */
export async function signInWithDevCredentials(): Promise<
  { status: 'unavailable' } | { status: 'ok' } | { status: 'failed'; error: string }
> {
  if (!hasDevCredentials()) return { status: 'unavailable' };

  const result = await signIn(DEV_EMAIL as string, DEV_PASSWORD as string);

  if (result.ok) return { status: 'ok' };

  /*
    Surfaced rather than swallowed. A wrong password in `.env` and an
    unreachable auth server look identical from the outside, and the whole
    point of this path is that nobody is standing there to interpret it.
  */
  return { status: 'failed', error: result.error ?? 'Dev sign-in was rejected.' };
}
