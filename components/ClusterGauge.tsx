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
/*
  ── ⚠ Which majors get a number, and why it is not all of them ─────────────

  Six numerals around a 160px arc is a scale competing with its own reading. A
  design critique of the rendered dashboard called the dial "the default AI
  premium dashboard trope" and named the clutter first.

  The set that survives is not a trim for looks: it is the two ends of the
  scale, plus the three points where the *verdict* changes. `health-band.ts`
  puts those at 40, 60 and 80, and the linear track this replaced made the same
  argument in its own comment — a bare fill says "more is better" and nothing
  else, and those three are the only places on the scale where the answer
  changes. 20 is the one number that marks nothing.

  The majors all still get a mark — the scale is intact, it is the *type* that
  thinned. The every-5 hairlines went too, in the same pass and for the same
  reason; see the note where they were drawn.
*/
const LABELLED = [0, 40, 60, 80, 100];
const BOUNDARIES = new Set([40, 60, 80]);


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
  /**
   * The reading, or `null` when there is not enough history to make one.
   *
   * ── ⚠ D10 · `null` is not a zero, and this dial used to draw it as one ────
   *
   * `DiagnosticHero` passed `healthScore ?? 0` and `VehicleCard` passed
   * `healthSummary.health_score` straight through, so a car the model had
   * declined to score — the state `app/actions.ts` was rewritten to produce
   * rather than fake a 70 — arrived here as `0` and rendered a **full red dial
   * reading 0, labelled "Needs attention"**. Not an error, not a blank: a
   * confident worst-possible reading about a car nobody had assessed.
   *
   * That is the defect this whole file's sibling modules are written against —
   * `health-drivers.ts` says it four times, the garage card calls it "no score
   * is not a zero" — arriving through the one component that draws the number.
   *
   * So the type carries it. A caller cannot pass a missing score without
   * deciding what a missing score looks like, because the compiler now asks.
   */
  score: number | null;
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

  /**
   * No reading. Every branch below that would assert something about the car
   * is switched off by this, rather than fed a substitute number.
   */
  const unknown = score === null;

  /*
    ⚠ Hooks run on every path, including the unknown one.

    `0` here is a placeholder for arithmetic that is never drawn — the sweep is
    disabled and the band is discarded when `unknown`. It must not become a
    default score: the guards below are what stop it reaching the face, and the
    reason it is safe to write is that nothing reads it.
  */
  const swept = useIgnitionSweep(score ?? 0, active && !isCard && !unknown);

  /*
    The card dial is deliberately still — no sweep, no count-up. VehicleCard's
    ring comment already settled this: those were single-card moments, and
    three of them side by side in the garage grid read as noise while the band
    colour already carries severity. Adopting the ticked dial there does not
    reopen it.
  */
  const value = isCard ? score ?? 0 : swept;

  // Band comes from the *target*, never the swept value: the face must not
  // cycle amber → cyan → green on its way to a reading.
  const band = useHealthBand(score ?? 0);

  /*
    ⚠ The unknown face takes no band colour at all.

    Not the lowest band, not a neutral green — the muted ink the rest of this
    product uses for "we cannot say", the same choice `HealthDrivers` on mobile
    makes for a `null` driver. Colouring an unmeasured dial would assert a
    condition nobody checked, which is the overclaim in a different paint.
  */
  const ink = unknown ? 'rgb(255 255 255 / 0.38)' : band.color;
  const inkRgb = unknown ? '255 255 255' : band.rgb;

  const settled = isCard || unknown || Math.abs(swept - (score ?? 0)) < 0.5;
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
      /*
        ⚠ `w-fit` on the hero. The band label under the dial is `text-center`,
        and in the hero's stacked mobile column this wrapper stretched to the
        full 324px while the dial itself is 196 — so "Fair" centred on the
        column and sat 64px to the right of the instrument it belongs to.
        Hugging the drawing puts the two on one axis.
      */
      className={isCard ? 'flex flex-col items-center gap-1 flex-shrink-0' : 'w-fit flex-shrink-0'}
      role="img"
      /*
        ⚠ The unknown state has to be spoken, not merely undrawn. A dial that
        renders "—" and announces "Health score 0 out of 100" would be honest
        to the eye and false to a screen reader, which is the half of this
        product nobody looks at while fixing the other half.
      */
      aria-label={
        unknown
          ? 'Health score not available — not enough history yet'
          : `Health score ${Math.round(score)} out of 100 — ${band.label}`
      }
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
          stroke={isCard ? `rgba(${inkRgb},0.10)` : 'rgb(255 255 255 / 0.08)'}
          strokeWidth="6"
          strokeLinecap="butt"
          /*
            Dashed when there is no reading. The scale is still real — this is
            the instrument, and the range it measures has not gone away — but a
            broken line reads as "not measured" the way an unbroken one reads as
            "measured and empty". `strokeDasharray` on the *track* rather than a
            second element, so there is nothing extra to keep in register.
          */
          strokeDasharray={unknown ? '2 5' : undefined}
        />

        {/*
          The lit arc *is* the claim — its length is the score. There is no
          honest length for a score nobody has, so the unknown face has no arc
          at all rather than a zero-length one. (A zero-length arc and a missing
          arc look identical here only because the caps are butt; that is a
          coincidence of styling, not a reason to draw a reading of 0.)
        */}
        {!unknown && (
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
        )}

        {/*
          ── ⚠ The every-5 hairlines are gone, and so is `MINORS` ─────────────

          Twenty of them ringed a 160px arc, and a design critique of the
          rendered page counted them as noise twice — "stray outer ticks", then
          "drop raw ticks entirely". They read as texture rather than as a
          scale: nobody measures a health score to the nearest five, and the
          five marks that mean something were competing with fifteen that mean
          nothing.

          Deleted rather than switched off. A dead branch behind a constant is
          how a reduction becomes a thing somebody restores by accident,
          believing it was disabled for a release.
        */}

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
          LABELLED.map((tick) => {
            /*
              97, not 90. The major ticks end at 84 and the numerals were
              centred at 90 — about six pixels of clearance for type whose own
              half-height is seven, so "80" sat on its tick and read as "-80".
            */
            const { x, y } = pointAt(tick, 97);
            return (
              <text
                key={`L${tick}`}
                x={x}
                y={y}
                className="num gauge-label"
                textAnchor="middle"
                dominantBaseline="central"
                /*
                  ── ⚠ UI-04 · both floors broken on one element ──────────────

                  Measured live on 23 Aug: **10px** type at **2.20:1** — the
                  12px type floor and the 4.5:1 contrast floor, on the
                  dashboard's headline instrument, at the same time.

                  Measured against `--background` `#100F0D`: 0.24 alpha is
                  **2.12:1** and 0.42 is **4.09:1**, so neither of the two
                  values here cleared it and the boundary ticks were only
                  slightly less illegible than the rest.

                  0.55 is **6.24:1** for a boundary and 0.50 is **5.34:1** for
                  an ordinary tick — the ramp's own floor, which the mobile
                  theme states as the quietest a string may be. The distinction
                  between the two survives; both are now readable.

                  ⚠ **Not `text-*` utilities.** This is SVG, where Tailwind's
                  text sizing does not apply and `font-size` is the attribute
                  that works — which is also why every text scan in this repo is
                  blind to it. `.gauge-label` carries the size in `globals.css`
                  where forced-colors can reach it.
                */
                fill={
                  BOUNDARIES.has(tick) ? 'rgb(255 255 255 / 0.55)' : 'rgb(255 255 255 / 0.5)'
                }
                fontSize="12"
                fontWeight="500"
              >
                {tick}
              </text>
            );
          })}

        {/* Needle. Hero runs it to the pivot and caps it with a hub; the card
            stops it short, because its reading sits in the well. */}
        {/*
          ⚠ No needle without a reading. A needle points at a value; parking one
          at the bottom of the scale is how the unknown state became "0" in the
          first place, and it would be the most convincing wrong answer on the
          face. The hub stays on the hero — it is the instrument, not the
          reading — but takes the muted ink so nothing on a dark face glows a
          judgement.
        */}
        {!unknown && (
          <g transform={`rotate(${angleFor(clamped)} ${CX} ${CY})`}>
            {/*
              ── ⚠ A pointer, not a needle on a spindle ────────────────────

              It ran to the exact centre and met a 5px hub drawn over it —
              which is what a toy speedometer looks like, and a design critique
              of the rendered page said so. The hub existed for a reason worth
              recording: without it the needle crossed the digits. It is not
              needed now because the needle no longer reaches them.

              What replaces it is a short marker riding just inside the track,
              at the reading. A full-length needle floating without a pivot was
              worse than either — it read as a stray line across the middle
              rather than as something indicating a position on the arc.

              And it clears the well completely, which is what lets the reading
              move into it.
            */}
            <line
              className="gauge-needle"
              x1={CX}
              y1={isCard ? 42 : 34}
              x2={CX}
              y2={isCard ? 62 : 50}
              stroke={band.color}
              strokeWidth={isCard ? 3 : 2.5}
              strokeLinecap="round"
            />
          </g>
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
        {/*
          ⚠ In the well now, not on the bottom line.

          The comment this replaces was accurate about its own constraint —
          *"centring it in the well is not available once there is a hub: the
          needle would cross the digits"* — and the constraint is gone with the
          hub. The reading is the instrument's subject; sitting it between the
          0 and 100 labels made it a caption to the dial instead of the point
          of it.

          108 rather than 100: the arc is open at the bottom, so the optical
          centre of the drawn shape is above the geometric one, and type
          centred on 100 rides high in it.
        */}
        <text
          x={CX}
          y={isCard ? CY : 108}
          className="num gauge-reading"
          textAnchor="middle"
          dominantBaseline="central"
          fill={unknown ? ink : isCard ? '#FFFFFF' : band.color}
          // 60, not 64: tabular figures make "100" exactly 1.5x the width of
          // "88", and at 64 a perfect score measured 40.4px inside a 43.6px
          // well. It fit, with 1.6px a side. 60 buys the margin back.
          /*
            30 -> 40 on the hero. The dial was spending a large band of a phone
            screen to say one number, and printing that number smaller than the
            page's own subheadings. With the hub gone and the labels pushed out
            there is room in the well for the reading to be the largest thing
            in the instrument, which is what it is.
          */
          fontSize={isCard ? 60 : 48}
          fontWeight="700"
        >
          {/*
            An em dash, not a 0 and not an empty string. `health-drivers.ts`
            settled the wording for a missing driver — "a dash on its own reads
            as a bug" — which is why the sentence beneath the dial is not
            optional and says what is missing.
          */}
          {unknown ? '—' : Math.round(value)}
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
            color: ink,
            ...(isCard ? {} : { fontSize: size * 0.07, marginTop: size * 0.02 }),
          }}
        >
          {/*
            ⚠ Never a band. `getHealthBand(0)` returns a real judgement with a
            real colour, and printing it here is what put "Needs attention"
            under a car that had simply never been assessed. The unknown face
            says which of the two it is.

            "No score yet" rather than "Unknown": the *yet* is the load-bearing
            word — it tells the owner this is a gap that closes, which is what
            makes the action beneath it worth tapping.
          */}
          {unknown ? (isCard ? 'No score' : 'No score yet') : isCard ? band.short : band.label}
        </span>
      )}
    </div>
  );
}

export default ClusterGauge;
