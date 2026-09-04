/**
 * The advisor's answer renders as an answer, not as its own source.
 *
 * @jest-environment node
 *
 * Found by hand on 5 Aug: a real reply displayed literal `**$1,461**` and
 * `* **Front Brakes & Rotors:**` on the phone. The web had a bold renderer and
 * the Expo client had nothing — the same one-client capability gap as the
 * health band and the context-kind labels, on the screen that carries the App
 * Store 4.2 argument.
 *
 * The tokenising is in `@wellkept/core/answer-markup` so both clients agree on
 * what a line *means*; only the drawing is per-platform, since React Native has
 * no `<strong>` and the web has no `<Text>`.
 */

import { parseAnswer, parseAnswerLine } from '@wellkept/core/answer-markup';

/** The bold runs of a line, in order — what a renderer will emphasise. */
function boldRuns(line: string): string[] {
  return parseAnswerLine(line)
    .filter((token) => token.bold)
    .map((token) => token.text);
}

/** The line reassembled, to prove nothing is dropped on the way through. */
function plain(line: string): string {
  return parseAnswerLine(line)
    .map((token) => token.text)
    .join('');
}

describe('bold runs', () => {
  it('reads the exact string that shipped raw', () => {
    expect(boldRuns('That last trip ran you **$1,461** all-in.')).toEqual(['$1,461']);
  });

  it('is non-greedy across two runs', () => {
    // A greedy match swallows the middle and emphasises "a** and **b".
    expect(boldRuns('**a** and **b**')).toEqual(['a', 'b']);
  });

  it('leaves an unclosed marker as text rather than eating the rest', () => {
    expect(boldRuns('torque to **25 ft-lb')).toEqual([]);
    expect(plain('torque to **25 ft-lb')).toBe('torque to **25 ft-lb');
  });

  it('leaves a lone asterisk alone, because it is arithmetic', () => {
    // "25 ft-lb * 2" is a multiplication sign. Stripping it would be a worse
    // failure than showing it.
    expect(plain('torque to 25 ft-lb * 2 bolts')).toBe('torque to 25 ft-lb * 2 bolts');
  });

  it('never loses characters', () => {
    for (const line of [
      'plain text',
      '**all bold**',
      'mixed **bold** and plain',
      '',
      '**',
      'a**b**c',
    ]) {
      expect(plain(line)).toBe(line.replace(/\*\*(.+?)\*\*/g, '$1'));
    }
  });
});

describe('bullets', () => {
  it('recognises the exact line that shipped raw, and strips its marker', () => {
    const [line] = parseAnswer('* **Front Brakes & Rotors:** $678');

    expect(line.kind).toBe('bullet');
    // The marker is consumed here so no renderer draws it twice — once from
    // the text and once from its own glyph.
    expect(line.tokens.map((t) => t.text).join('')).toBe('Front Brakes & Rotors: $678');
    expect(line.tokens.filter((t) => t.bold).map((t) => t.text)).toEqual([
      'Front Brakes & Rotors:',
    ]);
  });

  it.each(['* item', '- item', '• item', '  * indented'])('accepts %s', (raw) => {
    expect(parseAnswer(raw)[0].kind).toBe('bullet');
  });

  it('does not treat emphasis at the start of a line as a bullet', () => {
    // `**Bold:** text` begins with an asterisk but is a sentence, not a list.
    const [line] = parseAnswer('**Total:** $1,519.44');

    expect(line.kind).toBe('text');
    expect(line.tokens.filter((t) => t.bold).map((t) => t.text)).toEqual(['Total:']);
  });
});

