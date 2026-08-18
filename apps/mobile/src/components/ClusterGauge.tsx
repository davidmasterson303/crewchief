import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Text as SvgText } from 'react-native-svg';
import {
  CX,
  CY,
  R,
  TRACK,
  VIEW_H,
  VIEW_W,
  angleFor,
  pointAt,
} from '@crewchief/core/cluster-geometry';
import { getHealthBandJudgement, healthBandHex } from '@crewchief/core/health-band';

import { DIAL_MIN, TABULAR, surface, text, type } from '../theme';
import { useReducedMotion } from '../motion/reduced-motion';
import { interFace } from '../theme/fonts';

/**
 * The health score as an instrument cluster, on the phone.
 *
 * The web `ClusterGauge` argues the design at length and that argument is not
 * repeated here: a 270° tachometer face open at the bottom, ticks with the
 * numbers on the majors, one accent used as light rather than fill, and a
 * needle sweep at ignition. Read `components/ClusterGauge.tsx` for the why.
 *
 * What this file is responsible for is the three ways the phone is not a
 * browser.
 *
 * ── 1. The geometry is imported, not re-typed ───────────────────────────────
 *
 * `@crewchief/core/cluster-geometry` already exists for exactly this reason —
 * `BuildGauge` needed the same dial and a second copy of
 * `M 50.5 149.5 A 70 70 0 1 1 149.5 149.5` is a second copy. A third client
 * hand-copying it is the same mistake at worse odds, because the drift would be
 * invisible until someone held a phone next to a laptop.
 *
 * ── 2. `pathLength` does not exist on this renderer ─────────────────────────
 *
 * ⚠ The web dial normalises the arc with `pathLength={100}` so the dasharray is
 * literally the score — no circumference arithmetic and no chance of the fill
 * and the track describing different curves. **`react-native-svg` does not
 * implement `pathLength` on native.** It appears once in that package, in
 * `src/web/utils`, the react-native-web passthrough list — so on a device the
 * attribute is dropped silently and a dasharray of `61 100` paints 61 *user
 * units* of a 330-unit arc: every reading would land at about a fifth of its
 * true position, and it would look plausible.
 *
 * So the length is computed here, once, from the geometry the arc is actually
 * drawn with. `cluster-gauge.test.tsx` pins it against R.
 *
 * ── 3. Under `DIAL_MIN` this stops drawing a dial ───────────────────────────
 *
 * At row scale the ticks do not resolve and an instrument that cannot be read
 * is decoration. The `row` variant is not a smaller dial, it is a different
 * object: a tabular numeral and the verdict, both in the band colour.
 */

/**
 * The lit arc's length in user units — 270° at r=70.
 *
 * `2πR × 270/360`, which is `1.5πR`. The one piece of arithmetic the web
 * version got to skip.
 */
const ARC_LENGTH = 1.5 * Math.PI * R;

/** Majors carry the numbers; minors are every 5 and carry nothing. */
const MAJORS = [0, 20, 40, 60, 80, 100];
const BOUNDARIES = new Set([40, 60, 80]);
const MINORS = Array.from({ length: 21 }, (_, index) => index * 5).filter(
  (tick) => !MAJORS.includes(tick),
);

/** Tick radii. Minors are hairlines just off the arc; majors run out to the numbers. */
const TICK = {
  minorFrom: 76,
  minorTo: 79.5,
  majorFrom: 76,
  majorTo: 84,
  cardMajorTo: 80,
};

/** The ignition sweep: 0 → 100 → settle, ~900ms. Split as the web dial splits it. */
const SWEEP_UP = 420;
const SETTLE = 480;

/**
 * The ignition sweep, as a rendered reading.
 *
 * Driving the needle and the arc from one number keeps them on the same value
 * at every frame — they are one quantity drawn twice, not two animations that
 * happen to agree.
 *
 * `useNativeDriver` is false and cannot be true: the value drives an SVG
 * dasharray and a rotation *expressed in a transform string*, neither of which
 * the native driver can touch. A 900ms one-shot on a nine-element SVG is well
 * inside budget on the phones this app targets; a sweep on every scroll frame
 * would not be.
 */
