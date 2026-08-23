import { SafeAreaProvider, type Metrics } from 'react-native-safe-area-context';

/**
 * A screen under a safe-area provider, at a window size the test chose.
 *
 * ── Why this exists rather than a mock ──────────────────────────────────────
 *
 * `useSafeAreaInsets` throws without a provider — "No safe area value
 * available" — so any screen that reads the notch needs one in a test.
 * `App.tsx` wraps the whole app in one, so production was never at risk; only
 * the harness was.
 *
 * The provider is used **for real**, with metrics supplied, rather than the
 * hook being mocked. That is not fussiness: the vehicle screen's whole layering
 * argument is arithmetic on `insets.top` and the window height, and the
 * regression it guards against only appears at particular sizes. A mocked hook
 * returning a fixed zero would make every one of those assertions pass while
 * measuring the one geometry the design does not have to survive.
 *
 * ── The two window heights that matter ──────────────────────────────────────
 *
 * 667 is the shortest supported display — the 4.7″, the one that takes the
 * hero's compact branch — and 932 is the tallest. The design has to hold at
 * both, and `heroBands` switches between them, so a test that only ran at one
 * would be testing one of two layouts.
 */

/** The 4.7″ display. Takes the compact branch; no notch, so a 20pt status bar. */
export const SHORTEST: Metrics = {
  frame: { x: 0, y: 0, width: 375, height: 667 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

/** The tallest supported display. Notched, so a 59pt top inset. */
export const TALLEST: Metrics = {
  frame: { x: 0, y: 0, width: 430, height: 932 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

/** The device the design is composed for. */
export const REFERENCE: Metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

export function withSafeArea(node: React.ReactNode, metrics: Metrics = REFERENCE) {
  return <SafeAreaProvider initialMetrics={metrics}>{node}</SafeAreaProvider>;
}
