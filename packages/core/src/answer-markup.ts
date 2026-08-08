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
}

/** One rendered line: either an ordinary paragraph or a bulleted item. */
export interface AnswerLine {
  kind: 'text' | 'bullet';
  tokens: AnswerToken[];
}

/**
 * `**bold**` → runs.
 *
 * Non-greedy, so `**a** and **b**` yields two bold runs rather than one that
 * swallows the middle. An unclosed `**` matches nothing and survives as text.
 */
const BOLD = /\*\*(.+?)\*\*/g;

/** `* item`, `- item`, `• item` — with the marker removed. */
const BULLET = /^\s*[*\-•]\s+/;

export function parseAnswerLine(line: string): AnswerToken[] {
  const tokens: AnswerToken[] = [];
  let last = 0;

  BOLD.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = BOLD.exec(line)) !== null) {
    if (match.index > last) {
      tokens.push({ text: line.slice(last, match.index), bold: false });
    }
    tokens.push({ text: match[1], bold: true });
    last = match.index + match[0].length;
  }

  if (last < line.length) {
    tokens.push({ text: line.slice(last), bold: false });
  }

  // An empty line still needs one token, so a renderer can draw the gap the
  // model put there rather than collapsing paragraphs together.
  return tokens.length > 0 ? tokens : [{ text: line, bold: false }];
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
