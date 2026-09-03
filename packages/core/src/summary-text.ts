/**
 * The first complete sentence of a generated summary.
 *
 * ── Why a sentence rather than a character count ────────────────────────────
 *
 * The garage card ran a model-written paragraph under `line-clamp-2`, which
 * cuts at whatever character the line box ends on and appends an ellipsis — so
 * cards ended mid-clause, and where the cut landed near the text's own full
 * stop it rendered as a run of dots.
 *
 * A sentence is the unit the text is actually made of. Taking one whole is the
 * only truncation that cannot produce a fragment, and these summaries are
 * written lead-first: the first sentence is the judgement and the rest is
 * supporting detail, which the dossier screen carries.
 *
 * ⚠ Returns the whole string when it finds no terminator, rather than guessing
 * a cut. A summary with no full stop is unusual enough to be worth showing as
 * it is; inventing a boundary in it is how a fragment gets back in.
 */
export function firstSentence(text: string | null | undefined): string | null {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return null;

  /*
    A terminator followed by whitespace. Requiring the space is what stops a
    decimal or an abbreviation ending the sentence early — "94k miles." ends it,
    "1.5T" does not.
  */
  const match = trimmed.match(/^[\s\S]*?[.!?](?=\s)/);
  return (match ? match[0] : trimmed).trim();
}
