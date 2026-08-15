import { act, render, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, processColor } from 'react-native';
import { R } from '@crewchief/core/cluster-geometry';
import { getHealthBandJudgement, healthBandHex } from '@crewchief/core/health-band';
import { REDLINE_FROM, buildPosition } from '@crewchief/core/build-progress';
import { vehicleFieldStops } from '@crewchief/core/vehicle-identity';

import BuildGauge from '../BuildGauge';
import ClusterGauge from '../ClusterGauge';
import HealthHistory from '../HealthHistory';
import ProgressionLadder from '../ProgressionLadder';
import VehiclePlate from '../VehiclePlate';
import { DIAL_MIN, build } from '../../theme';

/**
 * The instruments' invariants.
 *
 * Not snapshots, for the reason `primitives.test.tsx` gives: a snapshot records
 * what a component renders and fails when anything changes, which trains people
 * to re-record it. These assert the handful of properties that must survive a
 * redesign — and every one of them is either a mistake already made in this
 * product or one line of code away from being made.
 *
 * ── They read the rendered tree, and that is not a formality here ───────────
 *
 * Two live defects on 14 Aug were invisible to source scans. A dial is exactly
 * the component whose bugs live in computed props: a dasharray against the
 * wrong denominator and a needle painted from the wrong ramp both read fine in
 * the source. So these walk what `react-native-svg` actually renders —
 * `RNSVGPath`, `RNSVGLine` — where the colours have already been through the
 * platform's own processing.
 */

/** The one true arc length: 270° at the shared radius. */
const ARC = 1.5 * Math.PI * R;

/** `strokeLinecap="butt"`, as react-native-svg's renderer encodes it. */
const CAP_BUTT = 0;

interface HostNode {
  type?: unknown;
  props?: Record<string, unknown>;
  children?: HostNode[];
}

/**
 * Every rendered host node of a kind, with its processed props.
 *
 * `@testing-library/react-native` v14 dropped the `UNSAFE_*` type queries, and
 * there is no accessible-name route to an SVG path — nor should there be, since
 * an arc is not an interface element. So the tree is walked directly. The nodes
 * are the native ones (`RNSVGPath`, not `Path`), which is the point: this is
 * what the device is handed.
 */
function hostNodes(root: unknown, kind: string): Array<Record<string, unknown>> {
  const found: Array<Record<string, unknown>> = [];

  const walk = (node: HostNode | null | undefined) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === kind && node.props) found.push(node.props);
    for (const child of node.children ?? []) walk(child);
  };

  walk(root as HostNode);
  return found;
}

/**
 * A rendered stroke, as a platform colour int.
 *
 * `react-native-svg` runs every colour through the same processing React Native
 * uses for a StyleSheet, so a rendered stroke is `{ type: 0, payload: <int> }`
 * rather than the hex it was written as. Comparing against `processColor` of a
 * token puts both sides through the same conversion, instead of this file
 * re-implementing it and agreeing with its own arithmetic.
 */
function strokeOf(props: Record<string, unknown> | undefined): number | null {
  const stroke = props?.stroke;
  if (stroke && typeof stroke === 'object' && 'payload' in stroke) {
    return Number((stroke as { payload: unknown }).payload);
  }
  return null;
}

const paintOf = (colour: string) => Number(processColor(colour));

/** Every health band's colour, for asserting a build dial is wearing none of them. */
const HEALTH_PAINTS = [10, 50, 70, 95].map((score) =>
  paintOf(healthBandHex(getHealthBandJudgement(score)))
);

afterEach(() => {
  jest.restoreAllMocks();
});

