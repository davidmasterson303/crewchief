import Svg, { Path } from 'react-native-svg';

import { text } from '../theme';

/**
 * The disclosure chevron, drawn rather than imported.
 *
 * ── Why there is no icon package ────────────────────────────────────────────
 *
 * The design system's rule is *"real Lucide icons only · no emoji, no glyph
 * stand-ins"*, and this is that rule kept without adding a dependency to a
 * build budget that allows about fifteen iOS builds a month. `lucide-react-native`
 * is a JS package and would technically be free, but it is a whole icon set for
 * one 6×12 mark, and `react-native-svg` is already in the binary.
 *
 * ⚠ **The path is Lucide's own `chevron-right`, `m9 18 6-6-6-6`, unmodified.**
 * That matters more than it sounds: the point of the rule is that every mark in
 * the product comes from one geometry, and a hand-drawn chevron at a slightly
 * different angle is exactly the drift nobody can name but everybody can see.
 * When a second icon is needed, this file becomes `Icon.tsx` with a path map —
 * it is not a special case, it is the first entry.
 *
 * ── It is never the affordance on its own ───────────────────────────────────
 *
 * `NavRow` puts the whole row in the accessibility tree as one button and hides
 * this from it. A chevron announced beside a row is a second thing to move
 * past for no information — the row already said it was a button.
 */
export default function Chevron({
  size = 16,
  color = text.muted,
}: {
  size?: number;
  color?: string;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="m9 18 6-6-6-6"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
