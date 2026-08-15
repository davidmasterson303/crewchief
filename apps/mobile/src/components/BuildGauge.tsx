import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { CX, CY, R, TRACK, VIEW_H, VIEW_W, pointAt } from '@crewchief/core/cluster-geometry';
import {
  REDLINE_FROM,
  buildRampFor,
  isRedlined,
  type BuildPosition,
} from '@crewchief/core/build-progress';

import { DIAL_MIN, build, surface, text, type } from '../theme';
import { useReducedMotion } from '../motion/reduced-motion';

/**
 * How far this build has come, on the cluster dial — on the phone.
 *
 * ── Why this is a sibling of `ClusterGauge` and not a variant of it ─────────
 *
 * The same argument the web pair makes, and it survives the port unchanged.
 * The health gauge is hardwired to health semantics, correctly: it bands the
 * score, announces "Health score 61 out of 100 — Fair", and paints low readings
 * red. **On a build dial a low reading is not bad, it is stock.** Reusing the
 * health gauge would render an unmodified car as a critical failure and
 * announce it to a screen reader as one.
 *
 * So the geometry is shared through `@crewchief/core/cluster-geometry`, the
 * region is shared through `@crewchief/core/build-progress`, and the *meaning*
 * is not shared with health at all. Two gauges in one cluster, one set of
 * numbers describing the glass.
 *
 * ── The needle never reaches the end, and that is the argument ──────────────
 *
 * `buildPosition` maps accumulated effort through an asymptote, so no amount of
 * work pegs the dial. A progress bar that fills says "you are finished"; this
 * says "there is always something more you can do", which is the thing David
 * asked the product to express. It is made in glass rather than in copy.
 *
 * ── Two things the phone changes ────────────────────────────────────────────
 *
 * **`pathLength` is not implemented by `react-native-svg` on native**, so the
 * arc length is computed rather than normalised — the note in `ClusterGauge`
 * has the detail, and both files take the length from the same expression.
 *
 * **The web dial animates with a CSS transition**, which fires on a change and
 * not on mount. `Animated` has no such distinction, so the mount case is
 * excluded explicitly below: the build dial is still when it appears and moves
 * only when the car does.
 */

/** 270° at r=70, in user units. `pathLength` cannot do this here. */
const ARC_LENGTH = 1.5 * Math.PI * R;

/** The redline's share of the arc, and where it starts. Both from `REDLINE_FROM`. */
const REDLINE_LENGTH = ((100 - REDLINE_FROM) / 100) * ARC_LENGTH;
const REDLINE_OFFSET = -(REDLINE_FROM / 100) * ARC_LENGTH;

/** Matches the web dial's `transition: ... 900ms ease-out`. */
const TRANSITION = 900;

/** The token for each region. The region itself is core's judgement, not this file's. */
const RAMP = {
  stock: build.stock,
  mild: build.mild,
  warm: build.warm,
  far: build.far,
} as const;

/**
 * The needle's position, eased toward a changed reading.
 *
 * Deliberately **not** an ignition sweep. The health dial sweeps 0 → 100 →
 * settle because that is how a cluster says the instrument is live and what its
 * range is; this dial has no numbered range to demonstrate and a car that swept
 * to "Built" and fell back to "Stock" every time the screen appeared would be
 * lying twice a second.
 */
function useEasedNeedle(target: number): number {
  const reduced = useReducedMotion();
  const [reading, setReading] = useState(target);
  const driver = useRef(new Animated.Value(target)).current;
  /*
    The mount guard. A CSS transition does not run on first paint — the element
    simply appears at its value — and `Animated` has no equivalent notion, so
    without this the dial would ease up from zero every time the screen mounted.
  */
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      driver.setValue(target);
      setReading(target);
      return;
    }

    if (reduced) {
      driver.stopAnimation();
      driver.setValue(target);
      setReading(target);
      return;
    }

    const listener = driver.addListener(({ value }) => setReading(value));
    const move = Animated.timing(driver, {
      toValue: target,
      duration: TRANSITION,
      easing: Easing.out(Easing.cubic),
      // Drives a dasharray and a line's endpoints — neither reaches the native
      // driver. See the same note on the health dial.
      useNativeDriver: false,
    });

    // Lands on the reading whether or not it finished, so an interrupted move
    // never leaves the needle parked between two values.
    move.start(() => setReading(target));

    return () => {
      move.stop();
      driver.removeListener(listener);
    };
  }, [target, reduced, driver]);

  return reading;
}

