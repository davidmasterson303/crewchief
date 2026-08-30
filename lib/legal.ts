/**
 * The two facts these documents cannot be written without, and one date.
 *
 * ── ⚠ OPEN, 30 Aug: neither of the two facts below has been re-decided ──────
 *
 * The product was renamed to **Well Kept** on 30 Aug. Nothing in this file
 * moved with it, deliberately:
 *
 *   `OPERATOR`        David says **Southmoor Digital LLC now exists**. If the
 *                     LLC operates the service, this constant is wrong on a
 *                     page Apple reads — and the docblock below already says
 *                     an entity is "a substance change that bumps
 *                     `LAST_UPDATED` on its own terms". Who the operator is
 *                     is David's answer, not a rename's.
 *   `CONTACT_EMAIL`   a real mailbox that exists and is delegated. Renaming
 *                     the string would point customers at nothing.
 *   `LAST_UPDATED`    must become the day the change reaches a live hostname,
 *                     not the day it was edited — see the note on it below.
 *
 * ⚠ And one thing that does not resolve itself: the reasoning below turns on
 * the Apple membership being **Individual**, so the store's seller name is
 * David's personal name. A policy naming an LLC beside a listing naming a
 * person is a disagreement in public, and closing it means enrolling as an
 * Organization — D-U-N-S, fresh enrolment, app transfer.
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
 * ── `CONTACT_EMAIL` — settled 19 Aug, and it is deliberately not a domain ───
 *
 * `crewchief.support@gmail.com`. A dedicated address rather than a personal
 * one, because this renders on a page App Review reads and gets scraped
 * permanently; and a *product* address rather than `support@davidmasterson.co`,
 * which carries David's name and so gives back most of what the separation was
 * for. `crewchief.co` is not his.
 *
 * The free-mail form is a deliberate acceptance, not a shortcut. Apple requires
 * a support **URL** in the listing and does not require the contact address to
 * be domain-based, so the thing a customer is pointed at is the site either
 * way. It is verified receiving and delegated to David's own mailbox, so it is
 * answered rather than merely existing — which is the only property of a
 * contact address on a privacy policy that actually matters.
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

/** A monitored address, delegated so replies come from CrewChief Support. */
export const CONTACT_EMAIL = 'crewchief.support@gmail.com';

/**
 * The date the substance of these documents last changed.
 *
 * ⚠ **This is a ship date, not an edit date.** It read `18 August` while the
 * contact was still bracketed, because that was the day the operator landed on
 * `main` — but nothing deploys from `main`, so no reader ever saw it. The
 * contact and the operator reach the public page together, today, and this is
 * that day. A date describing a change readers could not see is the same defect
 * as one that precedes the change it describes.
 */
export const LAST_UPDATED = '19 August 2026';

/**
 * Where Apple sends someone to stop a subscription.
 *
 * Re-exported from core rather than restated. The terms and the in-app deletion
 * notice must send people to the same place — if they drift, one of them is
 * telling somebody the wrong way to stop being charged, and the one they read
 * is whichever they happened to open. Importing makes that impossible; a test
 * asserting two copies match only tells you afterwards.
 */
export { SUBSCRIPTION_CANCEL_PATH } from '@wellkept/core/account-deletion';
