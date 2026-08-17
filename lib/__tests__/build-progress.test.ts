/**
 * How far a build has come — a position, never a percentage.
 *
 * @jest-environment node
 *
 * David, 7 Aug: *"I don't like the idea of end states anymore. It's a
 * continuum. There's almost always something more you can do"* — and then a
 * sport dial to show it.
 *
 * The tension in that brief is real: a dial has a redline, a continuum does
 * not. Most of this file is the resolution — the needle approaches 100 and
 * never arrives, so the glass itself says there is more to do.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  REDLINE_FROM,
  buildPosition,
  buildRampFor,
  buildSummary,
  effortOf,
  needleFor,
} from '@crewchief/core/build-progress';
import { CX, CY, R, TRACK, VIEW_H, VIEW_W, angleFor, pointAt } from '@crewchief/core/cluster-geometry';

/** The WRX's five parts — Easy, Moderate ×3, Hard. 1 + 9 + 6 = 16. */
const WRX = [
  { difficulty: 'Easy' },
  { difficulty: 'Moderate' },
  { difficulty: 'Moderate' },
  { difficulty: 'Moderate' },
  { difficulty: 'Hard' },
];

describe('the dial never reaches the end', () => {
  it('never returns 100, however much has been done', () => {
    // The whole argument, as an assertion. A progress bar that fills says
    // "finished"; this cannot.
    const absurd = Array.from({ length: 200 }, () => ({ difficulty: 'Hard' }));

    expect(needleFor(10_000)).toBeLessThan(100);
    expect(buildPosition(absurd).needle).toBeLessThan(100);
  });

  it('reads zero for a car with nothing recorded', () => {
    expect(buildPosition([]).needle).toBe(0);
  });

  it('leaves visible headroom after a full pass of the known list', () => {
    /*
      Completing everything the WRX's knowledge base knows about should read as
      a long way along and visibly unfinished — if it pegged the dial, the
      catalogue would have become an end state by the back door.
    */
    const { needle } = buildPosition(WRX);

    expect(needle).toBeGreaterThan(50);
    expect(needle).toBeLessThan(80);
  });

  it('always climbs — more work never reads as less', () => {
    let previous = -1;
    for (const points of [0, 1, 3, 6, 12, 22, 40, 100]) {
      const now = needleFor(points);
      expect(now).toBeGreaterThanOrEqual(previous);
      previous = now;
    }
  });
});

describe('effortOf', () => {
  it('is superlinear, because a built engine is not three air filters', () => {
    expect(effortOf('Hard')).toBeGreaterThan(effortOf('Moderate') * 1.5);
  });

  it.each([[null], [undefined], ['Unknown'], ['']])(
    'scores %p as Moderate rather than nothing',
    (value) => {
      // Scoring an oddly-described mod at zero would quietly punish the owners
      // with the most unusual builds — the people this feature is for.
      expect(effortOf(value as string)).toBe(effortOf('Moderate'));
    }
  );
});

describe('zones', () => {
  it('calls an untouched car stock', () => {
    expect(buildPosition([]).zone).toBe('stock');
  });

  it('moves off stock on the first completed mod', () => {
    expect(buildPosition([{ difficulty: 'Easy' }]).zone).toBe('lightly-modified');
  });

  it('has no terminal zone — built is a floor, not a ceiling', () => {
    const heavy = buildPosition(Array.from({ length: 20 }, () => ({ difficulty: 'Hard' })));
    const heavier = buildPosition(Array.from({ length: 40 }, () => ({ difficulty: 'Hard' })));

    expect(heavy.zone).toBe('built');
    expect(heavier.zone).toBe('built');
    // Same word, further along the dial. The zone stops describing; the needle
    // does not stop moving.
    expect(heavier.needle).toBeGreaterThanOrEqual(heavy.needle);
  });
});

describe('buildSummary', () => {
  it('tells an untouched car how the dial moves', () => {
    expect(buildSummary(buildPosition([]), 3)).toMatch(/mark work installed/);
  });

  it('says plainly when the owner has outrun the list', () => {
    // Not "complete". There is no complete.
    expect(buildSummary(buildPosition(WRX), 0)).toMatch(/outrun|keeps going/);
  });

  it('never says a percentage or a completion', () => {
    const claims = [
      buildSummary(buildPosition([]), 3),
      buildSummary(buildPosition(WRX), 2),
      buildSummary(buildPosition(WRX), 0),
    ];

    for (const claim of claims) {
      expect(claim).not.toMatch(/%|complete|finished|100/i);
    }
  });
});

/**
 * The build dial and the health dial must stay the same instrument.
 *
 * `BuildGauge` reads its geometry from `@crewchief/core/cluster-geometry`.
 * `ClusterGauge` still carries its own literals, deliberately — it works, it is
 * covered, and rewriting a shipped component to prove a point about duplication
 * is how a working thing breaks.
 *
 * So this pins them instead. If either moves, the two gauges stop being one
 * instrument and the cluster reads as two unrelated widgets.
 */
