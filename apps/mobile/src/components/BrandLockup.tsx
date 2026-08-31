import { View } from 'react-native';
import Svg, { Circle, Defs, FeGaussianBlur, Filter, G, Path, Text as SvgText } from 'react-native-svg';

import {
  BRAND_COLOR,
  BRAND_NAME,
  BRAND_TYPE,
  PLATE,
  RIVETS,
  lockupFor,
} from '@wellkept/core/brand';

/**
 * The Well Kept lockup, native cut.
 *
 * ── The same numbers as the web, imported rather than copied ────────────────
 *
 * Every value comes from `@wellkept/core/brand`, which `brand.test.ts` pins
 * against Design's own SVG files. The mark this app draws and the mark the web
 * draws cannot differ, which is the failure the old dial had — its path data
 * lived in two `Logo.tsx` files kept in step by eye.
 *
 * ── ⚠ Newsreader 500, and it had to be added ───────────────────────────────
 *
 * Design sets the engraved name at Newsreader **500**; this app bundled 700
 * alone. Rendering it a weight heavier is exactly the class of defect
 * `mobile-font-faces` exists for — React Native does not synthesise weights, it
 * silently substitutes, and the result reads as a design decision. The face is
 * loaded now, and it cost nothing: `@expo-google-fonts/newsreader` was already
 * a dependency, so it is JS rather than an EAS build.
 *
 * ⚠ `fontFamily` is the **face name**, never a weight prop. That is this
 * codebase's most expensive silent defect — `fontWeight: '600'` without a
 * family renders San Francisco, and half-applied it looks intentional.
 *
 * ── What is deliberately not here ───────────────────────────────────────────
 *
 * `font-variant: small-caps` has no react-native-svg equivalent, so the name is
 * set in capitals with Design's tracking rather than faked with two font sizes.
 * ⚠ That is a real, visible departure from the web's rendering of the same
 * mark, and it is logged in `docs/design-system-drift.md` rather than left for
 * somebody to notice — the alternative, drawing large and small capitals by
 * hand, is the "redraw or approximate" this project forbids for glyphs.
 */
export default function BrandLockup({
  width = 200,
  variant,
  ground = 'dark',
}: {
  width?: number;
  /** Omit and the width picks the drawing, which is the safer default. */
  variant?: 'full' | 'short' | 'icon';
  ground?: 'dark' | 'light';
}) {
  const chosen = variant ?? lockupFor(width);
  const light = ground === 'light';

  const edge = light ? BRAND_COLOR.light.edge : BRAND_COLOR.edge;
  const ink = light ? BRAND_COLOR.light.name : BRAND_COLOR.name;

  if (chosen === 'icon') {
    const plate = PLATE.icon;
    return (
      <View accessibilityRole="image" accessibilityLabel={BRAND_NAME}>
        <Svg width={width} height={width} viewBox={`0 0 ${plate.width} ${plate.height}`}>
          <Path
            d={plate.path}
            fill={light ? 'none' : BRAND_COLOR.plate}
            stroke={edge}
            strokeWidth={light ? 3 : 2}
          />
          <SvgText
            x={plate.width / 2}
            y={70}
            textAnchor="middle"
            fontFamily="Newsreader_500Medium"
            fontSize={44}
            fill={ink}
          >
            WK
          </SvgText>
        </Svg>
      </View>
    );
  }

  const plate = chosen === 'full' ? PLATE.full : PLATE.short;
  const rivets = chosen === 'full' ? RIVETS.full : RIVETS.short;
  const height = Math.round((width * plate.height) / plate.width);

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={chosen === 'full' ? `${BRAND_NAME} by Southmoor Digital` : BRAND_NAME}
    >
      <Svg width={width} height={height} viewBox={`0 0 ${plate.width} ${plate.height}`}>
        {/*
          The backlight. Absent on a light ground because a glow needs something
          darker than itself to read against — Design's sanctioned substitution
          is a hollow plate with a cyan-700 edge, not a dimmer glow.
        */}
        {!light && (
          <>
            <Defs>
              <Filter id="wkGlow" x="-30%" y="-30%" width="160%" height="160%">
                <FeGaussianBlur stdDeviation="10" />
              </Filter>
            </Defs>
            <G filter="url(#wkGlow)" opacity={0.55}>
              <Path d={plate.path} fill={BRAND_COLOR.glow} />
            </G>
          </>
        )}

        <Path
          d={plate.path}
          fill={light ? 'none' : BRAND_COLOR.plate}
          stroke={edge}
          strokeWidth={light ? 3 : 2}
        />

        <G fill={light ? BRAND_COLOR.light.quiet : BRAND_COLOR.rivet}>
          {rivets.map((rivet) => (
            <Circle key={`${rivet.x}-${rivet.y}`} cx={rivet.x} cy={rivet.y} r={RIVETS.radius} />
          ))}
        </G>

        <SvgText
          x={plate.width / 2}
          y={BRAND_TYPE.name.baseline[chosen]}
          textAnchor="middle"
          fontFamily="Newsreader_500Medium"
          fontSize={BRAND_TYPE.name.size}
          letterSpacing={BRAND_TYPE.name.tracking}
          fill={ink}
        >
          {BRAND_NAME.toUpperCase()}
        </SvgText>

        {chosen === 'full' && (
          <SvgText
            x={plate.width / 2}
            y={BRAND_TYPE.maker.baseline}
            textAnchor="middle"
            fontFamily="Inter_600SemiBold"
            fontSize={BRAND_TYPE.maker.size}
            letterSpacing={BRAND_TYPE.maker.tracking}
            fill={light ? BRAND_COLOR.light.quiet : BRAND_COLOR.quiet}
          >
            {BRAND_TYPE.maker.text}
          </SvgText>
        )}
      </Svg>
    </View>
  );
}