describe('whole answers', () => {
  it('keeps blank lines, so paragraphs do not run together', () => {
    // A renderer needs to know the model asked for a gap; collapsing them
    // turns a structured answer into a wall of text on a phone.
    const lines = parseAnswer('First paragraph.\n\nSecond paragraph.');

    expect(lines).toHaveLength(3);
    expect(lines[1].tokens.map((t) => t.text).join('')).toBe('');
  });

  it('parses the real answer that exposed this', () => {
    const answer = [
      'That last trip to Blackmarket Motorsports ran you **$1,461** all-in.',
      '',
      '* **Front Brakes & Rotors:** $678',
      '* **NGK Spark Plugs:** $294',
    ].join('\n');

    const lines = parseAnswer(answer);

    expect(lines.map((l) => l.kind)).toEqual(['text', 'text', 'bullet', 'bullet']);
    // Nothing anywhere still carries markup syntax.
    for (const line of lines) {
      for (const token of line.tokens) {
        expect(token.text).not.toMatch(/\*\*/);
      }
    }
  });
});

/**
 * The advisor can only quote a total it is shown.
 *
 * The fix that stored the invoice's grand total was **not enough on its own**:
 * the consultant prompt received line items and a bare *count* of documents, so
 * asked "what did my last service cost" the model did the only thing available
 * to it — added the items up — and reported a subtotal as the all-in figure.
 *
 * That is the shape this project keeps producing: a value corrected at rest and
 * never carried to the place that reads it. Storing it and prompting with it are
 * two separate defects, and only fixing both changes the answer.
 */
describe('invoice totals reach the consultant prompt', () => {
  const fs = require('node:fs') as typeof import('node:fs');
  const path = require('node:path') as typeof import('node:path');
  const root = path.join(__dirname, '..', '..');

  const prompts = fs.readFileSync(path.join(root, 'packages', 'core', 'src', 'prompts.ts'), 'utf8');
  const actions = fs.readFileSync(path.join(root, 'app', 'actions.ts'), 'utf8');

  it('declares and renders an invoice-totals section', () => {
    expect(prompts).toMatch(/invoiceTotals:\s*string\[\]/);
    expect(prompts).toMatch(/INVOICE TOTALS/);
    // A count alone is what produced the wrong answer.
    expect(prompts).toMatch(/context\.invoiceTotals/);
  });

  it('tells the model not to add up line items for a total', () => {
    // The instruction matters as much as the data: the items are right there,
    // and summing them is the intuitive move.
    expect(prompts).toMatch(/rather than adding up line items|exclude tax/i);
  });

  it('is actually populated from the stored documents', () => {
    const send = actions.slice(actions.indexOf('export async function sendConsultantMessage'));
    expect(send).toMatch(/invoiceTotals:/);
    expect(send).toMatch(/extracted_data/);
  });

  it('skips documents with no recorded total rather than reporting zero', () => {
    // Older documents predate the total being stored. "$0" would be a
    // confident lie about a real bill.
    const send = actions.slice(actions.indexOf('export async function sendConsultantMessage'));
    expect(send).toMatch(/typeof data\.total_cost !== 'number'/);
  });
});

/**
 * ── FN-14: single-asterisk emphasis, and the triple form ────────────────────
 *
 * Seen on the deployed demo, 23 Aug: *"of \*if\* it fails, it's \*when\*"* and
 * *"you \*always\* replace them as a pair"* — asterisks rendered as characters,
 * on the product's flagship feature. A screen reader says "asterisk when
 * asterisk".
 *
 * `***x***` was worse: the bold rule consumed four of the six markers and left
 * a stray `*` at each end.
 */
