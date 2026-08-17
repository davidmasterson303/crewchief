/**
 * The two faces, and the one rule that makes them work on a phone.
 *
 * ── ⚠ React Native does not synthesise weights for a bundled font ───────────
 *
 * This is the whole reason this file exists rather than a `fontFamily: 'Inter'`
 * line in the theme. On the web, `font-weight: 600` picks the semibold cut out
 * of a family. In React Native **each cut is its own family name** — Android
 * resolves fonts by filename and has no family table to consult, so
 * `fontFamily: 'Inter'` with `fontWeight: '600'` renders regular Inter, or on
 * some devices falls back to the system face entirely.
 *
 * So a weight is not a modifier here. It selects a file, and
 * `interFace(weight)` is the only sanctioned way to name one.
 *
 * ── ⚠ Why `fontWeight` is still set alongside it ────────────────────────────
 *
 * Redundant on paper, load-bearing in two places. iOS uses it to pick a cut
 * when the family does have a table, and — the reason it stays — the contrast
 * checker in `test-support/contrast.ts` reads `fontWeight` to decide whether a
 * string counts as large text under WCAG. Dropping it would silently relax the
 * contrast floor across the whole app.
 *
 * ── ⚠ Names here, files in `font-assets.ts`, and the split is deliberate ────
 *
 * This module names faces and never imports one. `font-assets.ts` holds the
 * `require` calls and is imported by `App.tsx` alone.
 *
 * The reason is concrete: `theme/index.ts` imports this, and five design-system
 * guards in `lib/__tests__` import *that* to check the shipped tokens. Pulling
 * a `.ttf` into the theme took all five down with `SyntaxError: Unexpected
 * token 'export'` the moment the fonts landed — the token layer cannot depend
 * on a bundler to be readable.
 *
 * The two are kept honest by `FONT_FACES` below: `font-assets.ts` is typed to
 * supply exactly these keys, so a face named here and never loaded is a
 * compile error rather than a silent fallback to San Francisco.
 */

/**
 * The weights this product actually draws.
 *
 * Kept deliberately short. Every entry is a file in the bundle, and a scale
 * with nine weights in it is a scale nobody can hold in their head — the same
 * argument the radius scale makes about 9, 10 and 16.
 */
export type FontWeight = '400' | '500' | '600' | '700' | '800';

/**
 * Every face the app ships, by name.
 *
 * Exactly one serif, because the editorial role is single-weight by definition:
 * *"Newsreader for one serif role per screen"*, one per screen, never two. A
 * second cut would be a second editorial role arriving by the back door.
 */
export const FONT_FACES = [
  'Inter_400Regular',
  'Inter_500Medium',
  'Inter_600SemiBold',
  'Inter_700Bold',
  'Inter_800ExtraBold',
  'Newsreader_700Bold',
] as const;

export type FontFace = (typeof FONT_FACES)[number];

const INTER_FACES: Record<FontWeight, FontFace> = {
  '400': 'Inter_400Regular',
  '500': 'Inter_500Medium',
  '600': 'Inter_600SemiBold',
  '700': 'Inter_700Bold',
  '800': 'Inter_800ExtraBold',
};

/**
 * The Inter face for a weight — the only sanctioned way to name one.
 *
 * Returns the family name, which callers pair with the same `fontWeight` they
 * already had. `mobile-font-faces.test.ts` fails on any text style that names a
 * weight without a face, which is what stops the app drifting back to a mix of
 * Inter and San Francisco.
 */
export function interFace(weight: FontWeight): FontFace {
  return INTER_FACES[weight];
}

/** The serif, for the single editorial role. */
export const EDITORIAL_FACE: FontFace = 'Newsreader_700Bold';
