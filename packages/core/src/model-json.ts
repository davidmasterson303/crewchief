/**
 * Reading a value out of a model's JSON, in whichever spelling it arrived in.
 *
 * ── ⚠ The defect this exists to end ─────────────────────────────────────────
 *
 * **Every health score CrewChief ever generated was 70.** The prompt asked for
 * `healthScore`; the parser read `health_score`; the value was therefore always
 * `undefined`, and the line under it substituted a documented neutral. Nothing
 * failed. The number was written to the column a gauge reads, and the gauge
 * rendered it beside a summary saying the car's condition was *"impossible to
 * assess"* — two halves of one row, one of them a constant.
 *
 * It survived because **a missing key and a key holding the wrong type look the
 * same to `??`**, and because the fallback was defensible in isolation: 70 *is*
 * the right value when generation failed. What made it a lie was that
 * generation had succeeded.
 *
 * ── Why "first of these" rather than "normalise the object" ─────────────────
 *
 * A `camelCase → snake_case` transform over the whole payload is the tempting
 * fix and it is worse. It would silently absorb a **renamed** prompt field — ask
 * for `overallScore` tomorrow and a whole-object transform still produces a
 * `health_score` key holding `undefined`, and the same bug returns wearing a
 * different name.
 *
 * Naming both spellings at the call site is deliberately more typing. It puts
 * the prompt's word and the column's word on one line, where a rename to either
 * is visible to whoever makes it — and it is what
 * `lib/__tests__/health-prompt-fields-are-read.test.ts` can check mechanically.
 *
 * ── Every reader returns `null`, never a default ────────────────────────────
 *
 * ⚠ The caller decides what absence means, because only the caller knows
 * whether absence is safe. `red_flags` may default to `[]`; a score may not
 * default to anything. §6 of `CLAUDE.md`: `null` is never `0`, and a missing
 * score is "we cannot say".
 */

/** The first candidate that is a finite number. `null` if none is. */
export function firstNumber(...candidates: unknown[]): number | null {
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate;

    /*
      ⚠ A numeric string counts, and this is not laxness. Models return `"72"`
      often enough that refusing it would reintroduce the same silent fallback
      this module exists to remove — and an unparseable string still lands on
      `null`, which is the honest answer either way.
    */
    if (typeof candidate === 'string' && candidate.trim() !== '') {
      const parsed = Number(candidate);
      if (Number.isFinite(parsed)) return parsed;
    }
  }

  return null;
}

/** The first candidate that is a non-empty string. `null` if none is. */
export function firstString(...candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate.trim();
  }

  return null;
}

/**
 * The first candidate that is an array, reduced to its usable strings.
 *
 * ⚠ An array that contains nothing usable returns `[]`, not `null` — the model
 * answered the question and the answer was "none". An **absent** key returns
 * `null`, so a caller can tell "it said none" from "it did not say".
 */
export function firstStringArray(...candidates: unknown[]): string[] | null {
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;

    return candidate.flatMap((entry) => {
      const text = firstString(entry);
      return text === null ? [] : [text];
    });
  }

  return null;
}

/**
 * Clamp a model's score into the range the prompt asked for.
 *
 * ⚠ Out of range is **`null`, not clamped**, and the difference matters. A
 * model that returns `430` has not produced a slightly-too-high score; it has
 * produced something that is not a score, and squashing it to 100 would write a
 * perfect reading from a broken response. Clamping is for values that are
 * meaningfully at the edge, and nothing about `430` is.
 */
export function scoreInRange(value: number | null, { min = 1, max = 100 } = {}): number | null {
  if (value === null) return null;
  if (!Number.isFinite(value)) return null;

  const rounded = Math.round(value);
  return rounded >= min && rounded <= max ? rounded : null;
}