function useIgnitionSweep(target: number, enabled: boolean): number {
  const reduced = useReducedMotion();
  /*
    Seeded with the target rather than 0. If every effect below were somehow
    skipped — a test that never flushes, a platform without Animated — this
    still reads correctly. The one state the instrument may never rest in is
    zero-beside-a-verdict.
  */
  const [reading, setReading] = useState(target);
  const driver = useRef(new Animated.Value(target)).current;

  useEffect(() => {
    if (reduced || !enabled) {
      driver.stopAnimation();
      driver.setValue(target);
      setReading(target);
      return;
    }

    const listener = driver.addListener(({ value }) => setReading(value));
    driver.setValue(0);

    const sweep = Animated.sequence([
      Animated.timing(driver, {
        toValue: 100,
        duration: SWEEP_UP,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.timing(driver, {
        toValue: target,
        duration: SETTLE,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
    ]);

    /*
      The end state is set from the callback rather than left to the last
      animation frame, and it runs whether or not the sweep finished. An
      interrupted sweep — a screen popped mid-flight, reduced motion switched on
      at frame 200 — lands on the reading instead of wherever it was cancelled.
    */
    sweep.start(() => setReading(target));

    return () => {
      sweep.stop();
      driver.removeListener(listener);
    };
  }, [target, enabled, reduced, driver]);

  return reading;
}

export type ClusterGaugeVariant = 'hero' | 'card' | 'row';

export default function ClusterGauge({
  score,
  variant = 'hero',
  size,
  active = true,
}: {
  score: number;
  /**
   * `hero` is the full dial — minors, numbered majors, needle, hub, and the
   * readout on its own line. `card` is the same instrument at the plinth's
   * scale, deliberately still. `row` is not a dial at all.
   */
  variant?: ClusterGaugeVariant;
  /** Rendered width in points. Defaults to the variant's design size. */
  size?: number;
  /** Hold the sweep until the caller's own reveal has finished. */
  active?: boolean;
}) {
  const band = getHealthBandJudgement(score);
  const colour = healthBandHex(band);
  const rounded = Math.round(score);

  const width = size ?? (variant === 'hero' ? HERO_SIZE : CARD_SIZE);

  /*
    The degrade is a floor, not a preference. A caller asking for a hero at 72pt
    gets the row scale, because at 72pt the minors are sub-pixel and six numbers
    are illegible — the same judgement `DIAL_MIN` is named for. Passing a small
    size is how this mistake will actually be made; refusing it in the type
    system would only move it to a magic number at the call site.
  */
  const resolved: ClusterGaugeVariant = variant === 'row' || width < DIAL_MIN ? 'row' : variant;

  const swept = useIgnitionSweep(score, active && resolved === 'hero');

  if (resolved === 'row') {
    return (
      <View
        accessibilityRole="image"
        accessibilityLabel={`Health score ${rounded} out of 100 — ${band.label}`}
        style={styles.row}
      >
        {/*
          30 and 12, both in the band colour. The numeral is the instrument
          here, so it carries the weight the dial would have; the verdict sits
          under it in the type scale's own label role rather than a shrunken
          copy of the hero's caption.
        */}
        <Text style={[styles.rowReading, { color: colour }]}>{rounded}</Text>
        <Text style={[styles.rowVerdict, { color: colour }]}>{band.short}</Text>
      </View>
    );
  }

  const isCard = resolved === 'card';

  /*
    Two viewBoxes, one geometry — the web dial's note applies unchanged. The
    hero crops to 178 tall because the 26 units below the arc are the readout's
    line; the card has no readout line, so it takes a square window centred on
    the pivot instead and its number sits in the well.
  */
  const viewBox = isCard ? `14 14 172 172` : `0 0 ${VIEW_W} ${VIEW_H}`;
  const height = isCard ? width : (width * VIEW_H) / VIEW_W;

  const value = isCard ? score : swept;
  const clamped = Math.max(0, Math.min(100, value));
  const lit = (clamped / 100) * ARC_LENGTH;

  /*
    ── The readout is real text on top of the SVG, not `<SvgText>` ────────────

    ⚠ `react-native-svg`'s `fontVariant` is the **SVG** property — `normal` or
    `small-caps`. It has no tabular-numerals setting of any kind, so a number
    drawn inside the SVG gets proportional figures.

    That is fine for the tick numbers, which never change. It is not fine for
    the readout: the sweep animates it through every value from 0 to 100 and
    back down, and with proportional figures a 1 is about half the width of a 7
    — the number visibly jitters sideways for the whole 900ms. `TABULAR` exists
    in the theme for exactly this and only React Native's own `Text` honours it.

    So the readout is positioned over the dial instead. The arithmetic is the
    viewBox mapping, stated once: the hero's readout line is y=150 of a 200-wide
    box drawn at `width`, and the card's number sits on the pivot, which its
    square window puts at dead centre.
  */
  const readoutSize = Math.round(width * (isCard ? 60 / 172 : 30 / 200));
  const readoutLine = Math.round(readoutSize * 1.1);
  const readoutTop = (isCard ? 0.5 : 0.75) * width - readoutLine / 2;

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={`Health score ${rounded} out of 100 — ${band.label}`}
      style={styles.dial}
    >
      <View style={{ width, height }}>
        <Svg viewBox={viewBox} width={width} height={height}>
          {/*
          The unlit face. On the card it takes a wash of the band rather than
          plain white, because at that size the ring is most of what is seen and
          a neutral track reads as a broken instrument rather than a quiet one.
        */}
          <Path
            d={TRACK}
            fill="none"
            stroke={isCard ? colour : text.nonText}
            strokeOpacity={isCard ? 0.1 : 0.2}
            strokeWidth={6}
            strokeLinecap="butt"
          />

          {/*
          The reading.

          Butt caps, not round — a round cap adds half a stroke width of arc at
          each end, so a score of 0 still paints a visible stub and every
          reading sits about 2% long. On a dial with ticks that error is
          legible, and it is the defect the web gauge's caps were changed for.
        */}
          <Path
            d={TRACK}
            fill="none"
            stroke={colour}
            strokeWidth={6}
            strokeLinecap="butt"
            strokeDasharray={[lit, ARC_LENGTH]}
          />

          {/* Minors — hairlines, every 5, hero only. */}
          {!isCard &&
            MINORS.map((tick) => (
              <Line
                key={`minor-${tick}`}
                x1={CX}
                y1={CY - TICK.minorTo}
                x2={CX}
                y2={CY - TICK.minorFrom}
                stroke={text.nonText}
                strokeOpacity={0.35}
                strokeWidth={1}
                origin={`${CX}, ${CY}`}
                rotation={angleFor(tick)}
              />
            ))}

          {/*
          Majors. On the card only the three band boundaries survive.

          A boundary tick lands at 0.4 here against web's 0.5, because
          `text.nonText` is the hairline token and 40% is where it caps. The
          step is one notch on a 1px rule and the weight difference — 2 against
          1.5 — is doing the work either way.
        */}
          {(isCard ? [40, 60, 80] : MAJORS).map((tick) => (
            <Line
              key={`major-${tick}`}
              x1={CX}
              y1={CY - (isCard ? TICK.cardMajorTo : TICK.majorTo)}
              x2={CX}
              y2={CY - TICK.majorFrom}
              stroke={text.nonText}
              strokeOpacity={BOUNDARIES.has(tick) ? 1 : 0.65}
              strokeWidth={BOUNDARIES.has(tick) ? 2 : 1.5}
              origin={`${CX}, ${CY}`}
              rotation={angleFor(tick)}
            />
          ))}

          {/*
          The numbers, on the majors. Upright — never rotated with their tick.

          ⚠ **These sit at the 50% floor, and the web dial's do not.** Web
          grades them 0.42 for a boundary against 0.24 for the rest; both are
          under this app's text floor, and the floor does not have a decorative
          exemption — the moment one is granted, "it's only a label" is
          available to every string on the phone.

          Nothing is lost. The emphasis that grading carried is already in the
          tick beneath each number, which is drawn at twice the width on a band
          boundary. The hierarchy moved from the ink to the hairline, where it
          costs no legibility.
        */}
          {!isCard &&
            MAJORS.map((tick) => {
              const at = pointAt(tick, 90);
              return (
                <SvgText
                  key={`label-${tick}`}
                  x={at.x}
                  y={at.y}
                  fill={text.muted}
                  fontSize={10}
                  fontFamily={interFace('500')} fontWeight="500"
                  textAnchor="middle"
                  alignmentBaseline="central"
                >
                  {tick}
                </SvgText>
              );
            })}

          {/*
          Needle. The hero runs it to the pivot and caps it with a hub; the card
          stops it short, because a hub and a centred numeral collide at any
          size — the needle would cross the digits.
        */}
          <G origin={`${CX}, ${CY}`} rotation={angleFor(clamped)}>
            <Line
              x1={CX}
              y1={42}
              x2={CX}
              y2={isCard ? 62 : CY}
              stroke={colour}
              strokeWidth={isCard ? 3 : 2.5}
              strokeLinecap={isCard ? 'round' : 'butt'}
            />
          </G>
          {!isCard && (
            <Circle cx={CX} cy={CY} r={5} fill={surface.page} stroke={colour} strokeWidth={1.5} />
          )}
        </Svg>

        {/*
          The readout. On the hero it sits on the line the 178-tall viewBox
          exists to make, below the hub and between the 0 and 100 labels —
          exactly where a tachometer puts its digital readout. Centring it in
          the well is not available once there is a hub: the needle would cross
          the digits.

          No "/100". No instrument prints its own denominator when the scale is
          drawn around it and both ends are numbered; the full reading is on the
          container's accessibility label, where the dial cannot be seen.

          `pointerEvents` none so the number never intercepts a press meant for
          whatever the dial is sitting on.
        */}
        <Text
          pointerEvents="none"
          style={[
            styles.readout,
            {
              top: readoutTop,
              fontSize: readoutSize,
              lineHeight: readoutLine,
              color: isCard ? text.primary : colour,
            },
          ]}
        >
          {Math.round(value)}
        </Text>
      </View>

      {/*
        The verdict, in real text rather than in the SVG — it is language, and
        it should scale with the platform's type settings like every other
        string on the screen.

        `short` on the card: "Needs attention" does not fit under a 104pt dial.
        Same band, abbreviated; never a different judgement.
      */}
      <Text
        style={[
          styles.verdict,
          {
            color: colour,
            fontSize: isCard ? type.label.fontSize : Math.round(width * 0.07),
          },
        ]}
      >
        {isCard ? band.short : band.label}
      </Text>
    </View>
  );
}

/**
 * The design sizes, from the baseline board.
 *
 * Hero is one per screen and lives in the garage bay. Card is the plinth on
 * vehicle detail. Anything under `DIAL_MIN` is a row and has no dial at all.
 */
export const HERO_SIZE = 184;
export const CARD_SIZE = 104;

const styles = StyleSheet.create({
  dial: { alignItems: 'center', flexShrink: 0 },
  readout: {
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
    fontFamily: interFace('700'), fontWeight: '700',
    ...TABULAR,
  },
  verdict: { fontFamily: interFace('600'), fontWeight: '600', letterSpacing: 0.2 },
  row: { alignItems: 'flex-end' },
  /**
   * 30, off the type scale on purpose. The scale names roles for language —
   * 12 labels a value, 13 is a value, 14 is UI, 16/18 are body — and an
   * instrument reading is none of those. It is the dial, at the size the dial
   * is not available.
   */
  rowReading: { fontSize: 30, lineHeight: 34, fontFamily: interFace('700'), fontWeight: '700', ...TABULAR },
  rowVerdict: { ...type.label },
});
