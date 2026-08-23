import { StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';

import { bay, hero } from '../theme';

/**
 * What the vehicle hero's photograph sits under, and what stands in for it.
 *
 * ── Two layers, and they are not the same thing ─────────────────────────────
 *
 * **The dim** is the bay light going down as the floor comes up. It is a flat
 * `#08090B` whose opacity is driven by scroll, and the reading is deliberate —
 * `tokens/environment.css` makes the same argument for `--bay-led`: *the car
 * goes into shadow*, rather than a UI layer fading in over it. So it is not
 * chrome arriving; it is the room being switched off.
 *
 * **The bed** is fixed and never animates. It is the contrast floor the name
 * and mileage sit on, and its bottom stop is `rgb(8 9 11 / 0.95)` — which is
 * the value `contrast.test.tsx` should sample against rather than the
 * photograph, per §5 of the handoff. The two-stop pair at the top is what stops
 * the floating back and settings pills dissolving into a bright sky.
 *
 * ⚠ This is the mechanism that makes text over a photograph legal here at all.
 * `DiagnosticHero` on web established the rule that nothing is printed over a
 * photograph, after measuring ~1.7% passthrough through six compositing layers.
 * The rule was never "no type on photographs" — it was "no type whose contrast
 * depends on the photograph". A guaranteed floor is the other way to satisfy
 * it, and it is the way this design chose.
 *
 * ── Why SVG and not `expo-linear-gradient` ──────────────────────────────────
 *
 * The handoff offers either. `react-native-svg` is already in the binary —
 * `BayRoom`, `ClusterGauge` and `Icon` all use it — and `expo-linear-gradient`
 * is a native module, so adopting it would cost an EAS build out of a monthly
 * allowance of about fifteen. Same picture, no build.
 */

/** The bed's darkest stop. Exported because the contrast harness samples it. */
export const HERO_BED_FLOOR = hero.shadow;
export const HERO_BED_FLOOR_ALPHA = 0.95;

/**
 * The fixed contrast bed.
 *
 * Bottom-up: opaque at the floor, gone by 52% — so it bites under the identity
 * block and leaves the car's middle alone. Plus a shorter wash from the top for
 * the nav pills.
 */
export function HeroBed() {
  return (
    <Svg
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Defs>
        <LinearGradient id="heroBedUp" x1="0" y1="1" x2="0" y2="0">
          <Stop offset="0" stopColor={HERO_BED_FLOOR} stopOpacity={HERO_BED_FLOOR_ALPHA} />
          <Stop offset="0.22" stopColor={HERO_BED_FLOOR} stopOpacity={0.55} />
          <Stop offset="0.52" stopColor={HERO_BED_FLOOR} stopOpacity={0} />
        </LinearGradient>
        <LinearGradient id="heroBedDown" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={HERO_BED_FLOOR} stopOpacity={0.78} />
          <Stop offset="0.2" stopColor={HERO_BED_FLOOR} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#heroBedUp)" />
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#heroBedDown)" />
    </Svg>
  );
}

/**
 * The hero with no photograph — a designed state, not a gap.
 *
 * `.ph-empty`'s radial, the same one the garage bay's room uses:
 * `radial-gradient(130% 110% at 50% 18%, #2a2724, #111214 72%)`. **Never a grey
 * box and never a broken-image glyph** — a garage carries unphotographed
 * vehicles for weeks, and this is what most owners see for their first fortnight.
 *
 * ⚠ The ellipse ratio is restored with `gradientTransform` because SVG radials
 * take one radius, exactly as `BayRoom` does. Scaling the `Rect` instead would
 * scale whatever is drawn on top of it.
 */
export function HeroEmpty() {
  return (
    <Svg
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Defs>
        <RadialGradient
          id="heroEmpty"
          cx="0.5"
          cy="0.18"
          r="0.62"
          gradientTransform="translate(0.5 0.18) scale(2.1 1.78) translate(-0.5 -0.18)"
        >
          <Stop offset="0" stopColor={bay.roomNear} />
          <Stop offset="0.72" stopColor={bay.roomFar} />
          <Stop offset="1" stopColor={bay.roomFar} />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#heroEmpty)" />
    </Svg>
  );
}
