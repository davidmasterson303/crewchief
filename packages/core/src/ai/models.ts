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

/**
 * The consultant's health round trip.
 *
 * Named rather than written at the call site because the point of that check
 * is to exercise *the model the consultant actually uses*. It ran
 * `'gemini-2.5-flash'` as a literal while the consultant ran `FLASH_MODEL`,
 * so the canary could report a healthy consultant on the strength of a
 * different model answering a question nobody asked. A green check is
 * evidence only of what it examines.
 */
export const CONSULTANT_HEALTH_MODEL = FLASH_MODEL;

/**
 * How much thinking a job is allowed, by name.
 *
 * ── Why this is set at all ──────────────────────────────────────────────────
 *
 * Nothing set it, and the default is not free. Measured 2 Aug 2026 against the
 * live key, same prompt each time: `gemini-3.6-flash` with no thinking level
 * spent **861 thinking tokens to produce 168 tokens of answer**. Thinking
 * bills at the output rate, so the invisible five-sixths of that call was the
 * bill. `LOW` brought it to 424 for an answer of the same length.
 *
 * The numbers, for whoever re-tunes this:
 *
 *   unset 861 · HIGH 726 · LOW 424 · MINIMAL 0
 *
 * `unset` costing more than `HIGH` is not a typo; it is one sample and the
 * default is its own policy, not an alias for a level.
 */
export type ThinkingLevelName = 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH';

/**
 * Whether a model accepts `thinkingConfig.thinkingLevel` at all.
 *
 * **This is a hard 400, not a hint that gets ignored.** Measured: sending a
 * level to `gemini-2.5-flash` returns
 * `INVALID_ARGUMENT — "Thinking level is not supported for this model."`
 * The generation configs are shared across model families, so a level added to
 * one of them reaches 2.5 call sites too and takes them down. That is the trap
 * this function exists to close, and `ai-thinking-level.test.ts` is what keeps
 * it closed.
 *
 * The 3.x families accept it; 2.5 Flash and 2.5 Pro do not. Anything unknown
 * is treated as not accepting it — the failure mode of guessing wrong in that
 * direction is a slightly larger bill, and of guessing wrong in the other is a
 * dead endpoint.
 */
export function acceptsThinkingLevel(model: string): boolean {
  return model.startsWith('gemini-3');
}
