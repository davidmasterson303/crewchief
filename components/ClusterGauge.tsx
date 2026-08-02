'use client';

import { useEffect, useRef, useState } from 'react';
import { useHealthBand } from '@/hooks/use-health-band';

/*
 * The health score as an instrument cluster, not a progress donut.
 *
 * The reference is a modern flagship cluster at night, and its grammar is
 * specific: a near-black face, a thin luminous arc open at the bottom, fine
 * ticks with the numbers *on* the ticks, one accent hue used as light rather
 * than as fill, tabular numerals, and a needle sweep at ignition. What it
 * never does is close the ring — a 360° track has no start and no end, so it
 * reads as a loading spinner rather than a scale.
 *
 * The 270° arc is what buys the ticks. On a closed donut there is nowhere to
 * put 40 / 60 / 80 without them colliding with the fill, which is why the ring
 * this replaces had no marks on it at all: it could show that a score was
 * large, but not that 61 sits one tick past the boundary where the label stops
 * saying "Needs attention" and starts saying "Fair". The linear band scale in
 * DiagnosticHero already understood this — its comment makes the argument
 * outright — and this is the same idea given the shape it belongs in.
 *
 * ── Geometry ────────────────────────────────────────────────────────────────
 *
 * viewBox 0 0 200 200, centre (100,100), arc radius 70, open 90° at the
 * bottom. A score maps to an angle by `2.7 * score - 135` degrees, measured
 * from twelve o'clock: 2.7 = 270/100, and -135 puts zero at the bottom-left
 * end of the arc. Every rotating part — needle, ticks, labels — uses that one
 * expression, so nothing can drift out of register with the track.
 *
 * The track path is `M 50.5 149.5 A 70 70 0 1 1 149.5 149.5`. Those endpoints
 * are the same formula at score 0 and 100; the large-arc flag is 1 because 270°
 * exceeds a semicircle, which is the flag that is wrong in most hand-written
 * arcs. The filled portion reuses the identical `d` with `pathLength="100"`,
 * so `stroke-dasharray="${score} 100"` is the score in percent with no
 * circumference arithmetic to get wrong — and no chance of the fill and the
 * track describing different curves.
 */

const CX = 100;
const CY = 100;
const R = 70;
const TRACK = `M 50.5 149.5 A ${R} ${R} 0 1 1 149.5 149.5`;

/** Degrees from twelve o'clock for a score. The one conversion in the file. */
function angleFor(score: number): number {
  return 2.7 * score - 135;
}

/** Where a label sits, just outside the ticks. */
function labelPoint(score: number, radius = 88): { x: number; y: number } {
  const rad = (angleFor(score) * Math.PI) / 180;
  return { x: CX + radius * Math.sin(rad), y: CY - radius * Math.cos(rad) };
}

/*
  The ticks. 0 and 100 close the scale; 40, 60 and 80 are the band boundaries
  and are drawn brighter, because those are the only places on this scale where
  the score's *meaning* changes. Only the three boundaries are numbered — 0 and
  100 are self-evident from the ends of the arc, and labelling them adds two
  numerals for no information.
*/
const TICKS = [0, 20, 40, 60, 80, 100];
const BOUNDARIES = new Set([40, 60, 80]);

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The ignition sweep: 0 → 100 → score, then settle.
 *
 * Not decoration — it is how a cluster tells you the instrument is live and
 * what its range is, before it tells you the reading. Doing it in one hook
 * rather than two chained transitions keeps the needle and the arc on the same
 * value at every frame; they are the same number rendered twice.
 *
 * Reduced motion lands on the final value immediately, and so does a hidden
 * document — `requestAnimationFrame` does not fire in a background tab, and
 * the failure mode there is not a missed animation but a needle parked at zero
 * next to the label "Fair". `use-count-up.ts` records finding exactly that.
 */
function useIgnitionSweep(target: number, enabled: boolean): number {
  const [value, setValue] = useState(() => (prefersReducedMotion() ? target : 0));
  const frame = useRef<number>();

  useEffect(() => {
    if (prefersReducedMotion() || (typeof document !== 'undefined' && document.hidden)) {
      setValue(target);
      return;
    }
    if (!enabled) {
      setValue(0);
      return;
    }

    const SWEEP_UP = 420;
    const SETTLE = 480;
    const start = performance.now();

    const tick = (now: number) => {
      const elapsed = now - start;

      if (elapsed < SWEEP_UP) {
        // Out to full scale, decelerating.
        const t = elapsed / SWEEP_UP;
        setValue(100 * (1 - Math.pow(1 - t, 3)));
      } else if (elapsed < SWEEP_UP + SETTLE) {
        // Back down to the reading, decelerating again so it lands rather
        // than snapping.
        const t = (elapsed - SWEEP_UP) / SETTLE;
        setValue(100 + (target - 100) * (1 - Math.pow(1 - t, 3)));
      } else {
        setValue(target);
        return;
      }
      frame.current = requestAnimationFrame(tick);
    };

    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    };
  }, [target, enabled]);

  return value;
}

interface ClusterGaugeProps {
  score: number;
  /** Hold the sweep until the caller's own reveal has finished. */
  active?: boolean;
  /** Rendered size in px. The viewBox is fixed, so this only scales. */
  size?: number;
}

