import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { Inter_800ExtraBold } from '@expo-google-fonts/inter/800ExtraBold';
import { Newsreader_700Bold } from '@expo-google-fonts/newsreader/700Bold';

import type { FontFace } from './fonts';

/**
 * The font files, and the only module in the app that touches one.
 *
 * ── ⚠ Why this is not in `fonts.ts` next to the names ───────────────────────
 *
 * `theme/index.ts` imports the names, and five design-system guards in
 * `lib/__tests__` import the theme to check the shipped tokens against the
 * source. Those guards run under the web Jest project, which has no asset
 * transformer — so the moment a `.ttf` entered that import graph, all five died
 * with `SyntaxError: Unexpected token 'export'` before running an assertion.
 *
 * That is a real constraint rather than a test inconvenience: **the token layer
 * has to stay readable without a bundler.** Names are data and belong with the
 * tokens; files are assets and belong at the edge, imported by `App.tsx` alone.
 *
 * ── What keeps the two from drifting ────────────────────────────────────────
 *
 * The `Record<FontFace, number>` annotation. A face named in `FONT_FACES` and
 * missing here fails the typecheck, and one loaded here but never named fails
 * it too. Without that, a missing face has **no runtime symptom** — React
 * Native silently falls back to San Francisco, which looks like a design
 * decision rather than a bug.
 */
export const FONT_ASSETS: Record<FontFace, number> = {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
  Newsreader_700Bold,
};