describe('ClusterGauge', () => {
  it('announces the score and the band, so the dial is not the only way to read it', async () => {
    const view = await render(<ClusterGauge score={61} />);

    // 61 is Fair. The wording is core's; a phone-side copy is exactly what
    // `health-band.ts` was extracted to prevent.
    view.getByLabelText('Health score 61 out of 100 — Fair');
  });

  it('paints the lit arc against the real arc length, not against 100', async () => {
    /*
      ⚠ The defect this exists for.

      The web dial sets `pathLength={100}` so the dasharray is literally the
      score. **`react-native-svg` does not implement `pathLength` on native** —
      it appears only in that package's react-native-web passthrough list — so a
      faithfully ported `strokeDasharray="50 100"` would paint 50 user units of
      a ~330-unit arc: every reading at about a sixth of its true position, and
      plausible enough to ship.
    */
    const view = await render(<ClusterGauge score={50} variant="card" />);

    // The card is deliberately still, so the lit arc is exactly half the track.
    const dashes = hostNodes(view.root, 'RNSVGPath')
      .map((props) => props.strokeDasharray)
      .filter(Array.isArray);

    expect(dashes).toContainEqual([ARC / 2, ARC]);
    expect(ARC).toBeCloseTo(329.867, 3);
  });

  it('caps the track and the reading butt, never round', async () => {
    /*
      A round cap adds half a stroke width of arc at each end, so a score of 0
      still paints a visible stub and every reading sits about 2% long. On a
      dial with ticks that error is legible.
    */
    const view = await render(<ClusterGauge score={0} />);

    for (const props of hostNodes(view.root, 'RNSVGPath')) {
      expect(props.strokeLinecap).toBe(CAP_BUTT);
    }
  });

  it('stops being a dial under the floor, rather than drawing an unreadable one', async () => {
    const view = await render(<ClusterGauge score={61} size={DIAL_MIN - 1} />);

    // No arc at all — the row scale is a different object, not a small dial.
    expect(hostNodes(view.root, 'RNSVGPath')).toHaveLength(0);
    view.getByText('61');
    view.getByText('Fair');
  });

  it('takes the floor from the size even when the caller asked for a hero', async () => {
    // How this mistake will actually be made: a hero dropped into a tight slot.
    const view = await render(<ClusterGauge score={61} variant="hero" size={72} />);

    expect(hostNodes(view.root, 'RNSVGPath')).toHaveLength(0);
  });

  it('puts the row numeral and its verdict in the band colour', async () => {
    const view = await render(<ClusterGauge score={35} variant="row" />);
    const expected = healthBandHex(getHealthBandJudgement(35));

    const styleOf = (node: { props: { style?: unknown } }) =>
      Object.assign({}, ...[node.props.style].flat(Infinity).filter(Boolean)) as {
        color?: string;
      };

    expect(styleOf(view.getByText('35')).color).toBe(expected);
    // `short`, never a different judgement — "Critical" either way here.
    expect(styleOf(view.getByText('Critical')).color).toBe(expected);
  });

  it('lands on the reading under reduced motion, instead of parking at zero', async () => {
    /*
      The named failure: a skipped sweep leaves a needle at 0 beside the label
      "Fair". Reduced motion must **jump to the end state** — it never simply
      declines to animate.
    */
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);

    const view = await render(<ClusterGauge score={61} />);
    await act(async () => {});

    view.getByText('61');
    expect(view.queryByText('0')).toBeNull();
  });

  it('finishes the sweep on the reading and not on the end of the scale', async () => {
    /*
      The sweep runs 0 → 100 → settle. A mis-sequenced one lands on 100, which
      would read as a perfect score on every car.
    */
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);

    const view = await render(<ClusterGauge score={61} />);

    await waitFor(() => view.getByText('61'), { timeout: 3000 });
    expect(view.queryByText('100')).toBeNull();
  });

  it('bands from the target, so the face never cycles on its way to a reading', async () => {
    /*
      Colour is read from the score, never from the swept value. A dial that
      banded the animation would run critical → attention → good on every
      appearance, and announce a healthy car as a fault for the first frames.
    */
    const view = await render(<ClusterGauge score={95} />);

    const needle = hostNodes(view.root, 'RNSVGLine').at(-1);
    expect(strokeOf(needle)).toBe(paintOf(healthBandHex(getHealthBandJudgement(95))));
  });
});

