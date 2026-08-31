/**
 * The Well Kept mark, as data — so the two clients cannot draw different plates.
 *
 * ── Why the geometry lives in core ──────────────────────────────────────────
 *
 * Design's brand package ships the mark as SVG, and the obvious move is to copy
 * the path into each client. This project has been here: `Icon.tsx` carries the
 * rule *"do not redraw or approximate"* because a hand-copied Lucide glyph
 * drifts, and the old dial mark's path data was duplicated in two `Logo.tsx`
 * files that then had to be kept in step by hand.
 *
 * One set of numbers, imported twice. A change to the plate is a change to both
 * clients by construction, and `brand.test.ts` pins every value against the
 * package's own SVG.
 *
 * ── The mark ────────────────────────────────────────────────────────────────
 *
 * A backlit coachbuilder's plate: a bevelled rectangle with the corners cut,
 * four rivets, and the name engraved across it. Drawn on a 280 × 116 grid; the
 * square icon form uses 100 × 100.
 *
 * ⚠ **The name never glows. The plate does.** Design's rule, and the reason is
 * legibility rather than taste: light the letters and the plate reads as a
 * button somebody should press.
 */

/** The plate, on the 280-wide lockup grid. Height differs by variant. */
export const PLATE = {
  /** With the maker line under the name. */
  full: { width: 280, height: 116, path: 'M16 8 H264 L272 24 V92 L264 108 H16 L8 92 V24 Z' },
  /** Name only. */
  short: { width: 280, height: 96, path: 'M16 8 H264 L272 24 V72 L264 88 H16 L8 72 V24 Z' },
  /** The square icon form — the plate alone, carrying one or two letters. */
  icon: { width: 100, height: 100, path: 'M22 12 H78 L88 26 V74 L78 88 H22 L12 74 V26 Z' },
  /**
   * The favicon's plate, which is **not** the icon's.
   *
   * ⚠ Wider bevel and a taller body: at 24px the icon's proportions close up
   * and the cut corners stop reading as cuts. Design ships it as a separate
   * path rather than a scaled one, and copying the icon path here would lose
   * exactly the thing the second drawing exists for.
   */
  favicon: { width: 100, height: 100, path: 'M22 10 H78 L90 26 V74 L78 90 H22 L10 74 V26 Z' },
} as const;

/** Rivet centres, by plate variant. Radius is shared. */
export const RIVETS = {
  radius: 2.5,
  full: [
    { x: 30, y: 22 },
    { x: 250, y: 22 },
    { x: 30, y: 94 },
    { x: 250, y: 94 },
  ],
  short: [
    { x: 30, y: 22 },
    { x: 250, y: 22 },
    { x: 30, y: 74 },
    { x: 250, y: 74 },
  ],
} as const;

/**
 * The colours, and ⚠ they are the mark's own rather than the app's tokens.
 *
 * `REBRAND_PROMPT.md` is explicit that the rebrand is *"a name and a mark. No
 * token moves, no palette change"* — so these are stated here instead of
 * reaching into `tokens/colors.css` or the mobile theme. A lockup that changed
 * colour when a surface token moved would be a brand asset with a dependency
 * nobody intended.
 */
export const BRAND_COLOR = {
  /** The plate's face. Near-black, warmer than the app's page. */
  plate: '#16140F',
  /** The backlight behind it. */
  glow: '#22D3EE',
  /** The plate's edge, on dark grounds. */
  edge: 'rgba(160, 240, 252, 0.55)',
  /** The engraved name. */
  name: '#F5F3F0',
  /** The maker line, and the rivets. */
  quiet: 'rgba(245, 243, 240, 0.5)',
  rivet: 'rgba(245, 243, 240, 0.3)',
  /** Light-ground substitutions — the only sanctioned ones. */
  light: {
    edge: '#0E7490',
    name: '#100F0D',
    quiet: 'rgba(16, 15, 13, 0.42)',
  },
} as const;

/** Type, as Design set it. Sizes are in grid units, not pixels. */
export const BRAND_TYPE = {
  name: {
    family: 'Newsreader',
    weight: 500,
    size: 38,
    /**
     * ⚠ 0.1em, expressed in grid units at the 38 size. Design's ruling of
     * 30 Aug: *"a plate carries engraved type — the letterspacing is the
     * engraving, and it does not get tuned per word. If a longer string ever
     * has to fit, the plate widens; the tracking does not close."*
     */
    tracking: 3.8,
    baseline: { full: 63, short: 61 },
  },
  maker: {
    family: 'Inter',
    weight: 600,
    size: 13,
    tracking: 2.34,
    baseline: 92,
    text: 'SOUTHMOOR DIGITAL',
  },
} as const;

/** The word on the plate. Two words, both capitalised, set in small caps. */
export const BRAND_NAME = 'Well Kept';

/**
 * ⚠ Below these widths a lockup stops being legible, and the fallback is not
 * "shrink it".
 *
 * Design's rule: under 240 the maker line breaks the 12px text floor and must
 * be dropped, which is what `short` is for; under 160 there is no lockup left
 * and the icon takes over. A component that scaled past these would be
 * rendering type nobody can read and calling it a logo.
 */
export const MIN_WIDTH = { full: 240, short: 160 } as const;

/** 48 grid units on all sides. Nothing enters it, including the score mark. */
export const CLEAR_SPACE = 48;

/**
 * Which lockup a given width can carry.
 *
 * Exported so a caller picks by the space it has rather than by guessing, and
 * so the rule is enforced in one place instead of remembered at each call site.
 */
export function lockupFor(width: number): 'full' | 'short' | 'icon' {
  if (width >= MIN_WIDTH.full) return 'full';
  if (width >= MIN_WIDTH.short) return 'short';
  return 'icon';
}
