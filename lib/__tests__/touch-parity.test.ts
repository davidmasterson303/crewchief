/**
 * RB0 rule 4 — a control revealed by hover has a non-hover path.
 *
 * @jest-environment node
 *
 * ── Why this is a check and not a review habit ──────────────────────────────
 *
 * The rule was adopted in RB0 and the three controls the audit named were
 * migrated to `.reveal-on-hover` the same day. Cowork's QA run on 2 Aug then
 * found four more that had never been migrated at all — a toast's close button,
 * two mileage pencils on the dashboard, and Mark-complete/delete on a wishlist
 * row. None of them was new. They simply were not in the list anyone looked at.
 *
 * `docs/qa-script.md` carries this as check B8, a grep run by whoever is
 * testing. That is a review comment, and the roadmap's own argument about the
 * 44px floor applies here word for word: a rule enforced by remembering is a
 * rule that decays. This is the same grep, run by the build.
 *
 * ── What "has a non-hover path" means mechanically ──────────────────────────
 *
 * `app/globals.css` pins `.reveal-on-hover`, `.meta-edit` and `.turn-actions`
 * to `opacity: 1` under `@media (hover: none)`, and reveals them on
 * `:focus-visible` / `:focus-within`. An element written as raw Tailwind
 * `opacity-0 group-hover:opacity-100` gets neither: on a phone it is not a
 * subtle affordance, it is nothing.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');

/** The utilities in `app/globals.css` that carry the touch and focus paths. */
const PARITY_UTILITIES = ['reveal-on-hover', 'meta-edit', 'turn-actions'];

/**
 * A hover-only reveal. Matches named groups (`group-hover/item:opacity-100`)
 * as well as the bare form — the audit's note about `.group\/image` is the same
 * trap in the other direction, and three of the four Cowork found used a named
 * group.
 */
const HOVER_REVEAL = /group-hover(\/[a-z-]+)?:opacity-100/;

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, acc);
    else if (entry.name.endsWith('.tsx')) acc.push(full);
  }
  return acc;
}

const FILES = [...sourceFiles(join(ROOT, 'components')), ...sourceFiles(join(ROOT, 'app'))];

/** Every line that reveals something on hover, with its file and line number. */
function hoverReveals(): { where: string; line: string }[] {
  const out: { where: string; line: string }[] = [];
  for (const file of FILES) {
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (HOVER_REVEAL.test(line)) {
          out.push({ where: `${file.slice(ROOT.length + 1)}:${i + 1}`, line: line.trim() });
        }
      });
  }
  return out;
}

describe('every hover reveal has a touch path', () => {
  it('finds hover reveals at all, so the rule below is not vacuous', () => {
    /*
      Guards the guard. If the regex ever stops matching — a Tailwind upgrade
      that renames the variant, a refactor to a different mechanism — every
      assertion after it passes by finding nothing, and the check reports green
      on a codebase it is no longer reading. Two of this project's ratchets have
      already failed exactly this way.
    */
    expect(hoverReveals().length).toBeGreaterThan(0);
  });

  it.each(hoverReveals())('$where carries a parity utility', ({ line }) => {
    expect(PARITY_UTILITIES.some((u) => line.includes(u))).toBe(true);
  });
});

describe('the utilities those elements rely on still exist', () => {
  /*
    The other half of the contract. The markup can carry `.reveal-on-hover`
    forever and mean nothing if the rule behind it is deleted or the media query
    is changed — and that failure is invisible, because the class name is still
    right there in the source.
  */
  const CSS = readFileSync(join(ROOT, 'app/globals.css'), 'utf8');

  it.each(PARITY_UTILITIES)('.%s is declared', (utility) => {
    expect(CSS).toContain(`.${utility}`);
  });

  it('pins all three visible where there is no hover', () => {
    const pin = CSS.match(/@media \(hover: none\) \{([\s\S]*?)\n {2}\}/);

    expect(pin).not.toBeNull();
    for (const utility of PARITY_UTILITIES) {
      expect(pin![1]).toContain(`.${utility}`);
    }
  });

  it('never hides these with display or visibility', () => {
    /*
      `opacity`, never `display: none` or `visibility: hidden` — the original
      rule, kept because those two take the control out of the tab order as
      well as out of sight, which is the bug one layer down from this one.
    */
    const block = CSS.match(/\.reveal-on-hover,\n {2}\.meta-edit,\n {2}\.turn-actions \{([\s\S]*?)\}/);

    expect(block).not.toBeNull();
    expect(block![1]).not.toMatch(/display:\s*none|visibility:\s*hidden/);
    expect(block![1]).toMatch(/opacity:\s*0/);
  });
});
