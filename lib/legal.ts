/**
 * The two facts these documents cannot be written without, and one date.
 *
 * ⚠ **`OPERATOR` and `CONTACT_EMAIL` are placeholders and must be replaced
 * before either page is linked publicly.** They are deliberately obvious rather
 * than plausible: a privacy policy naming an entity that does not exist is
 * worse than one that admits it is unfinished, and CrewChief has no entity yet
 * (`cc-business-0001`, and roadmap Q2 — still open).
 *
 * They live here rather than in the pages because a privacy policy and terms
 * of service that disagree about who is operating the service is a defect that
 * reads as boilerplate, which is the one thing these documents cannot afford to
 * look like.
 *
 * `LAST_UPDATED` is shown to the reader and is the date the *content* changed.
 * Bump it when the substance changes, not when the styling does — a policy
 * whose date moves for a CSS edit teaches people the date means nothing.
 */

/** ⚠ REPLACE — the legal or trading name the service is operated under. */
export const OPERATOR = '[OPERATOR NAME — see Q2, entity not yet formed]';

/** ⚠ REPLACE — a monitored address. Required by the App Store listing too. */
export const CONTACT_EMAIL = '[CONTACT EMAIL — not yet chosen]';

/** The date the substance of these documents last changed. */
export const LAST_UPDATED = '14 August 2026';

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
