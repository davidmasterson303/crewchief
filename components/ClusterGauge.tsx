'use client';

import { useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from '@/hooks/use-reduced-motion';
import { useHealthBand } from '@/hooks/use-health-band';

/*
 * The health score as an instrument cluster, not a progress donut.
 *
 * Built to `docs/roadmap.md` item 7 (concept 2a). The reference is a modern
 * flagship cluster at night, and its grammar is specific: a near-black face, a
 * thin luminous arc open at the bottom, fine ticks with the numbers *on* the
 * majors, one accent hue used as light rather than as fill, tabular numerals,
 * and a needle sweep at ignition. What it never does is close the ring — a
 * 360° track has no start and no end, so it reads as a loading spinner rather
 * than a scale.
 *
 * The 270° opening is what buys the ticks. On a closed donut there is nowhere
 * to put 40 / 60 / 80 without them colliding with the fill, which is why the
 * ring this replaces had no marks at all: it could show that a score was
 * large, but not that 68 sits one tick past the boundary where "Needs
 * attention" becomes "Fair". The linear band scale this hero used to carry
 * made the same argument in its own comment; the ticks have simply moved onto
 * the arc, where the reading and the scale are one object.
 *
 * ── Geometry ────────────────────────────────────────────────────────────────
 *
 * viewBox 0 0 200 178, centre (100,100), arc radius 70, open 90° at the
 * bottom. The height is 178 rather than 200 deliberately: the arc bottoms out
 * at y≈152, and the 26 units left below it are exactly the readout's line.
 * Cropping there is what stops the dial floating in a square of nothing.
 *
 * A score maps to an angle by `2.7 * score - 135` degrees from twelve
 * o'clock: 2.7 = 270/100, and -135 puts zero at the bottom-left end. Every
 * rotating part — needle, ticks, labels — uses that one expression, so nothing
 * can drift out of register with the track.
 *
 * The track path is `M 50.5 149.5 A 70 70 0 1 1 149.5 149.5`; those endpoints
 * are the same formula at 0 and 100, and the large-arc flag is 1 because 270°
 * exceeds a semicircle — the flag most hand-written arcs get wrong. The lit
 * portion reuses the identical `d` with `pathLength="100"`, so the dasharray
 * is literally the score: no circumference arithmetic, and no chance of the
 * fill and the track describing different curves.
 *
 * Caps are butt, not round. A round cap adds half a stroke width of arc at
 * each end, so a score of 0 would still paint a visible stub and every reading
 * would sit ~2% long. On a dial with ticks that error is legible.
 */

const VIEW_W = 200;
const VIEW_H = 178;
const CX = 100;
const CY = 100;
const R = 70;
const TRACK = `M 50.5 149.5 A ${R} ${R} 0 1 1 149.5 149.5`;

/** Degrees from twelve o'clock for a score. The one conversion in the file. */
function angleFor(score: number): number {
  return 2.7 * score - 135;
}

/** A point at `radius` along the dial, for a score. */
function pointAt(score: number, radius: number): { x: number; y: number } {
  const rad = (angleFor(score) * Math.PI) / 180;
  return { x: CX + radius * Math.sin(rad), y: CY - radius * Math.cos(rad) };
}

/*
  Majors carry the numbers; minors are every 5 and carry nothing. 40, 60 and 80
  are also band boundaries and are drawn brighter still — they are the only
  points on this scale where the score's meaning changes, and the whole reason
  the dial is ticked rather than smooth.
*/
const MAJORS = [0, 20, 40, 60, 80, 100];
const BOUNDARIES = new Set([40, 60, 80]);
const MINORS = Array.from({ length: 21 }, (_, i) => i * 5).filter((t) => !MAJORS.includes(t));


/**
 * The ignition sweep: 0 → 100 → settle on the score, ~900ms.
 *
 * Not decoration — it is how a cluster says the instrument is live and what its
 * range is, before it says the reading. Driving needle and arc from one value
 * keeps them on the same number at every frame; they are one quantity drawn
 * twice.
 *
 * Reduced motion lands on the final value immediately, and so does a hidden
 * document — `requestAnimationFrame` does not fire in a background tab, and the
 * failure there is not a missed animation but a needle parked at zero beside
 * the label "Fair". `use-count-up.ts` records finding exactly that.
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
        const t = elapsed / SWEEP_UP;
        setValue(100 * (1 - Math.pow(1 - t, 3)));
      } else if (elapsed < SWEEP_UP + SETTLE) {
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
  /**
   * 'hero' is the full dial: minors every 5, numbered majors, needle and hub,
   * the reading on its own line beneath. 'card' is the same instrument at the
   * garage grid's 56px slot — see the note on the variant below.
   */
  variant?: 'hero' | 'card';
  /** Hold the sweep until the caller's own reveal has finished. */
  active?: boolean;
  /** Rendered width in px; height follows the viewBox ratio. */
  size?: number;
}

