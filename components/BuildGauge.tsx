'use client';

import { CX, CY, R, TRACK, VIEW_H, VIEW_W, angleFor, pointAt } from '@crewchief/core/cluster-geometry';
import type { BuildPosition } from '@crewchief/core/build-progress';

/**
 * How far this build has come, on the cluster dial.
 *
 * ── Why a sibling of `ClusterGauge` and not a variant of it ─────────────────
 *
 * The health gauge is hardwired to health semantics, correctly: it calls
 * `useHealthBand(score)`, announces "Health score 61 out of 100 — Fair", and
 * paints low readings red. **On a build dial a low reading is not bad, it is
 * stock.** Reusing it would render an unmodified car as a critical failure and
 * announce it to a screen reader as one.
 *
 * So the geometry is shared through `@crewchief/core/cluster-geometry` and the
 * *meaning* is not. Two gauges in one cluster, one set of numbers describing
 * the glass.
 *
 * ── The needle never reaches the end, and that is the argument ──────────────
 *
 * `buildPosition` maps accumulated effort through an asymptote, so no amount of
 * work pegs the dial. A progress bar that fills says "you are finished"; this
 * says "there is always something more you can do", which is the thing David
 * asked the product to express. It is made in glass rather than in copy.
 */
export function BuildGauge({
  position,
  size = 180,
}: {
  position: BuildPosition;
  size?: number;
}) {
  const { needle, label, points } = position;
  const tip = pointAt(needle, R - 12);

  /*
    Warm as the build climbs, rather than the health palette's red-to-green.
    Nothing here is a failure state, so nothing is red: cool steel for stock,
    warming through to the amber this app already uses for recall attention.
  */
  const colour =
    needle >= 70 ? '#f0a35e' : needle >= 40 ? '#e0c168' : needle >= 12 ? '#9fc8d8' : '#7d8794';

  return (
    <figure className="flex flex-col items-center gap-1" style={{ width: size }}>
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        width={size}
        height={(size * VIEW_H) / VIEW_W}
        role="img"
        aria-label={`Build progress — ${label}`}
      >
        {/* Track. */}
        <path
          d={TRACK}
          fill="none"
          stroke="rgb(255 255 255 / 0.08)"
          strokeWidth={10}
          strokeLinecap="butt"
        />

        {/* The reading. `pathLength` normalises the arc to 100 so the dasharray
            is the reading itself — the same trick the health dial uses. */}
        <path
          d={TRACK}
          fill="none"
          stroke={colour}
          strokeWidth={10}
          strokeLinecap="butt"
          pathLength={100}
          strokeDasharray={`${needle} 100`}
          style={{ transition: 'stroke-dasharray 900ms ease-out, stroke 900ms ease-out' }}
        />

        {/* Minor ticks every 10. Fewer than the health dial's every-5: this
            reading has no numbered majors to align to, so a denser scale would
            imply a precision the points do not have. */}
        {Array.from({ length: 11 }, (_, i) => i * 10).map((reading) => {
          const outer = pointAt(reading, R + 9);
          const inner = pointAt(reading, R + 5);
          return (
            <line
              key={reading}
              x1={outer.x}
              y1={outer.y}
              x2={inner.x}
              y2={inner.y}
              stroke="rgb(255 255 255 / 0.22)"
              strokeWidth={1}
            />
          );
        })}

        {/* Needle and hub. */}
        <line
          x1={CX}
          y1={CY}
          x2={tip.x}
          y2={tip.y}
          stroke={colour}
          strokeWidth={2.5}
          strokeLinecap="round"
          style={{ transition: 'all 900ms ease-out' }}
        />
        <circle cx={CX} cy={CY} r={5} fill="#0d1117" stroke={colour} strokeWidth={2} />
      </svg>

      {/*
        The word, not the number. `points` is an internal unit and showing it
        would invite the reader to treat it as a score out of something — which
        is exactly the end state this dial exists to avoid. It stays in the
        title attribute for anyone who wants it.
      */}
      <figcaption className="text-sm font-semibold text-white" title={`${points} points`}>
        {label}
      </figcaption>
    </figure>
  );
}