describe('BuildGauge', () => {
  const stock = buildPosition([]);
  const built = buildPosition(Array.from({ length: 12 }, () => ({ difficulty: 'Hard' })));

  it('never announces a build as a score', async () => {
    const view = await render(<BuildGauge position={stock} />);

    // "Build progress — Stock". Never "0 out of 100", which is what reusing the
    // health gauge would have said about an unmodified car.
    view.getByLabelText(`Build progress — ${stock.label}`);
    expect(view.queryByLabelText(/out of 100/)).toBeNull();
  });

  it('never colours a low reading from the health ramp', async () => {
    /*
      The rule, as a test, because the shortcut is one import away: **a low build
      reading is stock, not a fault.** Painting it from the health ramp renders
      an unmodified car as a critical failure and announces it as one.
    */
    const view = await render(<BuildGauge position={stock} />);

    const strokes = [
      ...hostNodes(view.root, 'RNSVGPath'),
      ...hostNodes(view.root, 'RNSVGLine'),
    ]
      .map(strokeOf)
      .filter((paint): paint is number => paint !== null);

    for (const health of HEALTH_PAINTS) {
      expect(strokes).not.toContain(health);
    }
    expect(strokes).toContain(paintOf(build.stock));
  });

  it('paints the redline at idle, because a tachometer is painted at the factory', async () => {
    const view = await render(<BuildGauge position={stock} />);

    const redline = hostNodes(view.root, 'RNSVGPath').find(
      (props) => strokeOf(props) === paintOf(build.redline)
    );

    expect(redline).toBeTruthy();
    // 82 → 100, as a share of the real arc rather than of `pathLength`.
    expect(redline?.strokeDasharray).toEqual([((100 - REDLINE_FROM) / 100) * ARC, ARC]);
    expect(Number(redline?.strokeDashoffset)).toBeCloseTo(-(REDLINE_FROM / 100) * ARC, 6);
  });

  it('turns the needle at the redline and only the needle', async () => {
    /*
      The arc is the *history* of the build and none of it happened in the red;
      the needle is where the car is now. A tachometer colours the pointer, not
      the sweep behind it.
    */
    expect(built.needle).toBeGreaterThanOrEqual(REDLINE_FROM);

    const view = await render(<BuildGauge position={built} />);

    const needle = hostNodes(view.root, 'RNSVGLine').at(-1);
    const lit = hostNodes(view.root, 'RNSVGPath').find(
      (props) =>
        Array.isArray(props.strokeDasharray) && strokeOf(props) !== paintOf(build.redline)
    );

    expect(strokeOf(needle)).toBe(paintOf(build.redline));
    expect(strokeOf(lit)).not.toBe(paintOf(build.redline));
  });

  it('shows the word and never the points', async () => {
    // `points` is an internal unit; printing it invites the reader to treat it
    // as a score out of something, which is the end state this dial avoids.
    const view = await render(<BuildGauge position={built} />);

    view.getByText(built.label);
    expect(view.queryByText(String(built.points))).toBeNull();
  });

  it('is still on mount, because a CSS transition does not run on first paint', async () => {
    /*
      Without the mount guard the needle eases up from zero every time the
      screen appears — a car reading "Stock" for 900ms before admitting it is
      Built, on every navigation.
    */
    const view = await render(<BuildGauge position={built} />);

    // Already in the red at the very first render.
    expect(strokeOf(hostNodes(view.root, 'RNSVGLine').at(-1))).toBe(paintOf(build.redline));
  });

  it('degrades to the word alone under the floor, with no numeral to misread', async () => {
    const view = await render(<BuildGauge position={built} size={DIAL_MIN - 1} />);

    expect(hostNodes(view.root, 'RNSVGPath')).toHaveLength(0);
    view.getByText(built.label);
    expect(view.queryByText(String(built.points))).toBeNull();
  });
});

describe('ProgressionLadder', () => {
  it('shows the whole scale on a cold start, which is the normal case', async () => {
    // `modification_tracking` is empty across the product. Nothing done is not
    // an empty state here — it is where every car currently is.
    const view = await render(<ProgressionLadder next="foundation" />);

    view.getByText('Foundation');
    view.getByText('Control before more power');
    view.getByText('Enabling');
    view.getByText('Durability');
    view.getByText('Cosmetic');
  });

  it('marks exactly one rung next, and never both states on one rung', async () => {
    const view = await render(<ProgressionLadder done={['foundation']} next="control" />);

    expect(view.getAllByText('next')).toHaveLength(1);
    expect(view.getAllByText('done')).toHaveLength(1);
  });

  it('carries state in a word, not only in the marker colour', async () => {
    // A 10pt dot changing hue would otherwise be the entire state, which fails
    // anyone who cannot separate the two colours.
    const view = await render(<ProgressionLadder next="control" />);

    view.getByText('next');
  });
});

