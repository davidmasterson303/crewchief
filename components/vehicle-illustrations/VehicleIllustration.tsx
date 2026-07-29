'use client';

import type { VehicleBodyStyle } from '@crewchief/core/vehicle-body-style';
import { BODY_STYLE_LABEL } from '@crewchief/core/vehicle-body-style';

/**
 * The shared frame and the proportion grid every vehicle illustration draws
 * against.
 *
 * ── Why a grid ─────────────────────────────────────────────────────────────
 *
 * Pass 1 gave all twelve shapes the same stance, and at 48px sedan / coupe /
 * sports / small SUV / wagon / generic were interchangeable. Body type is
 * carried by **height and stance**, not by detail — detail is the first thing
 * to disappear when the art is 48px wide. So the grid is defined here, once,
 * and every silhouette is seated on it. Per-file magic numbers are what let the
 * set drift in the first place.
 *
 * Three roof heights and two ground clearances give six stance combinations,
 * which is enough to separate the whole set structurally before a single line
 * of detail is drawn.
 *
 * ── Colour rules, enforced where they are used ─────────────────────────────
 *
 * - **No literal colour values anywhere in this directory.** Every fill and
 *   stroke resolves through a design token, so a theme change propagates and a
 *   warm tint cannot be invented locally. `illustration-tokens.test.ts` fails
 *   the build if a hex, rgb(), oklch() or a raw hsl() appears here.
 * - **Cyan is reserved for actions.** The "Add a photo" affordance on the card
 *   *is* the action; it lives in the card component, not in here.
 * - **The health ramp means a health score** and nothing else.
 * - **Nothing identifiable.** If a car person could name a production model
 *   from one of these, it is wrong and gets redrawn.
 */

export const VIEW_BOX = '0 0 200 96';

/** Where every vehicle stands. Shared so the set never appears to float. */
export const GROUND_Y = 84;

/**
 * Roof height — the y of the highest point of the body. Smaller y is taller.
 *
 * Three values, not a continuum. A continuum is how pass 1 ended up with six
 * shapes within a few pixels of each other; discrete steps force a visible
 * difference, or force a shape into a different group.
 */
export const ROOF = {
  LOW: 44,
  STANDARD: 34,
  TALL: 22,
} as const;

/**
 * Ground clearance — the y of the bottom of the body.
 *
 * `RAISED` sits 6px higher, which with the larger wheel leaves visible air
 * under the body. That air is the single clearest "this is a truck or an SUV"
 * signal available in a silhouette.
 */
export const SILL = {
  CAR: 72,
  RAISED: 66,
} as const;

/** Wheels stay uniform within a stance group; RAISED gets one step larger. */
export const WHEEL_R = {
  CAR: 11,
  RAISED: 13,
} as const;

/** Wheel centres, shared by every four-wheeled style so they read as a set. */
export const FRONT_AXLE_X = 50;
export const REAR_AXLE_X = 152;

const WHEEL_INNER_RATIO = 0.4;
const STROKE = 2.4;

export type RoofHeight = keyof typeof ROOF;
export type Stance = keyof typeof SILL;

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
  /**
   * Which clearance group this shape belongs to. Drives wheel radius, and is
   * asserted against the body path by the grid conformance test — the bottom of
   * the path must equal `SILL[stance]`.
   */
  stance: Stance;
  /** Closed outline of the body, in viewBox coordinates, **facing left**. */
  bodyPath: string;
  /** Glass, seams and secondary masses drawn over the body. */
  children?: React.ReactNode;
  /**
   * Motorcycles set their own wheels and opt out of the stance grid; nothing
   * else may.
   */
  wheels?: Array<{ x: number; r: number }>;
}

export function IllustrationFrame({
  style,
  stance,
  bodyPath,
  children,
  wheels,
  tint,
  size = 200,
  className,
}: FrameProps) {
  const titleId = `veh-illus-${style}`;
  const r = WHEEL_R[stance];
  const axles = wheels ?? [
    { x: FRONT_AXLE_X, r },
    { x: REAR_AXLE_X, r },
  ];

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

      {/* Wheels last, drawn *over* the body — arch cutouts turn to mud at 48px. */}
      {axles.map(({ x, r: wheelR }) => (
        <g key={x}>
          <circle
            cx={x}
            cy={GROUND_Y - wheelR}
            r={wheelR}
            fill="hsl(var(--background))"
            stroke="hsl(var(--muted-foreground))"
            strokeWidth={STROKE}
          />
          <circle
            cx={x}
            cy={GROUND_Y - wheelR}
            r={wheelR * WHEEL_INNER_RATIO}
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
 * **Lighter than the body, not darker.** Pass 1 filled the greenhouse with
 * `--background` — 6% lightness against a 14% body, an eight-point delta that
 * vanished at card size and took the van-versus-wagon distinction with it.
 * Glass now reads *up* the ramp instead: `--muted-foreground` at low opacity
 * lands around 26% over the body, far enough from both the body (14%) and the
 * card behind it (11%) to survive 48px. It is the same token as the stroke, so
 * the set still resolves to two greys plus the ground.
 */
export function Glass({ d }: { d: string }) {
  return <path d={d} fill="hsl(var(--muted-foreground))" stroke="none" opacity={0.32} />;
}

/**
 * A second filled mass in body colour — a motorcycle seat, a tonneau.
 *
 * Same fill and stroke as the body so it reads as one object rather than an
 * applied decal.
 */
export function Panel({ d }: { d: string }) {
  return (
    <path
      d={d}
      fill="hsl(var(--secondary))"
      stroke="hsl(var(--muted-foreground))"
      strokeWidth={STROKE}
      strokeLinejoin="round"
      strokeLinecap="round"
    />
  );
}

/**
 * Exposed structure that *is* the silhouette, at full body weight.
 *
 * ── Why this is not `Seam` ──────────────────────────────────────────────────
 *
 * `Seam` is deliberately faint at 1.6 because a door line or a bed break is
 * detail drawn *on* a mass — it should recede, and on eleven of the twelve
 * shapes that is right.
 *
 * The motorcycle has no mass to draw on. Its fork, bars, frame triangle and
 * shock are not markings on a body; they are the body. Drawing them with the
 * recede-into-the-background primitive is a category error, and it showed:
 * rev 1's own review flagged the fork and bars reading as "thin floating
 * strokes" at 200px. They were, because they were drawn at seam weight while
 * doing silhouette work.
 *
 * Same token, same cap, same join as `Panel` — only the weight differs, so the
 * set still resolves to two greys plus the ground.
 */
export function Strut({ d }: { d: string }) {
  return (
    <path
      d={d}
      stroke="hsl(var(--muted-foreground))"
      strokeWidth={STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  );
}

/** A door seam, bed line or frame member. Deliberately faint — structure, not decoration. */
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
