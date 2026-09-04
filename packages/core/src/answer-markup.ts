/**
 * The small subset of markdown the advisor actually emits.
 *
 * ── Why this is in core ─────────────────────────────────────────────────────
 *
 * `ConsultantChat.tsx` had a `renderMarkdownLine` that turned `**bold**` into
 * `<strong>`. The Expo advisor had nothing, so the same answer rendered as
 * literal `**$1,461**` and `* **Front Brakes & Rotors:**` on the phone — raw
 * asterisks on the flagship screen of a portfolio app, found by hand on 5 Aug.
 *
 * That is the same shape as the health band, the context-kind labels and the
 * garage columns: a capability living in one client, silently absent from the
 * second. So what a line *means* — this run is emphasised, this line is a
 * bullet — is decided here, once, and how it looks stays with each platform.
 * React Native has no `<strong>` and the web has no `<Text>`; neither needs to
 * know how the other draws it.
 *
 * ── Deliberately not a markdown library ─────────────────────────────────────
 *
 * The advisor is instructed to answer in prose. What it actually produces is
 * bold runs and the occasional bullet list, and nothing here should encourage
 * more: a full parser would render headings and tables the moment a model
 * decided to emit them, on a 390pt-wide screen that has no room for either.
 * Supporting exactly what appears, and rendering the rest as the plain text it
 * is, is the honest boundary.
 *
 * Unmatched syntax is left alone rather than stripped. A lone asterisk in
 * "torque to 25 ft-lb * 2" is a multiplication sign, and eating it would be a
 * worse failure than showing it.
 */

/** A run of text within a line, emphasised or not. */
export interface AnswerToken {
  text: string;
  bold: boolean;
  /**
   * `*emphasis*` — FN-14.
   *
   * ⚠ Absent until 24 Aug, and the consequence was visible on the deployed
   * demo: *"of \*if\* it fails, it's \*when\*"* and *"you \*always\* replace them
   * as a pair"* rendered with their asterisks. A screen reader says "asterisk
   * when asterisk".
   */
  italic: boolean;
}

/** One rendered line: a paragraph, a bulleted item, or a labelled figure. */
export interface AnswerLine {
  kind: 'text' | 'bullet' | 'figure';
  /**
   * The whole line, always — including for a `figure`.
   *
   * ⚠ Load-bearing for the client that has not been taught about the new kind.
   * `AdvisorScreen` switches on `bullet` and falls through to text for
   * everything else, so a figure renders there exactly as it did before this
   * existed. A kind that broke an unaware renderer would be the "capability
   * living in one client" defect this module was written to end.
   */
  tokens: AnswerToken[];
  /**
   * Present only on `figure`: the two halves, already tokenised.
   *
   * A renderer that wants a receipt draws these in two columns; one that does
   * not ignores them and draws `tokens`.
   */
  figure?: {
    label: AnswerToken[];
    amount: AnswerToken[];
    /**
     * Whether this row is the one the others add up to.
     *
     * ── ⚠ Read from the label, never inferred from the number ──────────────
     *
     * A design critique of the rendered consultant put it exactly: "the total
     * isn't a total" — "Bundled total ~$1,900-2,100" rendered at the same
     * weight as a $115 brake flush, so "the punchline row of the whole answer
     * has no promotion".
     *
     * The temptation is to find the largest figure and promote that. ⚠ Don't:
     * a range beats a single number, an "all-in" line beats the subtotal it
     * includes, and the biggest number in a list is not reliably its sum —
     * that would be the app deciding what the advisor meant. The model wrote
     * the word "total"; this reads the word.
     */
    total: boolean;
  };
}

/** `* item`, `- item`, `• item` — with the marker removed. */
const BULLET = /^\s*[*\-•]\s+/;

/**
 * `Water pump + thermostat: $800 all-in` — a label and a money figure.
 *
 * ── ⚠ Why this is recognised at all ─────────────────────────────────────────
 *
 * The advisor's most useful answers are cost breakdowns, and they arrived as a
 * run of identical paragraphs: "$115" carrying the same visual weight as the
 * connective prose around it. A design critique of the rendered page called it
 * the single biggest miss on the screen the product lives on — the whole value
 * of the answer is the numbers, and nothing was letting them line up.
 *
 * ── ⚠ Why it is this strict ─────────────────────────────────────────────────
 *
 * This must never capture a sentence. Three conditions, all required:
 *
 *   - the label is short and ends at the **first** colon;
 *   - the remainder is a money figure — optional `~`/`≈`, then `$`, then at
 *     most 40 characters;
 *   - the whole line ends there.
 *
 * Measured against the seeded M3 answer, that takes "DCT fluid change: $280"
 * and "Bundled total: ~$1,900-2,100" and leaves "Rod bearing inspection: $180
 * parts + $600 labor (bundled with water pump) = ~$780" as prose — because it
 * *is* prose, and forcing it into a right-hand column would wrap 66 characters
 * into a 390px gutter.
 *
 * ⚠ It also declines any line whose emphasis markers straddle the colon
 * (`**Bundled total:** $x`), because splitting there would leave an unmatched
 * `**` in each half and the tokeniser would render the asterisks. Prose is the
 * safe answer, and this file's rule is that unmatched syntax is left alone.
 */
const FIGURE = /^([^:*_\n]{1,60}):[ \t]+((?:~|≈)?\$[^:\n]{0,40})$/;

/** The label of a summing row, as the advisor actually writes them. */
const TOTAL_LABEL = /\btotals?\b/i;