export function ClusterGauge({ score, active = true, size = 188 }: ClusterGaugeProps) {
  const swept = useIgnitionSweep(score, active);

  // Band comes from the *target*, never the swept value: the face must not
  // cycle amber → cyan → green on its way to a reading. Same rule the ring
  // this replaces already followed.
  const band = useHealthBand(score);

  const settled = Math.abs(swept - score) < 0.5;
  const shown = Math.round(swept);

  return (
    <div
      className="relative flex-shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Health score ${Math.round(score)} out of 100 — ${band.label}`}
    >
      <svg viewBox="0 0 200 200" width={size} height={size} aria-hidden="true">
        {/* The unlit track. */}
        <path
          className="gauge-track"
          d={TRACK}
          fill="none"
          stroke="rgb(255 255 255 / 0.08)"
          strokeWidth="6"
          strokeLinecap="round"
        />

        {/*
          The lit portion. `pathLength="100"` restates the curve as 100 units
          long, so the dasharray is literally the score.

          The glow is one soft drop-shadow and it is deliberately restrained —
          in this reference the light *is* the data, so a heavy bloom reads as
          chrome. It also only appears once the needle has settled, so the
          sweep itself stays crisp.
        */}
        <path
          className="gauge-arc"
          d={TRACK}
          fill="none"
          stroke={band.color}
          strokeWidth="6"
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray={`${Math.max(0, Math.min(100, swept))} 100`}
          style={{
            filter: settled ? `drop-shadow(0 0 4px rgba(${band.rgb},0.28))` : 'none',
          }}
        />

        {/* Ticks, on the same angle expression as everything else. */}
        {TICKS.map((tick) => (
          <line
            key={tick}
            className="gauge-tick"
            x1={CX}
            y1={24}
            x2={CX}
            y2={30}
            stroke={BOUNDARIES.has(tick) ? 'rgb(255 255 255 / 0.45)' : 'rgb(255 255 255 / 0.18)'}
            strokeWidth={BOUNDARIES.has(tick) ? 2 : 1.5}
            strokeLinecap="round"
            transform={`rotate(${angleFor(tick)} ${CX} ${CY})`}
          />
        ))}

        {/* Boundary numerals — upright, never rotated with their tick. */}
        {[40, 60, 80].map((tick) => {
          const { x, y } = labelPoint(tick);
          return (
            <text
              key={tick}
              x={x}
              y={y}
              className="num gauge-label"
              textAnchor="middle"
              dominantBaseline="central"
              fill="rgb(255 255 255 / 0.32)"
              fontSize="11"
              fontWeight="500"
            >
              {tick}
            </text>
          );
        })}

        {/*
          The needle, and the one place the spec had to give.

          It was drawn as (100,42) → (100,95): a full pointer running from just
          inside the track almost to the centre, with a hub at the pivot. That
          assumes the centre is empty. It is not — the reading sits in the well,
          which is where a cluster puts it, so a needle reaching r=5 crosses the
          numeral. At 68 it drew a line through the 8.

          Shortened to r=58 → r=38, clear of the numeral's r≈26, and the hub
          goes with it: a pivot with no needle touching it is just a dot. What
          is left reads as the marker on a digital cluster rather than a
          mechanical pointer, which is the closer reference anyway.
        */}
        <g transform={`rotate(${angleFor(Math.max(0, Math.min(100, swept)))} ${CX} ${CY})`}>
          <line
            className="gauge-needle"
            x1={CX}
            y1={42}
            x2={CX}
            y2={62}
            stroke={band.color}
            strokeWidth="2.5"
            strokeLinecap="round"
            opacity={0.95}
          />
        </g>
      </svg>

      {/*
        The readout, in the well of the arc. Inter with tabular figures rather
        than the display serif: real clusters use a mechanical face, and a
        number that animates digit by digit must not reflow while it does.

        Sized against the *well*, not the box. The arc's inner edge is at
        r=67 in viewBox units — radius 70 less half the 6-unit stroke — so the
        usable width is 134/200 of whatever `size` is, and the readout has to
        fit inside that or it collides with the track. It did.

        "/100" is gone, and not for space. No instrument prints its own
        denominator: the scale is the arc, and it is already labelled at 40, 60
        and 80 with both ends visible. Printing "/100" inside a dial that shows
        you where 100 is says the same thing twice and crowds the one number
        that matters — which is how it came to overlap the track at three
        digits. The full reading survives for screen readers in the container's
        aria-label, where the arc cannot be seen.
      */}
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span
          className="num font-bold leading-none tabular-nums"
          style={{ fontSize: size * 0.2, color: band.color, marginTop: size * 0.05 }}
        >
          {shown}
        </span>
        {/*
          Mounted rather than rendered invisible: an `opacity: 0` label is
          still in the document and still in the accessibility tree, and
          `hero-photo-fallback.test.tsx` asserts the label is absent during the
          reveal precisely so it cannot describe a placeholder.

          Gated on `active` — the caller's reveal — and deliberately not on the
          sweep finishing. The band is derived from the target score, so it is
          known the moment the score is, and it is the same instant the label
          appeared before this component existed. Gating it on the animation
          instead would also make it depend on requestAnimationFrame, which
          does not run under fake timers or in a background tab; the label
          would simply never arrive.
        */}
        {active && (
          <span
            className="font-semibold leading-none animate-fade-in"
            style={{
              fontSize: size * 0.068,
              marginTop: size * 0.045,
              color: band.color,
            }}
          >
            {band.label}
          </span>
        )}
      </div>
    </div>
  );
}

export default ClusterGauge;
