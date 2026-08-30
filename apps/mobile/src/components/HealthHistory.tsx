import { useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Polygon, Polyline, Stop } from 'react-native-svg';
import { getHealthBandJudgement, healthBandHex } from '@wellkept/core/health-band';

import { TABULAR, space, text, type } from '../theme';

/**
 * The score over time — the fourth instrument.
 *
 * ── ⚠ The web chart's ramp is not the product's ramp ────────────────────────
 *
 * `components/HealthHistoryChart.tsx` picks its line colour from four hexes
 * written into the component: `#4ade80`, `#22d3ee`, `#fb923c`, `#f87171` at 80
 * / 60 / 40. The thresholds happen to match `@wellkept/core/health-band`; **the
 * colours do not.** The band's own are `127,206,156`, `95,174,192`,
 * `224,164,104`, `224,136,130`.
 *
 * So a web user reading 71 sees a cyan trend line beside a `ClusterGauge` in
 * the band's muted teal, and the two instruments disagree about what "Fair"
 * looks like on one screen. That is precisely the failure `health-band.ts` was
 * extracted to end, and it survived because the chart predates the extraction.
 *
 * **This file bands from core.** Porting the literals would have copied a
 * defect onto a second client and made it twice as expensive to fix. The web
 * chart is left alone — it is shipped, it is not part of step 4, and changing a
 * live component while building a new one is how both break. It is written up
 * for David rather than fixed quietly.
 *
 * ── Why it measures rather than scales ──────────────────────────────────────
 *
 * A sparkline in a viewBox either letterboxes or distorts, and a distorted one
 * turns the dots into ellipses and the stroke into two different widths. So the
 * width is measured with `onLayout` and the geometry is computed in real points.
 * One render pass costs nothing here — the chart is inside a card that has
 * already laid out.
 */

/** Tall enough to show a shape, short enough to sit under a card's heading. */
const CHART_HEIGHT = 56;
/** Keeps the end dots and the stroke inside the box. */
const PAD = 5;

/**
 * The delta that counts as movement.
 *
 * Health scores drift by a point or two as mileage estimates update without
 * anything having happened to the car, so a threshold of zero would report a
 * trend on every reading. Three is the web chart's figure and there is no
 * reason for the phone to hold a different opinion about what "moved" means.
 */
const MOVED = 3;

export interface HealthReading {
  health_score: number;
  recorded_at: string;
}

export default function HealthHistory({ history }: { history: HealthReading[] }) {
  const [width, setWidth] = useState(0);

  /*
    Two points is not a chart, and this guards it rather than trusting the
    caller — the web component's note records the same decision after the
    dashboard grew a second place that could render it.
  */
  if (history.length < 2) return null;

  const scores = history.map((entry) => entry.health_score);
  const first = scores[0];
  const last = scores[scores.length - 1];
  const delta = last - first;

  const band = getHealthBandJudgement(last);
  const colour = healthBandHex(band);

  const trend = delta > MOVED ? 'up' : delta < -MOVED ? 'down' : 'steady';
  const sentence =
    trend === 'steady'
      ? `Health steady around ${last}, across ${history.length} readings.`
      : `Health ${trend} ${Math.abs(delta)} points to ${last}, across ${history.length} readings.`;

  const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);

  /*
    The vertical scale is the *observed* range, not 0–100.

    A car whose score has moved between 68 and 74 would be a flat line on an
    absolute axis, which says "nothing happened" about six points of real
    movement. The trend is the subject here; the absolute reading is on the dial
    two cards up, and the start and current numerals below carry it anyway.
  */
  const low = Math.min(...scores);
  const high = Math.max(...scores);
  const range = high - low || 1;

  const points = history.map((entry, index) => ({
    x: PAD + (index / (history.length - 1)) * (width - PAD * 2),
    y: CHART_HEIGHT - PAD - ((entry.health_score - low) / range) * (CHART_HEIGHT - PAD * 2),
  }));

  const line = points.map((point) => `${point.x},${point.y}`).join(' ');

  return (
    <View>
      <View
        onLayout={onLayout}
        style={styles.chart}
        accessibilityRole="image"
        accessibilityLabel={sentence}
      >
        {/* Nothing to draw until the first layout has reported a width. */}
        {width > 0 && (
          <Svg width={width} height={CHART_HEIGHT}>
            <Defs>
              {/*
                The wash under the line. It carries no value of its own — it is
                there so a single stroke on a dark card reads as a quantity
                rather than as a scratch — so it fades to almost nothing.
              */}
              <LinearGradient id="healthTrend" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={colour} stopOpacity={0.25} />
                <Stop offset="1" stopColor={colour} stopOpacity={0.02} />
              </LinearGradient>
            </Defs>

            <Polygon
              points={`${PAD},${CHART_HEIGHT} ${line} ${width - PAD},${CHART_HEIGHT}`}
              fill="url(#healthTrend)"
            />

            <Polyline
              points={line}
              fill="none"
              stroke={colour}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/*
              A dot per reading, with the latest at full strength. These are
              real observations rather than a continuous function, and a bare
              line would imply the score was known between them.
            */}
            {points.map((point, index) => (
              <Circle
                key={history[index].recorded_at}
                cx={point.x}
                cy={point.y}
                r={3}
                fill={colour}
                fillOpacity={index === points.length - 1 ? 1 : 0.5}
              />
            ))}
          </Svg>
        )}
      </View>

      {/*
        Start and current, and the current one in the band colour.

        Start is deliberately *not* banded — colouring it would put two
        judgements on one row and invite the reader to compare the colours
        rather than the numbers. Only the reading that is true now gets a
        verdict.
      */}
      <View style={styles.readings}>
        <View>
          <Text style={styles.caption}>Start</Text>
          <Text style={styles.figure}>{first}</Text>
        </View>
        <View>
          <Text style={styles.caption}>Current</Text>
          <Text style={[styles.figure, { color: colour }]}>{last}</Text>
        </View>
        <View style={styles.change}>
          <Text style={styles.caption}>Change</Text>
          <Text style={[styles.figure, trend !== 'steady' && { color: colour }]}>
            {delta > 0 ? '+' : ''}
            {delta}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chart: { height: CHART_HEIGHT, width: '100%' },
  readings: { flexDirection: 'row', gap: space.xl, marginTop: space.md },
  change: { marginLeft: 'auto', alignItems: 'flex-end' },
  caption: { ...type.label, color: text.muted },
  figure: { ...type.title, color: text.secondary, ...TABULAR },
});