function splitFigure(content: string): { label: string; amount: string } | null {
  const match = FIGURE.exec(content);
  if (!match) return null;

  const [, label, amount] = match;
  // A label with no letters is not a label, and an amount with no digits is
  // not an amount — "$: $" should stay the text it is.
  if (!/[A-Za-z]/.test(label) || !/[0-9]/.test(amount)) return null;

  return { label: label.trim(), amount: amount.trim() };
}

/**
 * ── ⚠ Why this is a scanner and not a regex (FN-14) ─────────────────────────
 *
 * Single-asterisk emphasis needs to be told apart from **arithmetic**, and this
 * codebase already has a test for it: `"25 ft-lb * 2"` must survive intact.
 * The rule that distinguishes them is about the characters on *either side* of
 * the marker — an opening `*` is not preceded by a word character and not
 * followed by a space; a closing `*` is not preceded by a space and not
 * followed by a word character.
 *
 * Expressed as a regex that needs lookbehind, and **lookbehind is a parse-time
 * syntax error on Safari before 16.4** — not a failed match, a thrown
 * SyntaxError that takes the whole bundle with it. For a mobile-first product
 * that is not a trade worth making for four characters of brevity.
 *
 * So the scanner walks the line once. It is longer and it is decidable by
 * reading it.
 *
 * ── Order is longest-first, and it is load-bearing ──────────────────────────
 *
 * `***x***` has to be recognised before `**x**`, or the bold rule consumes four
 * of the six asterisks and leaves a stray `*` at each end — which is exactly
 * how the audit found `***x***` "rendering corrupted".
 */
const WORD = /[A-Za-z0-9_]/;

function isWord(char: string | undefined): boolean {
  return char !== undefined && WORD.test(char);
}

function isSpace(char: string | undefined): boolean {
  return char === undefined || /\s/.test(char);
}

/**
 * Where a run of `marker` closes, or `-1`.
 *
 * `single` applies the arithmetic guard: the closing marker must not be
 * preceded by a space and must not be followed by a word character.
 */
function closingAt(line: string, from: number, marker: string, single: boolean): number {
  let at = line.indexOf(marker, from);

  while (at !== -1) {
    const contentOk = at > from;
    const spacingOk = !single || (!isSpace(line[at - 1]) && !isWord(line[at + marker.length]));

    if (contentOk && spacingOk) return at;
    at = line.indexOf(marker, at + 1);
  }

  return -1;
}

export function parseAnswerLine(line: string): AnswerToken[] {
  const tokens: AnswerToken[] = [];
  let plain = '';
  let at = 0;

  const flush = () => {
    if (plain !== '') {
      tokens.push({ text: plain, bold: false, italic: false });
      plain = '';
    }
  };

  while (at < line.length) {
    if (line[at] !== '*') {
      plain += line[at];
      at += 1;
      continue;
    }

    /*
      Longest marker first. `***` is both, `**` is bold, `*` is emphasis — and
      recognising them in the other order is what corrupts `***x***`.
    */
    const candidates: Array<{ marker: string; bold: boolean; italic: boolean }> = [
      { marker: '***', bold: true, italic: true },
      { marker: '**', bold: true, italic: false },
      { marker: '*', bold: false, italic: true },
    ];

    let consumed = false;

    for (const { marker, bold, italic } of candidates) {
      if (!line.startsWith(marker, at)) continue;

      const single = marker === '*';

      /*
        ⚠ The arithmetic guard's opening half. `25 ft-lb * 2` has a space after
        the marker, and a word character before it in `a*b` — either rules the
        run out, and both are cases a person meant literally.
      */
      if (single && (isSpace(line[at + 1]) || isWord(line[at - 1]))) continue;

      const close = closingAt(line, at + marker.length, marker, single);
      if (close === -1) continue;

      flush();
      tokens.push({ text: line.slice(at + marker.length, close), bold, italic });
      at = close + marker.length;
      consumed = true;
      break;
    }

    if (!consumed) {
      // An unclosed marker is text. `**` with no partner survives as itself.
      plain += line[at];
      at += 1;
    }
  }

  flush();

  // An empty line still needs one token, so a renderer can draw the gap the
  // model put there rather than collapsing paragraphs together.
  return tokens.length > 0 ? tokens : [{ text: line, bold: false, italic: false }];
}

/**
 * Split an answer into renderable lines.
 *
 * A bullet's marker is consumed here so no client re-implements "is this a
 * list item", and so the marker cannot be drawn twice — once by the parser and
 * once by a renderer adding its own.
 */
export function parseAnswer(answer: string): AnswerLine[] {
  return answer.split('\n').map((raw) => {
    const isBullet = BULLET.test(raw);
    const content = isBullet ? raw.replace(BULLET, '') : raw;
    const tokens = parseAnswerLine(content);

    /*
      A bullet stays a bullet. A figure inside a list is still a list item, and
      promoting it out of the list would silently reorder the model's own
      structure — the marker is the model's statement that these belong
      together.
    */
    if (!isBullet) {
      const figure = splitFigure(content);
      if (figure) {
        return {
          kind: 'figure' as const,
          tokens,
          figure: {
            label: parseAnswerLine(figure.label),
            amount: parseAnswerLine(figure.amount),
            total: TOTAL_LABEL.test(figure.label),
          },
        };
      }
    }

    return {
      kind: isBullet ? ('bullet' as const) : ('text' as const),
      tokens,
    };
  });
}
