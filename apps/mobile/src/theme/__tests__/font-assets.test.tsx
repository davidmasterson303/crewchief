import { FONT_ASSETS } from '../font-assets';
import { FONT_FACES } from '../fonts';

/**
 * The names resolve to real files.
 *
 * ── Why this is here and not with the other font guard ──────────────────────
 *
 * `lib/__tests__/mobile-font-faces.test.ts` scans source and checks that every
 * weight names a face. It cannot check that a face *loads*: it runs under the
 * web Jest project, which has no asset transformer, and importing a `.ttf`
 * there fails with `SyntaxError: Unexpected token 'export'` before any
 * assertion runs. That is exactly what happened when the font files were first
 * pulled into the theme — it took five design-system guards down with it.
 *
 * So the split is by capability rather than by preference: names are checked
 * where the source is, files are checked where a bundler exists.
 *
 * ⚠ The defect being guarded has **no runtime symptom**. A face named in a
 * style but never loaded does not throw — React Native falls back to San
 * Francisco silently, which reads as a design decision rather than a bug.
 */

describe('every named face is a file the bundle actually carries', () => {
  it('loads one asset per name, with nothing left over', () => {
    // The `Record<FontFace, number>` annotation makes a missing face a compile
    // error; this catches the same thing at runtime, where the asset registry
    // is real rather than a type.
    expect(Object.keys(FONT_ASSETS).sort()).toEqual([...FONT_FACES].sort());
  });

  it('resolves each one to an asset rather than to undefined', () => {
    /*
      Metro turns `require('./Inter_400Regular.ttf')` into a numeric asset id.
      A face that failed to resolve arrives as `undefined`, `useFonts` skips it
      without complaint, and the app renders that weight in the system face —
      the silent fallback this file exists to make loud.
    */
    const unresolved = Object.entries(FONT_ASSETS)
      .filter(([, asset]) => asset === undefined || asset === null)
      .map(([face]) => face);

    // Collected rather than asserted one at a time, so a failure names every
    // broken face instead of stopping at the first.
    expect(unresolved).toEqual([]);
  });
});
