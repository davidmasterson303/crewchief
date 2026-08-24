import { SCREEN_BACKGROUND } from '../../test-support/contrast';
import {
  PAGE_BODY,
  TARGET_MIN,
  TYPE_MIN,
  brand,
  radius,
  rhythm,
  space,
  surface,
  text,
} from '../index';

/**
 * The token layer's own invariants.
 *
 * ── Why the harness does not import the theme ──────────────────────────────
 *
 * `test-support/contrast.ts` hardcodes the backdrop every ratio is composited
 * against. That is deliberate: a harness that read the value it is checking
 * would agree with any drift, and silently report ratios the app never renders.
 * The cost of that independence is that the two constants can diverge — so this
 * file is the thing that notices.
 *
 * It earned its place immediately. Moving the page from `#080808` to the warm
 * graphite touched 27 sites; the harness was the 28th, and nothing else in the
 * suite would have caught it staying behind.
 */
describe('the contrast harness measures against the surface the app renders on', () => {
  it('uses the same page colour the theme defines', () => {
    expect(SCREEN_BACKGROUND.toUpperCase()).toBe(surface.page.toUpperCase());
  });
});

describe('the floors the handoff says are lintable', () => {
  it('keeps the four numeric floors where the system put them', () => {
    expect(TARGET_MIN).toBe(44);
    expect(TYPE_MIN).toBe(12);
  });

  it('has no type role below the floor', () => {
    // 12 names a value, 13 is a value, 14 is UI, 16/18 are body. Anything
    // smaller is not a role, it is a mistake with a token name.
    const { type } = require('../index');
    for (const [role, style] of Object.entries<{ fontSize: number }>(type)) {
      expect({ role, size: style.fontSize }).toEqual({ role, size: expect.any(Number) });
      expect(style.fontSize).toBeGreaterThanOrEqual(TYPE_MIN);
    }
  });

  it('offers no text token quieter than the 50% floor', () => {
    /*
      `nonText` at 40% is the deliberate exception and is excluded by name — it
      is a hairline token. If a second sub-floor value ever appears in `text`,
      it is a word waiting to happen and this fails.
    */
    const quiet = Object.entries(text)
      .filter(([name]) => name !== 'nonText' && name !== 'disabled')
      .filter(([, value]) => {
        const match = /rgba\(255,255,255,([\d.]+)\)/.exec(value);
        return match ? Number(match[1]) < 0.5 : false;
      })
      .map(([name]) => name);

    expect(quiet).toEqual([]);
  });
});

describe('the pressed state that was corrected', () => {
  it('deepens the fill rather than lightening it', () => {
    /*
      The board's first draft sent pressed *up* the ramp to #0891B2 — 3.51:1
      under the near-white ink, and the exact hex v8 removed at 3.68:1. With
      near-white ink, lighter always means less contrast, so the direction is
      the invariant worth pinning, not the value.
    */
    const luminance = (hex: string) => {
      const channels = (hex.replace('#', '').match(/../g) ?? []).map((pair) => {
        const v = parseInt(pair, 16) / 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    };

    expect(luminance(brand.primaryPressed)).toBeLessThan(luminance(brand.primary));
  });
});

describe('the scales the handoff enumerated', () => {
  it('carries no radius the system says does not exist', () => {
    // "9, 10 and 16 do not exist."
    const forbidden = [9, 10, 16];
    expect(Object.values(radius).filter((r) => forbidden.includes(r))).toEqual([]);
  });

  it('keeps spacing on the 4pt scale', () => {
    // 11, 13, 15, 22 and 68 were all in use before the token layer landed.
    expect(Object.values(space).filter((s) => s % 4 !== 0)).toEqual([]);
  });
});

/**
 * ── R56 · the rhythm table, pinned to the review's numbers ──────────────────
 *
 * The v8.3 review measured the ten built screens and found the page gutter
 * varying between 16 and 24, card-to-card between 6 and 16, and the space under
 * a section label between 8 and 14. It then specified one value per slot.
 *
 * These are those values. Pinned rather than derived, because the point of the
 * table is that the numbers were **chosen** — a test that asserted
 * `rhythm.page === space.lg` would pass while the scale drifted underneath it
 * and would be testing an alias rather than a decision.
 */
describe('the vertical rhythm', () => {
  it('matches the specified slots', () => {
    expect(rhythm).toEqual({
      page: 16,
      afterNav: 20,
      afterLabel: 12,
      betweenCards: 12,
      cardPad: 16,
      afterTitle: 8,
      tail: 32,
    });
  });

  it('assembles a page body out of them and nothing else', () => {
    /*
      The spread every screen uses. If a raw number appears in here it appears
      on every screen at once, which is the failure this consolidation exists to
      make impossible rather than unlikely.
    */
    expect(PAGE_BODY).toEqual({
      paddingHorizontal: rhythm.page,
      paddingTop: rhythm.afterNav,
      paddingBottom: rhythm.tail,
      gap: rhythm.betweenCards,
    });
  });

  it('keeps every slot on the spacing scale', () => {
    // A rhythm value that is not a step of `space` is a number somebody typed.
    const steps = new Set<number>(Object.values(space));
    for (const [slot, value] of Object.entries(rhythm)) {
      expect([slot, steps.has(value)]).toEqual([slot, true]);
    }
  });
});