describe('one instrument, two readings', () => {
  const gauge = readFileSync(
    join(__dirname, '..', '..', 'components', 'ClusterGauge.tsx'),
    'utf8'
  );

  it('shares the arc path', () => {
    expect(gauge).toContain('M 50.5 149.5 A ${R} ${R} 0 1 1 149.5 149.5');
    expect(TRACK).toBe('M 50.5 149.5 A 70 70 0 1 1 149.5 149.5');
  });

  it('shares the radius the arc is actually drawn at', () => {
    /*
      ⚠ Added 17 Aug, closing a hole in the check above it.

      That assertion matches the **template text** `A ${R} ${R}` — so it passes
      whatever `R` happens to be. Change the web dial to `const R = 68` and the
      source still contains that exact string, `TRACK` still equals the value
      core resolved, and both assertions stay green while the two dials draw
      different arcs at the same endpoints.

      A guard whose subject is an unexpanded template is checking punctuation.
    */
    expect(gauge).toContain(`const R = ${R}`);
    expect(gauge).toContain(`const CX = ${CX}`);
    expect(gauge).toContain(`const CY = ${CY}`);
  });

  it('shares the viewBox', () => {
    expect(gauge).toContain(`const VIEW_W = ${VIEW_W}`);
    expect(gauge).toContain(`const VIEW_H = ${VIEW_H}`);
  });

  it('shares the angle conversion', () => {
    expect(gauge).toContain('2.7 * score - 135');
    expect(angleFor(0)).toBe(-135);
    expect(angleFor(100)).toBe(135);
  });

  it('puts its own endpoints exactly where the arc path says they are', () => {
    /*
      The strongest of these, because it is the only one that is not string
      matching — and because the two files express this geometry in genuinely
      different forms:

          web    x = CX + r·sin(θ),        y = CY − r·cos(θ)
          core   x = CX + r·cos(θ − 90°),  y = CY + r·sin(θ − 90°)

      Those are equal for every θ, and nothing said so. `pointAt` is the one
      piece of the dial a refactor can silently break — swap a sine for a cosine
      and every tick, the needle and the numerals move together, which reads as
      a design choice rather than a bug.

      Tying it to `TRACK`'s literal endpoints is what makes it self-checking:
      the arc string and the point function are independent statements of the
      same shape, so if either drifts they stop agreeing.
    */
    const start = pointAt(0, R);
    const end = pointAt(100, R);

    expect(start.x).toBeCloseTo(50.5, 1);
    expect(start.y).toBeCloseTo(149.5, 1);
    expect(end.x).toBeCloseTo(149.5, 1);
    expect(end.y).toBeCloseTo(149.5, 1);

    // And those are the numbers actually written into the arc, not numbers that
    // merely resemble them.
    expect(TRACK).toContain(`M ${start.x.toFixed(1)} ${start.y.toFixed(1)}`);
    expect(TRACK).toContain(`${end.x.toFixed(1)} ${end.y.toFixed(1)}`);
  });
});

/**
 * The build dial's paint, pinned across two clients.
 *
 * `buildRampFor` and `REDLINE_FROM` moved into core when the phone grew its own
 * `BuildGauge`: React Native has no `var(--build-far)`, so the mobile dial has
 * to make the same region choice from its own token layer, and a second copy of
 * `needle >= 70` is a second copy.
 *
 * `components/BuildGauge.tsx` still carries its literals, deliberately — the
 * same reasoning `cluster-geometry` states above. It works, it is covered, and
 * rewriting a shipped component to prove a point about duplication is how a
 * working thing breaks. This pins them instead, so the two dials cannot start
 * disagreeing about where a build turns amber.
 */
describe('one ramp, two clients', () => {
  const web = readFileSync(
    join(__dirname, '..', '..', 'components', 'BuildGauge.tsx'),
    'utf8'
  );

  it('shares the redline', () => {
    expect(web).toContain(`const REDLINE_FROM = ${REDLINE_FROM}`);
    expect(REDLINE_FROM).toBe(82);
  });

  it('shares the three ramp thresholds', () => {
    expect(web).toContain('needle >= 70');
    expect(web).toContain('needle >= 40');
    expect(web).toContain('needle >= 12');

    expect(buildRampFor(70)).toBe('far');
    expect(buildRampFor(69)).toBe('warm');
    expect(buildRampFor(40)).toBe('warm');
    expect(buildRampFor(39)).toBe('mild');
    expect(buildRampFor(12)).toBe('mild');
    expect(buildRampFor(11)).toBe('stock');
  });

  it('never puts a stock reading in a health band s territory', () => {
    /*
      The rule the phone's dial is tested against too, stated here because it is
      a property of the ramp rather than of either renderer: **a low reading is
      stock, not a fault.** `stock` is the region for everything under 12, and
      there is no region above it that a zero reading can fall into.
    */
    expect(buildRampFor(0)).toBe('stock');
    expect(buildRampFor(buildPosition([]).needle)).toBe('stock');
  });
});
