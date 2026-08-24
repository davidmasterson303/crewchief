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

/** One rendered line: either an ordinary paragraph or a bulleted item. */
export interface AnswerLine {
  kind: 'text' | 'bullet';
  tokens: AnswerToken[];
}

/** `* item`, `- item`, `• item` — with the marker removed. */
const BULLET = /^\s*[*\-•]\s+/;

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

    return {
      kind: isBullet ? ('bullet' as const) : ('text' as const),
      tokens: parseAnswerLine(content),
    };
  });
}