describe('emphasis, not asterisks', () => {
  it('reads single-asterisk emphasis as emphasis', () => {
    expect(parseAnswerLine("it's not *if* it fails, it's *when*")).toEqual([
      { text: "it's not ", bold: false, italic: false },
      { text: 'if', bold: false, italic: true },
      { text: " it fails, it's ", bold: false, italic: false },
      { text: 'when', bold: false, italic: true },
    ]);
  });

  it('reads the triple form as both, not as bold plus a stray marker', () => {
    expect(parseAnswerLine('this is ***urgent***')).toEqual([
      { text: 'this is ', bold: false, italic: false },
      { text: 'urgent', bold: true, italic: true },
    ]);
  });

  it('still leaves arithmetic alone', () => {
    /*
      ⚠ The case that makes this hard, and the reason it is a scanner rather
      than a lookbehind regex — which is a **parse-time SyntaxError** on Safari
      before 16.4, not a failed match.
    */
    expect(parseAnswerLine('torque to 25 ft-lb * 2')).toEqual([
      { text: 'torque to 25 ft-lb * 2', bold: false, italic: false },
    ]);
  });

  it('leaves an unclosed marker as text', () => {
    expect(parseAnswerLine('a * b')).toEqual([{ text: 'a * b', bold: false, italic: false }]);
    expect(parseAnswerLine('**unfinished')).toEqual([
      { text: '**unfinished', bold: false, italic: false },
    ]);
  });

  it('does not treat a marker inside a word as emphasis', () => {
    expect(parseAnswerLine('part*number')).toEqual([
      { text: 'part*number', bold: false, italic: false },
    ]);
  });

  it('keeps bold working beside it', () => {
    expect(parseAnswerLine('that ran **$1,461** all-in')).toEqual([
      { text: 'that ran ', bold: false, italic: false },
      { text: '$1,461', bold: true, italic: false },
      { text: ' all-in', bold: false, italic: false },
    ]);
  });
});

describe('a labelled money figure is its own kind of line', () => {
  /*
    ── ⚠ What this is for, and the line it must not cross ────────────────────

    The advisor's cost answers arrived as a run of identical paragraphs, so
    "$115" carried the same weight as the prose around it. A design critique of
    the rendered consultant called it the biggest miss on the screen: the whole
    value of the answer is the numbers, and nothing let them line up.

    Recognising the shape is safe; *guessing* at it is not. Every assertion
    below that expects `text` is the important half — a sentence forced into a
    right-hand column is worse than a sentence.
  */
  const kinds = (answer: string) => parseAnswer(answer).map((line) => line.kind);

  it('takes a short label and a money figure', () => {
    expect(kinds('DCT fluid change: $280')).toEqual(['figure']);
    expect(kinds('Bundled total: ~$1,900-2,100')).toEqual(['figure']);
    expect(kinds('Water pump + thermostat: $800 all-in')).toEqual(['figure']);
  });

  it('splits it into halves a renderer can align', () => {
    const [line] = parseAnswer('Brake fluid flush: $115');

    expect(line.figure?.label.map((t) => t.text).join('')).toBe('Brake fluid flush');
    expect(line.figure?.amount.map((t) => t.text).join('')).toBe('$115');
    // The whole line survives too, for the client that does not know this kind.
    expect(line.tokens.map((t) => t.text).join('')).toBe('Brake fluid flush: $115');
  });

  it('leaves a sentence alone, however much money is in it', () => {
    /*
      The real line from the seeded M3 answer. 66 characters after the colon:
      it is prose, and a right-hand column would wrap it into a 390px gutter.
    */
    expect(
      kinds('Rod bearing inspection: $180 parts + $600 labor (bundled with water pump) = ~$780')
    ).toEqual(['text']);

    expect(kinds('Bundled at a good independent Euro shop, here is the real number:')).toEqual([
      'text',
    ]);
    expect(
      kinds('For a 444hp car at 67k miles, that is genuinely reasonable preventive maintenance.')
    ).toEqual(['text']);
  });

  it('declines a line whose emphasis straddles the colon', () => {
    /*
      Splitting `**Bundled total:** $x` leaves an unmatched `**` in each half
      and the tokeniser would render the asterisks. This file's standing rule is
      that unmatched syntax is left alone rather than mangled.
    */
    expect(kinds('**Bundled total:** $1,900')).toEqual(['text']);
  });

  it('leaves a bullet a bullet', () => {
    // The marker is the model saying these belong together; promoting the item
    // out of its list would reorder the model's own structure.
    expect(kinds('- DCT fluid change: $280')).toEqual(['bullet']);
  });

  it('requires both a label and an amount, not merely the punctuation', () => {
    expect(kinds('$: $')).toEqual(['text']);
    expect(kinds('Total: $')).toEqual(['text']);
  });
});
