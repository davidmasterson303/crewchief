'use client';

import type { VehicleBodyStyle } from '@crewchief/core/vehicle-body-style';
import { BODY_STYLE_LABEL } from '@crewchief/core/vehicle-body-style';

/**
 * The shared frame every vehicle illustration draws inside.
 *
 * ── The rules these obey, restated where they are enforced ──────────────────
 *
 * - **Warm graphite only.** Fills and strokes come from design tokens, never
 *   hex, so a theme change propagates. No cyan: cyan is reserved for actions,
 *   and the "Add a photo" affordance on the card *is* the action — it lives in
 *   the card component, not in here.
 * - **No health-ramp colours.** That ramp means a health score and nothing else.
 * - **Nothing identifiable.** Shapes are deliberately generic. If a car person
 *   could name a specific production model from one of these, it is wrong and
 *   gets redrawn. Generic is the requirement, not a compromise.
 *
 * ── Why one frame ──────────────────────────────────────────────────────────
 *
 * A shared `viewBox`, ground line, wheel geometry and stroke weight are what
 * let twelve different shapes swap cleanly in the same card slot without the
 * card jumping. They are constants here rather than repeated per shape,
 * because a set that drifts is worse than a set that is plain.
 *
 * ── Legibility at 48px ─────────────────────────────────────────────────────
 *
 * These ship in the Expo garage view too. Everything is a solid shape with one
 * stroke weight and no gradients, and wheels are drawn *over* the body rather
 * than cut out of it — arch cutouts turn to mud at small sizes.
 */

export const VIEW_BOX = '0 0 200 96';
/** Where every vehicle stands. Shared so the set never appears to float. */
export const GROUND_Y = 84;
const WHEEL_R = 11;
const WHEEL_INNER_R = 4.4;
const STROKE = 2.4;

/** Wheel centres, shared by every four-wheeled style so they read as a set. */
export const FRONT_AXLE_X = 50;
export const REAR_AXLE_X = 152;

export interface VehicleIllustrationProps {
  /**
   * The user's vehicle colour, if known. Applied to the body panel only and
   * heavily muted — this sits *within* the graphite palette rather than
   * reproducing paint. A card should never look like it holds a real photo.
   */
  tint?: string | null;
  /** Rendered size in px. The art is resolution-independent. */
  size?: number;
  className?: string;
}

interface FrameProps extends VehicleIllustrationProps {
  style: VehicleBodyStyle;
  /** Closed outline of the body, in viewBox coordinates, facing left. */
  bodyPath: string;
  /** Glass, seams and other detail drawn over the body. */
  children?: React.ReactNode;
  /** Motorcycles set their own wheels; everything else uses the shared pair. */
  wheels?: Array<{ x: number; r?: number }>;
}

export function IllustrationFrame({
  style,
  bodyPath,
  children,
  wheels = [{ x: FRONT_AXLE_X }, { x: REAR_AXLE_X }],
  tint,
  size = 200,
  className,
}: FrameProps) {
  const titleId = `veh-illus-${style}`;

  return (
    <svg
      viewBox={VIEW_BOX}
      width={size}
      height={(size * 96) / 200}
      role="img"
      aria-labelledby={titleId}
      className={className}
      fill="none"
    >
      <title id={titleId}>{`Illustration of a ${BODY_STYLE_LABEL[style]}`}</title>

      {/* The ground. Low contrast on purpose — it anchors, it should not read
          as part of the vehicle. */}
      <line
        x1={6}
        y1={GROUND_Y}
        x2={194}
        y2={GROUND_Y}
        stroke="hsl(var(--border))"
        strokeWidth={STROKE}
        strokeLinecap="round"
      />

      <path
        d={bodyPath}
        fill="hsl(var(--secondary))"
        stroke="hsl(var(--muted-foreground))"
        strokeWidth={STROKE}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/*
        Tint sits *over* the graphite body at low opacity rather than replacing
        it. A real paint colour at full saturation would fight the palette and
        make the placeholder read as a photograph.
      */}
      {tint ? <path d={bodyPath} fill={tint} opacity={0.22} /> : null}

      {children}

      {wheels.map(({ x, r = WHEEL_R }) => (
        <g key={x}>
          <circle
            cx={x}
            cy={GROUND_Y - r}
            r={r}
            fill="hsl(var(--background))"
            stroke="hsl(var(--muted-foreground))"
            strokeWidth={STROKE}
          />
          <circle
            cx={x}
            cy={GROUND_Y - r}
            r={r === WHEEL_R ? WHEEL_INNER_R : r * 0.4}
            fill="hsl(var(--muted-foreground))"
            opacity={0.5}
          />
        </g>
      ))}
    </svg>
  );
}

/**
 * Glass.
 *
 * `--background` rather than `--card`: card sits only one step below the body
 * fill and the greenhouse disappeared entirely at review size. The darkest
 * surface token is what makes glass read as recessed rather than painted, and
 * the greenhouse is most of what distinguishes a van from a wagon.
 */
export function Glass({ d }: { d: string }) {
  return <path d={d} fill="hsl(var(--background))" stroke="none" opacity={0.85} />;
}

/** A door seam or bed line. Deliberately faint — structure, not decoration. */
export function Seam({ d }: { d: string }) {
  return (
    <path
      d={d}
      stroke="hsl(var(--muted-foreground))"
      strokeWidth={1.6}
      strokeLinecap="round"
      opacity={0.55}
      fill="none"
    />
  );
}