export function ClusterGauge({
  score,
  variant = 'hero',
  active = true,
  size = 196,
}: ClusterGaugeProps) {
  const isCard = variant === 'card';

  /*
    The card dial is deliberately still — no sweep, no count-up. VehicleCard's
    ring comment already settled this: those were single-card moments, and
    three of them side by side in the garage grid read as noise while the band
    colour already carries severity. Adopting the ticked dial there does not
    reopen it.
  */
  const swept = useIgnitionSweep(score, active && !isCard);
  const value = isCard ? score : swept;

  // Band comes from the *target*, never the swept value: the face must not
  // cycle amber → cyan → green on its way to a reading.
  const band = useHealthBand(score);

  const settled = isCard || Math.abs(swept - score) < 0.5;
  const clamped = Math.max(0, Math.min(100, value));

  /*
    Two viewBoxes, one geometry.

    The hero crops to 178 tall because the 26 units below the arc are the
    readout's line. The card has no readout line — its number sits in the well —
    so that crop would hang 11 units of dead space under the dial and push the
    numeral visibly off-centre: measured 3px low in a 56px slot, which is a lot
    at that size. The card gets a square box centred on the pivot instead, wide
    enough for the major ticks at r=84.

    Nothing else changes. Same centre, same radius, same angle expression — only
    the window onto them.
  */
  const viewBox = isCard ? '14 14 172 172' : `0 0 ${VIEW_W} ${VIEW_H}`;
  const height = isCard ? size : (size * VIEW_H) / VIEW_W;

  /*
    At 56px the minors would be sub-pixel and six numbers illegible, so the
    card keeps only what survives: the boundary majors, the arc, and a marker
    in place of needle-and-hub. A hub plus a centred numeral collide at any
    size — the needle would cross the digits — and the card has nowhere else to
    put its reading, so the pointer stops short there and the hub goes. The
    hero has the room and keeps both.
  */
  const tickR = { minorFrom: 76, minorTo: 79.5, majorFrom: 76, majorTo: 84 };

  return (
    <div
      className={isCard ? 'flex flex-col items-center gap-1 flex-shrink-0' : 'flex-shrink-0'}
      role="img"
      aria-label={`Health score ${Math.round(score)} out of 100 — ${band.label}`}
    >
      <svg
        viewBox={viewBox}
        width={size}
        height={height}
        aria-hidden="true"
        overflow="visible"
      >
        <path
          className="gauge-track"
          d={TRACK}
          fill="none"
          stroke={isCard ? `rgba(${band.rgb},0.10)` : 'rgb(255 255 255 / 0.08)'}
          strokeWidth="6"
          strokeLinecap="butt"
        />

        <path
          className="gauge-arc"
          d={TRACK}
          fill="none"
          stroke={band.color}
          strokeWidth="6"
          strokeLinecap="butt"
          pathLength={100}
          strokeDasharray={`${clamped} 100`}
          style={{
            // The light is the data; a heavy bloom reads as chrome. Held back
            // until the needle settles so the sweep itself stays crisp.
            filter: settled ? `drop-shadow(0 0 4px rgba(${band.rgb},0.28))` : 'none',
          }}
        />

        {/* Minors — hairlines, every 5, hero only. */}
        {!isCard &&
          MINORS.map((tick) => (
            <line
              key={`m${tick}`}
              className="gauge-tick"
              x1={CX}
              y1={CY - tickR.minorTo}
              x2={CX}
              y2={CY - tickR.minorFrom}
              stroke="rgb(255 255 255 / 0.14)"
              strokeWidth="1"
              transform={`rotate(${angleFor(tick)} ${CX} ${CY})`}
            />
          ))}

        {/* Majors. On the card only the three band boundaries survive. */}
        {(isCard ? [40, 60, 80] : MAJORS).map((tick) => (
          <line
            key={`M${tick}`}
            className="gauge-tick"
            x1={CX}
            y1={CY - (isCard ? 80 : tickR.majorTo)}
            x2={CX}
            y2={CY - tickR.majorFrom}
            stroke={
              BOUNDARIES.has(tick) ? 'rgb(255 255 255 / 0.5)' : 'rgb(255 255 255 / 0.26)'
            }
            strokeWidth={BOUNDARIES.has(tick) ? 2 : 1.5}
            transform={`rotate(${angleFor(tick)} ${CX} ${CY})`}
          />
        ))}

        {/* The numbers, on the majors. Upright — never rotated with the tick. */}
        {!isCard &&
          MAJORS.map((tick) => {
            const { x, y } = pointAt(tick, 90);
            return (
              <text
                key={`L${tick}`}
                x={x}
                y={y}
                className="num gauge-label"
                textAnchor="middle"
                dominantBaseline="central"
                fill={
                  BOUNDARIES.has(tick) ? 'rgb(255 255 255 / 0.42)' : 'rgb(255 255 255 / 0.24)'
                }
                fontSize="10"
                fontWeight="500"
              >
                {tick}
              </text>
            );
          })}

        {/* Needle. Hero runs it to the pivot and caps it with a hub; the card
            stops it short, because its reading sits in the well. */}
        <g transform={`rotate(${angleFor(clamped)} ${CX} ${CY})`}>
          <line
            className="gauge-needle"
            x1={CX}
            y1={42}
            x2={CX}
            y2={isCard ? 62 : CY}
            stroke={band.color}
            strokeWidth={isCard ? 3 : 2.5}
            strokeLinecap={isCard ? 'round' : 'butt'}
          />
        </g>
        {!isCard && (
          <circle
            className="gauge-hub"
            cx={CX}
            cy={CY}
            r="5"
            fill="rgb(12 11 10)"
            stroke={band.color}
            strokeWidth="1.5"
          />
        )}

        {/*
          The reading. Inter tabular via `.num`, per the type rule — a cluster
          face is mechanical, and a number that animates digit by digit must not
          reflow while it does.

          On the hero it sits on the line the 178-tall viewBox exists to make,
          below the hub and between the 0 and 100 labels, exactly where a tach
          puts its digital readout. Centring it in the well is not available
          once there is a hub: the needle would cross the digits, which is what
          it did before the hub came back.

          No "/100". No instrument prints its own denominator when the scale is
          drawn around it and both ends are numbered. The full reading is in the
          container's aria-label, where the dial cannot be seen.
        */}
        <text
          x={CX}
          y={isCard ? CY : 150}
          className="num gauge-reading"
          textAnchor="middle"
          dominantBaseline="central"
          fill={isCard ? '#FFFFFF' : band.color}
          // 60, not 64: tabular figures make "100" exactly 1.5x the width of
          // "88", and at 64 a perfect score measured 40.4px inside a 43.6px
          // well. It fit, with 1.6px a side. 60 buys the margin back.
          fontSize={isCard ? 60 : 30}
          fontWeight="700"
        >
          {Math.round(value)}
        </text>
      </svg>

      {/*
        Band label. Mounted rather than faded from opacity 0 — an invisible
        label is still in the accessibility tree, and hero-photo-fallback
        asserts it is absent during the reveal so it cannot describe a
        placeholder. Gated on the caller's reveal, not on the sweep finishing:
        the band derives from the target score, so it is known the moment the
        score is, and gating on the animation would make it depend on
        requestAnimationFrame — which does not run under fake timers or in a
        background tab.

        `short` on the card: "Needs attention" does not fit under 56px in a
        three-up grid. Same band, abbreviated; never a different judgement.
      */}
      {(isCard || active) && (
        <span
          className={
            isCard
              ? 'text-xs font-semibold leading-none'
              : 'block text-center font-semibold leading-none animate-fade-in'
          }
          style={{
            color: band.color,
            ...(isCard ? {} : { fontSize: size * 0.07, marginTop: size * 0.02 }),
          }}
        >
          {isCard ? band.short : band.label}
        </span>
      )}
    </div>
  );
}

export default ClusterGauge;
