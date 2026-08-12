/**
 * The CrewChief mark — "Sweep" — and its two lockups, native cut.
 *
 * This is the only place the mark's path data exists in `apps/mobile`;
 * the web twin is `components/brand/Logo.tsx` at the repo root. Placements
 * render <Logo/>; nothing loads an image asset.
 *
 * The one behaviour that must never be left to call sites: **the cut switch
 * at 24px.** Below 24 the redline and the hub-to-arc relationship turn to
 * mush, so the mark swaps to a heavier, redline-free drawing with the same
 * silhouette. The switch is mechanical on `size`.
 *
 * Colours come from `../theme/tokens.json`, the first tokens file this app
 * has had — the screens hand-roll their palette, and the logo is not adding
 * to that. Butt caps are load-bearing: a round cap paints a stub at zero and
 * runs every reading ~2% long. The redline (#FF4436) is heat, not an alert —
 * deliberately hotter than the critical red; do not unify them.
 *
 * The lockup name is set in the system face at 700 — the whole app currently
 * sets its UI in the system face, so the lockup follows it. The brand face is
 * Inter; revisit if the app ever loads it.
 */
import { Text, View } from 'react-native';
import Svg, { Circle, G, Path } from 'react-native-svg';

import tokens from '../theme/tokens.json';

export type LogoVariant = 'mark' | 'horizontal' | 'stacked';

export interface LogoProps {
  variant?: LogoVariant;
  /** Mark height in px. Drives the 24px cut switch and lockup proportions. */
  size?: number;
  /** Mark colour. Defaults to the brand accent. */
  color?: string;
  /** Name colour in the lockups. One-colour treatments pass `color`'s value. */
  nameColor?: string;
  /** One-colour treatments: drop the redline. */
  mono?: boolean;
}

/* Lockup proportions, from the spec's masters: horizontal 46/16/32, stacked 60/9.6/24. */
const H_GAP = 16 / 46;
const H_NAME = 32 / 46;
const S_GAP = 9.6 / 60;
const S_NAME = 24 / 60;

function Mark({ size, color, mono }: { size: number; color: string; mono: boolean }) {
  const small = size < 24;
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      {small ? (
        <>
          <G fill="none" stroke={color} strokeLinecap="butt">
            <Path d="M50 84 A34 34 0 1 1 84 50" strokeWidth={14} />
            <Path d="M50 50 L55.9 21.5" strokeWidth={12} />
          </G>
          <Circle cx={50} cy={50} r={7} fill={color} />
        </>
      ) : (
        <>
          <G fill="none" strokeLinecap="butt">
            <Path d="M50 85 A35 35 0 1 1 85 50" stroke={color} strokeWidth={10} />
            {!mono && (
              <Path d="M74.75 25.25 A35 35 0 0 1 85 50" stroke={tokens.buildRedline} strokeWidth={10} />
            )}
            <Path d="M50 50 L55.21 20.45" stroke={color} strokeWidth={8} />
          </G>
          <Circle cx={50} cy={50} r={5.5} fill={color} />
        </>
      )}
    </Svg>
  );
}

export function Logo({
  variant = 'mark',
  size = 24,
  color = tokens.brandAccent,
  nameColor = tokens.textPrimary,
  mono = false,
}: LogoProps) {
  if (variant === 'mark') {
    return (
      <View accessibilityRole="image" accessibilityLabel="CrewChief">
        <Mark size={size} color={color} mono={mono} />
      </View>
    );
  }

  const horizontal = variant === 'horizontal';
  const gap = size * (horizontal ? H_GAP : S_GAP);
  const nameSize = size * (horizontal ? H_NAME : S_NAME);

  /* The name is real text beside the mark, so a screen reader says
     "CrewChief" once, as a word. One word, mixed case — never "Crew Chief",
     never all-caps, never a colour split across the two C's. */
  return (
    <View
      style={{
        flexDirection: horizontal ? 'row' : 'column',
        alignItems: 'center',
        gap,
      }}
    >
      <Mark size={size} color={color} mono={mono} />
      <Text
        style={{
          fontSize: nameSize,
          fontWeight: '700',
          letterSpacing: nameSize * (horizontal ? -0.035 : -0.03),
          lineHeight: nameSize,
          color: nameColor,
        }}
      >
        CrewChief
      </Text>
    </View>
  );
}

export default Logo;