export default function BuildGauge({
  position,
  size = BUILD_SIZE,
}: {
  position: BuildPosition;
  /** Rendered width in points. Under `DIAL_MIN` this degrades to the row scale. */
  size?: number;
}) {
  const { needle, label, points } = position;
  const eased = useEasedNeedle(needle);

  /*
    Colour from the *target*, never the eased value. The face must not cycle
    steel → amber → steel on its way to a reading, for the same reason the
    health dial bands from the target rather than the swept number.
  */
  const colour = RAMP[buildRampFor(needle)];

  /*
    The needle joins the redline once it enters it — v8 §4c.

    Only the needle, never the lit arc. The arc is the *history* of the build and
    none of it happened in the red; the needle is where the car is now. A
    tachometer colours the pointer, not the sweep behind it.

    Still not a failure: the accessible name stays "Build progress — {label}"
    and never a score, so nothing here announces a modified car as a fault.
  */
  const needleColour = isRedlined(needle) ? build.redline : colour;

  /*
    Under the floor this stops being a dial, exactly as the health gauge does.
    There is no numeral to fall back on here — `points` is an internal unit and
    showing it would invite the reader to treat it as a score out of something,
    which is the end state this dial exists to avoid. So the row scale is the
    word alone, in the ramp colour.
  */
  if (size < DIAL_MIN) {
    return (
      <View accessibilityRole="image" accessibilityLabel={`Build progress — ${label}`}>
        <Text style={[styles.rowLabel, { color: needleColour }]}>{label}</Text>
      </View>
    );
  }

  const tip = pointAt(eased, R - 12);
  const lit = (Math.max(0, Math.min(100, eased)) / 100) * ARC_LENGTH;

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={`Build progress — ${label}`}
      style={styles.dial}
    >
      <Svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} width={size} height={(size * VIEW_H) / VIEW_W}>
        {/* Track. */}
        <Path
          d={TRACK}
          fill="none"
          stroke={text.nonText}
          strokeOpacity={0.2}
          strokeWidth={6}
          strokeLinecap="butt"
        />

        {/*
          The redline. v8 §4c.

          Painted on the **unlit** face from 82 to 100, so it is there at a
          reading of zero — visible at idle, visible with the car switched off,
          exactly as a tachometer's is painted at the factory.

          This is the one place red does not mean fault. `build.redline` is
          deliberately hotter and more orange-shifted than `status.critical` —
          a redline that matched the alert red would be read as an alert. **Do
          not harmonise them.**
        */}
        <Path
          d={TRACK}
          fill="none"
          stroke={build.redline}
          // 0.22 — web's `--build-redline-track` is `--build-redline` at that
          // alpha, and the phone must not paint a hotter or cooler zone.
          strokeOpacity={0.22}
          strokeWidth={6}
          strokeLinecap="butt"
          strokeDasharray={[REDLINE_LENGTH, ARC_LENGTH]}
          strokeDashoffset={REDLINE_OFFSET}
        />

        {/* The reading. */}
        <Path
          d={TRACK}
          fill="none"
          stroke={colour}
          strokeWidth={6}
          strokeLinecap="butt"
          strokeDasharray={[lit, ARC_LENGTH]}
        />

        {/*
          Minor ticks every 10. Fewer than the health dial's every 5: this
          reading has no numbered majors to align to, so a denser scale would
          imply a precision the points do not have.
        */}
        {Array.from({ length: 11 }, (_, index) => index * 10).map((reading) => {
          const outer = pointAt(reading, R + 9);
          const inner = pointAt(reading, R + 5);
          return (
            <Line
              key={reading}
              x1={outer.x}
              y1={outer.y}
              x2={inner.x}
              y2={inner.y}
              stroke={text.nonText}
              strokeOpacity={0.55}
              strokeWidth={1}
            />
          );
        })}

        {/* Needle and hub. */}
        <Line
          x1={CX}
          y1={CY}
          x2={tip.x}
          y2={tip.y}
          stroke={needleColour}
          strokeWidth={2.5}
          /*
            `butt`, not `round`. A round cap adds half a stroke width past the
            tip, which on a dial with ticks reads as the needle sitting a little
            past where it points — the same error the health gauge's arc caps
            were changed for.
          */
          strokeLinecap="butt"
        />
        <Circle cx={CX} cy={CY} r={5} fill={surface.page} stroke={needleColour} strokeWidth={2} />
      </Svg>

      {/*
        The word, not the number. `points` is an internal unit and showing it
        would invite the reader to treat it as a score out of something — which
        is exactly the end state this dial exists to avoid. It stays on the
        accessibility hint for anyone who wants it, as the web version keeps it
        in a `title`.
      */}
      <Text style={styles.caption} accessibilityHint={`${points} points`}>
        {label}
      </Text>
    </View>
  );
}

/**
 * The design size, from the baseline board: **150pt, with the redline.**
 *
 * Smaller than the health hero at 184 on purpose — one dial per screen is the
 * hero, and on vehicle detail that is health. This is the second instrument and
 * reads as one.
 */
export const BUILD_SIZE = 150;

const styles = StyleSheet.create({
  dial: { alignItems: 'center', flexShrink: 0, gap: 4 },
  caption: { ...type.uiStrong, color: text.primary },
  /** The row scale's only mark. A word, so no tabular figures — there are none. */
  rowLabel: { ...type.uiStrong },
});
