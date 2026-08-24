import { parseAnswerLine } from '@crewchief/core/answer-markup';

/**
 * Draws the runs `@crewchief/core/answer-markup` identifies.
 *
 * ── Why this is its own file ────────────────────────────────────────────────
 *
 * It lived inside `ConsultantChat` as a local `renderMarkdownLine`, which made
 * it **untestable** — that component is a 1,000-line client component pulling in
 * react-query, the toast system and half a dozen dialogs, so nothing was going
 * to mount it for four lines of mapping.
 *
 * That mattered on 24 Aug, when the mapping went from two branches to four
 * (FN-14: single-asterisk emphasis and the `***both***` case). The tokeniser has
 * 23 cases; the *element* mapping had none, and the mobile renderer of the same
 * four branches is covered. A typo here would have rendered nothing and shown
 * nothing wrong.
 *
 * ── Why `<em>` and `<strong>` rather than font classes ──────────────────────
 *
 * The emphasis has to survive for a screen reader as well as for the eye. A
 * `font-style: italic` span reads identically to plain text, which is the same
 * failure as the asterisks it replaced — one you can see and not hear, the other
 * you can hear and not see.
 *
 * ⚠ Only the drawing is web. React Native has no `<strong>`, which is why the
 * tokenising is in core and this is not.
 */
export function AnswerLine({ line, lineKey }: { line: string; lineKey: number }) {
  return (
    <>
      {parseAnswerLine(line).map((token, index) => {
        /*
          ⚠ Both flags can be set at once — `***urgent***` — and that case has to
          be first. Checking `bold` before the pair means the triple form renders
          bold-only and the emphasis is silently dropped.
        */
        if (token.bold && token.italic) {
          return (
            <strong key={`bi-${lineKey}-${index}`} className="font-semibold text-white">
              <em>{token.text}</em>
            </strong>
          );
        }

        if (token.bold) {
          return (
            <strong key={`b-${lineKey}-${index}`} className="font-semibold text-white">
              {token.text}
            </strong>
          );
        }

        if (token.italic) {
          return <em key={`i-${lineKey}-${index}`}>{token.text}</em>;
        }

        return <span key={`t-${lineKey}-${index}`}>{token.text}</span>;
      })}
    </>
  );
}
