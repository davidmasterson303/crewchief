/**
 * The button primitive holds the spec, so call sites do not have to.
 *
 * @jest-environment node
 *
 * `components/ui/button.tsx` was stock shadcn until 8 Aug, and `.field` had
 * already made the argument for fixing that here rather than at the call sites:
 * **a call site that still needs a colour is a bug in the primitive.**
 *
 * Five defects were fixed at once, and each is pinned below because each is the
 * kind of thing a `npx shadcn add button` would silently put back.
 *
 * ── Why a source scan ───────────────────────────────────────────────────────
 *
 * The subject is a `cva` class string. jsdom computes no layout, so it cannot
 * tell 40px from 44px, and it does not composite a `var()` against a backdrop —
 * the rendered evidence came from a browser and is recorded in the component's
 * docblock. What is checkable here is which classes the primitive declares,
 * which is exactly what regresses.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const BUTTON = join(ROOT, 'components', 'ui', 'button.tsx');

/**
 * Source with comments stripped.
 *
 * The fifth time in this repo. This component's docblock names every defect it
 * fixed — `rounded-md`, `ring-offset-2`, `bg-background`, `h-10`,
 * `disabled:opacity-50` — so every absence assertion below would be satisfied
 * by the prose explaining the absence.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

const button = code(readFileSync(BUTTON, 'utf8'));

describe('the target floor', () => {
  it('is at least 44px', () => {
    /*
      RB0 rule 3, on the primitive every button in the app is built from. Stock
      shadcn ships `h-10` — 40px — which put the whole product under the floor
      by default.

      `min-h` rather than `h`: a button whose label wraps should grow, not clip.
    */
    expect(button).toMatch(/min-h-\[44px\]/);
  });

  it('does not use a fixed height that could clip a wrapped label', () => {
    expect(button).not.toMatch(/["'\s]h-10\b/);
    expect(button).not.toMatch(/["'\s]h-9\b/);
  });

  it('keeps the floor on the sm size, which is a density step not an exemption', () => {
    // `sm` takes its compactness from padding. A control that genuinely must
    // render smaller than its hit area wants `.tap-target-44`, which grows the
    // area without inflating the glyph.
    const sm = button.slice(button.indexOf('sm:'), button.indexOf('lg:'));
    expect(sm).not.toMatch(/h-\d/);
  });

  it('exempts only the link variant, and says so', () => {
    /*
      A link is text, not a target. 44px of dead space around an inline word is
      worse than the rule it satisfies — so the exception is explicit
      (`min-h-0`) rather than implicit, which is the difference between a
      decision and an oversight.
    */
    const link = button.slice(button.indexOf('link:'));
    expect(link).toMatch(/min-h-0/);
  });
});

describe('the focus ring', () => {
  it('has no offset, so the halo touches the border', () => {
    /*
      An offset gap on a dark surface reads as a hairline crack rather than a
      ring. Settled for `.field` in v7 and never applied here until v8.
    */
    expect(button).not.toMatch(/ring-offset/);
  });

  it('still has a visible focus ring', () => {
    // The pair. Removing the offset must not be achieved by removing the ring,
    // which would be a keyboard-accessibility regression dressed as a fix.
    expect(button).toMatch(/focus-visible:ring-2/);
  });
});

describe('the disabled state', () => {
  it('states a fill and an ink rather than fading the whole control', () => {
    /*
      A group `opacity` multiplies with any alpha inside it — `text-white/50`
      under `opacity-60` composites to 0.30, which measured 2.71:1. These are
      pre-composited, so there is nothing to multiply and the contrast guard can
      read them.
    */
    expect(button).toMatch(/disabled:bg-\[var\(--surface-disabled\)\]/);
    expect(button).toMatch(/disabled:text-\[var\(--text-disabled\)\]/);
  });

  it('does not fade the control with an opacity', () => {
    expect(button).not.toMatch(/disabled:opacity-/);
  });
});

describe('the outline variant', () => {
  it('fills with nothing, so it cannot be darker than its container', () => {
    /*
      Stock filled it with `bg-background` — surface-0 — so an outline button on
      a card rendered DARKER than the card holding it. A raised control darker
      than its container does not read as raised; it reads as a hole.
    */
    const outline = button.slice(button.indexOf('outline:'), button.indexOf('secondary:'));

    expect(outline).toMatch(/bg-transparent/);
    expect(outline).not.toMatch(/bg-background/);
  });
});

describe('the radius', () => {
  it('uses the design-system token rather than shadcn’s', () => {
    // shadcn's `md` and this app's `md` are different numbers. The old value
    // landed near-right by coincidence, which is not the same as by decision.
    expect(button).toMatch(/rounded-xl/);
    expect(button).not.toMatch(/rounded-md/);
  });
});

describe('hover', () => {
  it('does not return up the ramp to cyan-600', () => {
    /*
      The design system's own `tokens/buttons.css` says hover goes up the ramp
      to `#0891B2`. Measured against the light ink the primary now carries, that
      pairing is **3.51:1 and fails AA** — the same shape as the ink row that
      spec originally omitted.

      `hover:bg-primary/90` composites toward the page ground instead: darker,
      5.87:1, and better than the resting state. Pinned so "harmonising with the
      design system" cannot quietly introduce a failing hover.
    */
    expect(button).toMatch(/hover:bg-primary\/90/);
    expect(button).not.toMatch(/hover:bg-\[#0891B2\]|hover:bg-cyan-600/);
  });
});