describe('HealthHistory', () => {
  const reading = (health_score: number, day: number) => ({
    health_score,
    recorded_at: `2026-08-${String(day).padStart(2, '0')}T00:00:00Z`,
  });

  /** The device reports a width on first layout; nothing is drawn before that. */
  const layOut = async (view: Awaited<ReturnType<typeof render>>, width = 300) => {
    await act(async () => {
      const onLayout = view.getByLabelText(/Health/).props.onLayout as (
        event: { nativeEvent: { layout: { width: number } } }
      ) => void;
      onLayout({ nativeEvent: { layout: { width } } });
    });
  };

  it('is not a chart at one point', async () => {
    const view = await render(<HealthHistory history={[reading(60, 1)]} />);

    expect(view.toJSON()).toBeNull();
  });

  it('bands from core rather than from the web chart s own ramp', async () => {
    /*
      ⚠ `components/HealthHistoryChart.tsx` picks its colour from four hexes
      written into the component — `#4ade80`, `#22d3ee`, `#fb923c`, `#f87171` —
      and those are **not** the band's colours. On one web screen the trend line
      and the dial therefore disagree about what "Fair" looks like. The
      thresholds match; the paint does not. That defect is not ported here.
    */
    const view = await render(
      <HealthHistory history={[reading(62, 1), reading(68, 5), reading(71, 9)]} />
    );
    await layOut(view);

    /*
      `Polyline` and `Polygon` both render as `RNSVGPath` — react-native-svg
      builds their `d` and reuses the path renderer — so the trend line is
      identified by being the one stroked element. The wash under it is filled
      with a gradient and carries no stroke at all.
    */
    const stroked = hostNodes(view.root, 'RNSVGPath').filter(
      (props) => strokeOf(props) !== null
    );

    expect(stroked).toHaveLength(1);
    expect(strokeOf(stroked[0])).toBe(paintOf(healthBandHex(getHealthBandJudgement(71))));

    for (const webHex of ['#4ade80', '#22d3ee', '#fb923c', '#f87171']) {
      expect(strokeOf(stroked[0])).not.toBe(paintOf(webHex));
    }
  });

  it('describes the trend in a sentence, since a sparkline has no accessible shape', async () => {
    const view = await render(
      <HealthHistory history={[reading(62, 1), reading(68, 5), reading(71, 9)]} />
    );

    view.getByLabelText('Health up 9 points to 71, across 3 readings.');
  });

  it('does not call a two-point drift a trend', async () => {
    // Scores drift as mileage estimates update without anything happening to
    // the car. Reporting that as movement would cry wolf on every reading.
    const view = await render(
      <HealthHistory history={[reading(70, 1), reading(71, 5), reading(72, 9)]} />
    );

    view.getByLabelText('Health steady around 72, across 3 readings.');
  });

  it('scales to the observed range, so real movement is visible', async () => {
    /*
      On an absolute 0–100 axis a car that moved 68 → 74 is a flat line, which
      says "nothing happened" about six points of real change. The absolute
      reading is on the dial, and on the numerals below this.
    */
    const view = await render(
      <HealthHistory history={[reading(68, 1), reading(71, 5), reading(74, 9)]} />
    );
    await layOut(view);

    const ys = hostNodes(view.root, 'RNSVGCircle').map((props) => Number(props.cy));

    expect(ys).toHaveLength(3);
    expect(Math.max(...ys)).toBeGreaterThan(Math.min(...ys) + 10);
  });
});

describe('VehiclePlate', () => {
  it('names the car instead of naming the absence', async () => {
    /*
      ⚠ The defect this replaced. The card rendered a grey box reading "No
      photo" — a placeholder that names an absence, so a garage of
      unphotographed cars read as a garage of incomplete records. CC-142's
      answer is a finished design for the same state.
    */
    const view = await render(
      <VehiclePlate year={2015} make="BMW" model="M235i" trim="xDrive" />
    );

    view.getByText('M235i');
    view.getByText('2015 BMW · xDrive');
    expect(view.queryByText(/no photo/i)).toBeNull();
  });

  it('paints the field under a photograph as well as instead of one', async () => {
    // Not only a fallback — it is what shows for the instant before a photo
    // decodes, so the card never flashes an empty rectangle on its way to one.
    const view = await render(
      <VehiclePlate photo="https://example.test/car.jpg" make="BMW" model="M235i" />
    );

    expect(hostNodes(view.root, 'RNSVGRect')).toHaveLength(1);
    // The lockup stands down when there is a photo — the card body already
    // names the car, and printing it twice says the same thing twice.
    expect(view.queryByText('M235i')).toBeNull();
  });

  it('gives a make the same field on this client as on the other one', async () => {
    /*
      The whole reason `vehicleFieldStops` is in core. A BMW plate that is one
      blue in a browser and a different blue on a phone is two designs, and the
      drift would be invisible until someone held them side by side.
    */
    const stops = vehicleFieldStops('BMW');
    const view = await render(<VehiclePlate make="BMW" model="M235i" />);

    /*
      react-native-svg flattens a gradient to `[offset, colour, offset, colour]`
      and its colours come out **signed** where `processColor` returns unsigned.
      `>>> 0` puts both on the same side of 2^31 rather than this file deciding
      which representation is the real one.
    */
    const colours = hostNodes(view.root, 'RNSVGLinearGradient')
      .flatMap((props) => (Array.isArray(props.gradient) ? props.gradient : []))
      .map((value) => Number(value) >>> 0);

    expect(colours).toContain(paintOf(stops.from) >>> 0);
    expect(colours).toContain(paintOf(stops.to) >>> 0);
  });

  it('falls back to the lockup when a photo never resolves', async () => {
    /*
      An RN `Image` on a URL that hangs stays loading forever — it draws
      nothing and `onError` never fires, so a fallback gated on failure is
      unreachable. Measured on the simulator on 1 Aug against this account's
      own 2.3 MB original, which is still stored.
    */
    jest.useFakeTimers();
    try {
      const view = await render(
        <VehiclePlate photo="https://example.test/hangs.jpg" make="BMW" model="M235i" />
      );

      expect(view.queryByText('M235i')).toBeNull();

      await act(async () => {
        jest.advanceTimersByTime(6000);
      });

      view.getByText('M235i');
    } finally {
      jest.useRealTimers();
    }
  });
});
