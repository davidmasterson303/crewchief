/**
 * The two facts these documents cannot be written without, and one date.
 *
 * ── `OPERATOR` — settled 18 Aug, and Apple settled it ───────────────────────
 *
 * This was a placeholder until 18 Aug because CrewChief has no legal entity
 * (`cc-business-0001`, roadmap Q2 — still open) and a policy naming an entity
 * that does not exist is worse than one admitting it is unfinished.
 *
 * **The entity question did not need answering.** The Apple Developer
 * membership submitted 16 Aug is **Individual, not Organization**, so the App
 * Store seller name is David's personal legal name whatever Q2 decides later.
 * Naming him here is consistent with what Apple displays anyway, needs no
 * entity to exist first, and cannot be made wrong by forming one — an entity
 * would change who operates the service, which is a substance change that
 * bumps `LAST_UPDATED` on its own terms.
 *
 * ⚠ **`CONTACT_EMAIL` is still a placeholder, and it is still rendering on a
 * public page.** David is standing up a dedicated address rather than
 * publishing a personal one; until it exists there is nothing true to put here.
 * It stays deliberately bracketed and self-describing for the original reason:
 * the failure mode is a well-meaning edit replacing it with something that
 * *reads* finished. `legal-pages.test.ts` holds it to that.
 *
 * These live here rather than in the pages because a privacy policy and terms
 * of service that disagree about who is operating the service is a defect that
 * reads as boilerplate, which is the one thing these documents cannot afford to
 * look like.
 *
 * `LAST_UPDATED` is shown to the reader and is the date the *content* changed.
 * Bump it when the substance changes, not when the styling does — a policy
 * whose date moves for a CSS edit teaches people the date means nothing.
 */

/** The legal name the service is operated under — confirmed by David, 18 Aug. */
export const OPERATOR = 'David Masterson';

/** ⚠ REPLACE — a monitored address. Required by the App Store listing too. */
export const CONTACT_EMAIL = '[CONTACT EMAIL — not yet chosen]';

/**
 * The date the substance of these documents last changed.
 *
 * ⚠ **Bump this again when `CONTACT_EMAIL` is filled in.** Naming the contact
 * for a legal document is a second substance change, not a follow-up to this
 * one, and it will ship on its own day.
 */
export const LAST_UPDATED = '18 August 2026';

/**
 * Where Apple sends someone to stop a subscription.
 *
 * Re-exported from core rather than restated. The terms and the in-app deletion
 * notice must send people to the same place — if they drift, one of them is
 * telling somebody the wrong way to stop being charged, and the one they read
 * is whichever they happened to open. Importing makes that impossible; a test
 * asserting two copies match only tells you afterwards.
 */
export { SUBSCRIPTION_CANCEL_PATH } from '@crewchief/core/account-deletion';
