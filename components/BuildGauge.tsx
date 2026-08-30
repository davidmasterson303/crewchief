'use client';

import { CX, CY, R, TRACK, VIEW_H, VIEW_W, angleFor, pointAt } from '@wellkept/core/cluster-geometry';
import type { BuildPosition } from '@wellkept/core/build-progress';

/**
 * Where the redline starts, on the same 0-100 scale as the reading.
 *
 * One constant drives the painted band and the needle's colour, so the two
 * cannot drift — a redline drawn at 82 with a needle that turns at 85 would
 * show a pointer sitting in the red while still reading as normal, which is
 * worse than having no redline.
 */
const REDLINE_FROM = 82;

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
 * So the geometry is shared through `@wellkept/core/cluster-geometry` and the
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
    needle >= 70
      ? 'var(--build-far)'
      : needle >= 40
        ? 'var(--build-warm)'
        : needle >= 12
          ? 'var(--build-mild)'
          : 'var(--build-stock)';

  /*
    The needle joins the redline once it enters it — v8 §4c.

    Only the needle, never the lit arc. The arc is the *history* of the build
    and none of it happened in the red; the needle is where the car is now. A
    tachometer colours the pointer, not the sweep behind it.

    Still not a failure: `aria-label` stays "Build progress — {label}" and
    never a score, so nothing here announces a modified car as a fault.
  */
  const needleColour = needle >= REDLINE_FROM ? 'var(--build-redline)' : colour;

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
          strokeWidth={6}
          strokeLinecap="butt"
        />

        {/*
          The redline. v8 §4c.

          Painted on the **unlit** face from 82 to 100, so it is there at a
          reading of zero — visible at idle, visible with the car switched off,
          exactly as a tachometer's is painted at the factory.

          This is the one place red does not mean fault. A redline means *near
          the limit of the engine*, and that is the argument this dial already
          makes in its geometry: `needleFor` clamps at 99, and a complete pass
          of the WRX's entire known catalogue lands near 63. Visible from first
          launch, very nearly unreachable.

          `--build-redline` is deliberately hotter and more orange-shifted than
          `--critical-red`. A redline that matched the alert red would be read
          as an alert — do not harmonise them.
        */}
        <path
          d={TRACK}
          fill="none"
          stroke="var(--build-redline-track)"
          strokeWidth={6}
          strokeLinecap="butt"
          pathLength={100}
          strokeDasharray={`${100 - REDLINE_FROM} 100`}
          strokeDashoffset={-REDLINE_FROM}
        />

        {/* The reading. `pathLength` normalises the arc to 100 so the dasharray
            is the reading itself — the same trick the health dial uses. */}
        <path
          d={TRACK}
          fill="none"
          stroke={colour}
          strokeWidth={6}
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
          stroke={needleColour}
          strokeWidth={2.5}
          /*
            `butt`, not `round`. A round cap adds half a stroke width past the
            tip, which on a dial with ticks reads as the needle sitting a little
            past where it points — the same error the health gauge's arc caps
            were changed for.
          */
          strokeLinecap="butt"
          style={{ transition: 'all 900ms ease-out' }}
        />
        {/* `#100F0D`, the warm graphite ground — not the cool `#0d1117` this
            carried, which belonged to a palette this system moved off. */}
        <circle cx={CX} cy={CY} r={5} fill="#100F0D" stroke={needleColour} strokeWidth={2} />
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
