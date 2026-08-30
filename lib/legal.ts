/**
 * The two facts these documents cannot be written without, and one date.
 *
 * ── `OPERATOR` — an entity, from 30 Aug ────────────────────────────────────
 *
 * **Southmoor Digital LLC**, on David's instruction. This is a substance
 * change rather than a wording one: the party a reader is contracting with,
 * and the party accountable for what this product says about their car, is now
 * a company rather than a person. `LAST_UPDATED` moves with it — that is the
 * rule this file already carried, not a courtesy.
 *
 * The entry it replaces read `David Masterson` and its reasoning is kept
 * because it was right about the mechanism and wrong about the timing. It
 * argued the entity question "did not need answering", since the Apple
 * membership is Individual and the seller name is David's either way — and
 * then predicted that forming one "would change who operates the service,
 * which is a substance change that bumps `LAST_UPDATED` on its own terms".
 * That is what has happened.
 *
 * ⚠ **The Apple half has not moved with it.** The membership submitted 16 Aug
 * is Individual, so the App Store listing still names David personally. A
 * privacy policy naming an LLC beside a store listing naming a person is a
 * disagreement anybody can read in one sitting, and closing it means enrolling
 * as an Organization — D-U-N-S, a fresh enrolment, an app transfer. Nothing in
 * this file can fix that. It is recorded here because this is where the next
 * person will be standing when they notice.
 *
 * ⚠ **No company address appears in either document, and that is not an
 * oversight.** Nobody has given one, and what Colorado publishes is the
 * registered agent's address rather than a mailing address. Apple's DSA trader
 * flow demands one the moment EU distribution is on — US-only at launch is
 * what currently keeps that off the table. Naming an address is a decision,
 * not a lookup, so this file does not guess at one.
 *
 * ── `CONTACT_EMAIL` — settled 19 Aug, and unchanged by the entity ──────────
 *
 * The company does not change this and it was checked rather than assumed: the
 * argument below is about what a *customer* can reach, and a gmail an LLC
 * monitors is reachable in exactly the way a gmail a person monitors is. What
 * an entity does add is somewhere for `support@` to live once a domain exists.
 *
 * ── The domain arrived, so it moved: 30 Aug ────────────────────────────────
 *
 * **`support@southmoordigital.com`** — iCloud Mail on the company's own domain,
 * live and verified from an external sender on 30 Aug. It replaces
 * `crewchief.support@gmail.com`, which still receives and is no longer the
 * public identity.
 *
 * Three reasons, and the third is the one that made it urgent rather than
 * tidy. It carries the **operator's** name now that the operator is a company,
 * so the address and `OPERATOR` above agree instead of a policy signed by an
 * LLC pointing at a free mailbox named after a product that no longer exists.
 * It is not free-mail on a page App Review reads and scrapes permanently. And
 * it does not carry the old product name — which is the part that could not
 * wait, because the rename went through the copy on 30 Aug and this string
 * would have been the last "crewchief" on a public legal page.
 *
 * The argument this replaces is kept because it was right at the time and its
 * reasoning still governs the choice: a *product* address rather than
 * `support@davidmasterson.co`, which carries David's name and gives back most
 * of what the separation was for. Apple requires a support **URL** in the
 * listing and does not require the contact address to be domain-based, so the
 * free-mail form was a deliberate acceptance rather than a shortcut. What
 * changed is not that the old answer became wrong; it is that the entity and
 * the domain that made a better one possible now exist.
 *
 * ⚠ The property that actually matters on a privacy policy is unchanged and was
 * re-checked rather than assumed: the address is **verified receiving from an
 * outside sender**. An address that exists and is not answered is worse than a
 * free-mail one that is.
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

/** The legal name the service is operated under — confirmed by David, 30 Aug. */
export const OPERATOR = 'Southmoor Digital LLC';

/**
 * A monitored address on the operator's own domain — confirmed by David, 30 Aug,
 * and verified receiving from an external sender the same day.
 */
export const CONTACT_EMAIL = 'support@southmoordigital.com';

/**
 * The date the substance of these documents last changed.
 *
 * ⚠ **This is a ship date, not an edit date**, and on 30 Aug it is a promise
 * rather than a fact. It read `18 August` once while the contact was still
 * bracketed, because that was the day the operator landed on `main` — and
 * nothing deploys from `main`, so no reader ever saw it. The 19 August value
 * was correct because the promote happened that day.
 *
 * ⛔ **The operator change is NOT on a hostname yet.** `web-live` has been
 * frozen since 23 Aug and `crewchief.davidmasterson.co` still serves a policy
 * naming David personally. Until that promote runs, this date describes a
 * change no reader can see — which the paragraph above calls the same defect as
 * a date that precedes its own change.
 *
 * **So: if the promote slips past 30 August, move this line to the day it
 * runs.** It is one edit, and it is the difference between a date that means
 * something and one that teaches people it does not.
 *
 * ⚠ It does not move again for the contact address changing later the same day.
 * Two substance changes shipping together are one publication, and a date that
 * ticks per edit rather than per publication is the same defect in the other
 * direction.
 */
export const LAST_UPDATED = '30 August 2026';

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
