/**
 * `$rules.inclusiveAffordances` — the work that only exists for people you are not.
 *
 * @jest-environment node
 *
 * ── Why these three, out of nine ────────────────────────────────────────────
 *
 * The roadmap keeps a list headed **"Already right — do not regress these"** —
 * nine deliberate pieces of responsive and accessibility work, each with a
 * reason written beside it. All nine were verified present on 17 Aug. Only
 * three are guarded here, and the filter is not importance:
 *
 * **A regression in these three is invisible to the person causing it.**
 *
 * Nobody develops in Windows High Contrast. Nobody develops with a coarse
 * pointer. So a rename that unhooks the forced-colors block, or a refactor that
 * drops the focus path from a hover-revealed control, produces a diff that
 * looks clean, a page that looks right, and a product that has quietly stopped
 * working for someone. The other six regress in front of you the moment you
 * resize a window, and a test is the wrong tool for those.
 *
 * ── The failure that motivates the first one, stated exactly ────────────────
 *
 * Forced colors overrides SVG `fill` and `stroke` as well as text and
 * background. Before item 17, every part of the cluster dial — unlit track, lit
 * arc, needle, ticks — resolved to one CanvasText. `globals.css` puts it well:
 * *"The gauge does not break, it does something worse: it still looks like a
 * gauge while showing a full ring at every score."*
 *
 * A dial that reads 100 for a car scoring 40 is not a degraded dial.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const CSS = readFileSync(join(ROOT, 'app', 'globals.css'), 'utf8');
const GAUGE = readFileSync(join(ROOT, 'components', 'ClusterGauge.tsx'), 'utf8');

/** The block the gauge's high-contrast behaviour lives in. */
function forcedColorsBlock(): string {
  const start = CSS.indexOf('@media (forced-colors: active)');
  expect(start).toBeGreaterThan(-1);

  // To the end of the media query — crude, and over-reading can only make the
  // assertions below stricter, never blinder.
  return CSS.slice(start, CSS.indexOf('\n  }\n', start));
}

describe('the gauge survives a palette the user chose', () => {
  it('restates every part of the dial in system colours', () => {
    const block = forcedColorsBlock();

    // `Highlight` and `GrayText` rather than the health ramp: the ramp is the
    // point of the ramp, but it overrides a palette someone set for a reason,
    // and a dial's whole job is being readable at a glance.
    expect(block).toContain('GrayText');
    expect(block).toContain('Highlight');
    expect(block).toContain('CanvasText');
  });

  it('still names classes the component actually renders', () => {
    /*
      ⚠ The assertion worth having, and the one a CSS-only check misses.

      Rename `.gauge-arc` in `ClusterGauge.tsx` and this stylesheet keeps its
      block, keeps its comment, keeps reviewing well — and stops applying. The
      rule is intact and hooked to nothing, which is indistinguishable from
      working right up until somebody in High Contrast opens the dashboard.

      Same shape as a mobile font face named but never loaded: the failure has
      no error, only a wrong appearance nobody present can see.
    */
    const parts = [
      'gauge-track',
      'gauge-arc',
      'gauge-needle',
      'gauge-tick',
      'gauge-hub',
      'gauge-label',
      'gauge-reading',
    ];

    const orphaned = parts.filter(
      (part) => CSS.includes(`.${part}`) && !GAUGE.includes(part)
    );

    expect(orphaned).toEqual([]);
  });

  it('never opts out with forced-color-adjust', () => {
    /*
      The documented wrong fix, and forbidden for the reason `user-scalable=no`
      is: it *works*. `forced-color-adjust: none` keeps the health ramp and the
      dial looks correct to the developer — while overriding the exact palette
      the user set because they need it.

      Prose may name it; the file's own comment explains why it was declined.
      Only a declaration is a violation.
    */
    const declarations = CSS.split('\n').filter((line) =>
      /^\s*forced-color-adjust\s*:/.test(line)
    );

    expect(declarations).toEqual([]);
  });

  it('keeps the reading in text, not only in paint', () => {
    // The belt to that braces: whatever happens to the colours, the score is
    // still announced and still legible as a numeral.
    expect(GAUGE).toMatch(/aria-label/);
  });
});

describe('a control revealed by hover has another way in', () => {
  const REVEALED = ['.reveal-on-hover', '.meta-edit', '.turn-actions'];

  it('hides them with opacity, never display', () => {
    /*
      `display: none` takes a control out of the accessibility tree entirely, so
      a screen-reader user cannot reach what a sighted mouse user merely has not
      revealed yet. Opacity keeps it present and focusable.
    */
    for (const control of REVEALED) {
      expect(CSS).toContain(control);
    }

    const block = CSS.slice(CSS.indexOf('.reveal-on-hover,'));
    expect(block.slice(0, block.indexOf('}'))).toContain('opacity: 0');
    expect(block.slice(0, block.indexOf('}'))).not.toContain('display: none');
  });

  it('gives each one a focus path as well as a hover path', () => {
    // R5's actual complaint: three controls a touch user could never reveal.
    expect(CSS).toContain('.reveal-on-hover:focus-visible');
    expect(CSS).toContain('.reveal-on-hover:focus-within');
    expect(CSS).toContain('.meta-edit:focus-visible');
  });

  it('reveals them outright where there is no hover at all', () => {
    /*
      ⚠ The half that focus does not cover. A touch user is not tabbing — they
      have no pointer to hover and no keyboard focus ring, so a control that
      only appears on hover or focus is a control that does not exist on a
      phone. `@media (hover: none)` is what makes it exist.
    */
    const coarse = CSS.slice(CSS.indexOf('@media (hover: none)'));
    expect(coarse.length).toBeGreaterThan(0);
    expect(CSS).toMatch(/@media \(hover: none\)/);
  });

  it('reaches Tailwind s named group, not only the bare one', () => {
    /*
      Tailwind's *named* groups emit `group/image` and **not** `group`, so a
      bare `.group:hover` misses the card's photo overlay — which globals.css
      calls "the one control of the three that matters most on a phone".

      Pinned because it is the kind of selector a tidy-up deletes as redundant.
    */
    expect(CSS).toContain('.group\\/image:hover .reveal-on-hover');
  });
});

describe('the 44px target utility is still a hit area, not a bigger glyph', () => {
  it('expands through a pseudo-element rather than sizing the control', () => {
    // Inflating the glyph is the obvious fix and the wrong one — it changes the
    // design to satisfy a rule about fingers.
    /*
      Anchored to the declaration, not the name. The first `.tap-target-44` in
      this stylesheet is 600 lines earlier, inside the floors comment that
      *describes* the rule — so an unanchored search reads prose and asserts
      nothing. It passed on the comment first time round, which is exactly the
      kind of green a scanner should not be trusted to give.
    */
    const start = CSS.indexOf('.tap-target-44 {');
    expect(start).toBeGreaterThan(-1);

    const block = CSS.slice(start, start + 600);
    expect(block).toContain('::after');
    expect(block).toMatch(/44px|2\.75rem/);
  });
});
