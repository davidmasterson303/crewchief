/**
 * The Gemini models this application uses, by job.
 *
 * ── Why these are constants and not literals ────────────────────────────────
 *
 * They used to be. This file existed, exported three names, was imported by
 * `app/actions.ts` — and every one of the 12 call sites hardcoded
 * `'gemini-2.5-flash'` anyway. The file described an intention the code never
 * implemented, and the public feature page described that intention as fact.
 *
 * `lib/__tests__/model-tiering.test.ts` now forbids a literal `'gemini-` in
 * `app/actions.ts`, because the way that state arose was a copy-pasted call
 * site, and nothing prevents that recurring except a check.
 *
 * ── Why they are pinned, and not `-latest` ──────────────────────────────────
 *
 * Google publishes moving aliases — `gemini-flash-latest`, `gemini-pro-latest`.
 * They are the wrong choice here. A model changing under a running app is
 * exactly the failure this codebase is worst at noticing: a worse invoice
 * extraction still returns well-formed JSON and still passes every gate. An
 * upgrade should be a commit someone verified, not a Tuesday.
 *
 * ── Verified availability ───────────────────────────────────────────────────
 *
 * Every identifier below was read from `/api/health/ai` on 30 Jul 2026 against
 * the deployed credential — not from release notes. That route lists what this
 * key can actually reach, which is the only list that matters.
 *
 * Note for whoever upgrades next: **there is no generally-available 3.x Pro.**
 * The only 3.x Pro entries are `gemini-3-pro-preview` and
 * `gemini-3.1-pro-preview`. `gemini-2.5-pro` is still the newest GA Pro model.
 * Re-check before assuming otherwise.
 */

/**
 * Reasoning-heavy generation where quality compounds.
 *
 * Used once per vehicle for the dossier, whose output is persisted and then
 * read by every later answer — so a better answer here is paid for once and
 * collected many times.
 */
export const PRO_MODEL = 'gemini-2.5-pro';

/**
 * The workhorse. Conversation, summaries, estimates, drafting.
 *
 * 3.6 Flash rather than 2.5: newer, and reported to use materially fewer
 * tokens for the same work — which matters most on the consultant, the call
 * made most often and the only one a user sits and waits on.
 */
export const FLASH_MODEL = 'gemini-3.6-flash';

/**
 * Cheap, near-deterministic classification and lookup.
 *
 * For questions whose answer is a word or a short list.
 * `validateConsultantDocument` asks "is this an automotive document?" and was
 * running on the same model, with the same 8192-token output budget, as full
 * dossier generation.
 */
export const LITE_MODEL = 'gemini-3.5-flash-lite';

/**
 * Vision — invoice and document extraction.
 *
 * Pinned separately from FLASH_MODEL even though the same family serves both,
 * and deliberately so: vision is the one path whose regressions are invisible.
 * A model that reads fewer line items off an invoice still returns valid JSON,
 * still passes the typecheck, still passes the demo contract. Its own constant
 * means it can be held back, or moved forward, on its own evidence.
 */
export const FLASH_VISION_MODEL = 'gemini-3.6-flash';
