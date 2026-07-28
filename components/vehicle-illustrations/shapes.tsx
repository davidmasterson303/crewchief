'use client';

import {
  IllustrationFrame,
  Glass,
  Seam,
  GROUND_Y,
  type VehicleIllustrationProps,
} from './VehicleIllustration';

/**
 * The twelve silhouettes.
 *
 * All side profile, **facing left**, sharing a viewBox, ground line, wheel
 * geometry and stroke weight so they swap cleanly in one card slot. Wheels are
 * identical across every four-wheeled style — the motorcycle is the sole
 * exception and says so.
 *
 * **Each shape is drawn to be distinguishable at 48px**, which is the whole
 * design constraint. That is why the differences are structural — roofline,
 * box count, bed, glass area — rather than detail. Detail disappears; a
 * silhouette does not.
 *
 * **Nothing here may resemble an identifiable production vehicle.** No
 * brand-suggestive grille, badge or light signature; no gradients; no
 * photorealism. If a car person could name one of these, it is wrong.
 */

/* -------------------------------------------------------------------------
   Three-box cars
   ---------------------------------------------------------------------- */

export function SedanIllustration(props: VehicleIllustrationProps) {
  return (
    <IllustrationFrame
      {...props}
      style="sedan"
      bodyPath="M18 61 C18 54 25 51 35 50 L64 49 L84 34 L126 33 L147 48 L178 50 C183 51 185 55 185 62 L185 72 L18 72 Z"
    >
      <Glass d="M69 48 L86 36 L123 35 L140 47 Z" />
      {/* Two seams: the four-door tell at a glance. */}
      <Seam d="M104 36 L104 71" />
      <Seam d="M131 39 L131 71" />
    </IllustrationFrame>
  );
}

export function CoupeIllustration(props: VehicleIllustrationProps) {
  return (
    <IllustrationFrame
      {...props}
      style="coupe"
      // Shorter cabin and a faster roofline than the sedan; the rear glass
      // starts where the sedan's second door would be.
      bodyPath="M18 61 C18 53 26 50 37 49 L62 48 L89 33 L117 33 L149 49 L180 51 C184 52 185 56 185 62 L185 72 L18 72 Z"
    >
      <Glass d="M67 47 L90 35 L114 35 L142 48 Z" />
      {/* One long door. */}
      <Seam d="M118 39 L118 71" />
    </IllustrationFrame>
  );
}

export function SportsIllustration(props: VehicleIllustrationProps) {
  return (
    <IllustrationFrame
      {...props}
      style="sports"
      // Low overall height, long nose, cab pushed rearward. The roof sits ~7px
      // lower than the coupe's, which is what carries the read at small sizes.
      bodyPath="M14 65 C14 58 23 55 35 54 L74 52 L101 40 L133 40 L159 53 L183 56 C187 57 188 60 188 65 L188 72 L14 72 Z"
    >
      <Glass d="M79 51 L102 42 L130 42 L152 52 Z" />
      <Seam d="M134 44 L134 71" />
    </IllustrationFrame>
  );
}

export function WagonIllustration(props: VehicleIllustrationProps) {
  return (
    <IllustrationFrame
      {...props}
      style="wagon"
      // Sedan height and nose, roof carried straight back to a near-vertical
      // tail. Contrast with the sedan is entirely in the last 40px.
      bodyPath="M18 61 C18 54 25 51 35 50 L64 49 L84 34 L164 33 C174 33 180 38 182 46 L184 57 L184 72 L18 72 Z"
    >
      <Glass d="M69 48 L86 36 L160 35 L172 47 Z" />
      <Seam d="M104 36 L104 71" />
      <Seam d="M136 36 L136 71" />
    </IllustrationFrame>
  );
}

/* -------------------------------------------------------------------------
   Two-box utilities
   ---------------------------------------------------------------------- */

export function SmallSuvIllustration(props: VehicleIllustrationProps) {
  return (
    <IllustrationFrame
      {...props}
      style="suv-small"
      // Taller and more upright than the wagon, with the body sitting higher off
      // the ground — at review these two were too close, and clearance plus a
      // steeper tail is what separates them.
      bodyPath="M22 55 C22 47 29 44 39 43 L58 42 L74 26 L138 25 L156 41 L176 43 C181 44 183 47 183 55 L183 68 L22 68 Z"
    >
      <Glass d="M62 40 L75 28 L135 27 L148 39 Z" />
      <Seam d="M104 29 L104 67" />
    </IllustrationFrame>
  );
}

export function LargeSuvIllustration(props: VehicleIllustrationProps) {
  return (
    <IllustrationFrame
      {...props}
      style="suv-large"
      // Taller and longer than the small SUV, with a third side window — the
      // cheapest way to say "three rows" in a silhouette.
      bodyPath="M15 57 C15 50 22 47 32 46 L54 45 L69 28 L153 27 L171 44 L183 46 C187 47 189 50 189 57 L189 71 L15 71 Z"
    >
      <Glass d="M58 44 L70 30 L150 29 L165 43 Z" />
      <Seam d="M99 31 L99 70" />
      <Seam d="M131 30 L131 70" />
    </IllustrationFrame>
  );
}

/* -------------------------------------------------------------------------
   Pickups — cab length and bed length are the whole distinction
   ---------------------------------------------------------------------- */

export function Pickup2DoorIllustration(props: VehicleIllustrationProps) {
  return (
    <IllustrationFrame
      {...props}
      style="pickup-2door"
      // Single cab, long open bed. The step down from roof to bed rail is the
      // shape that has to survive at 48px.
      bodyPath="M18 60 C18 53 25 50 35 49 L60 48 L78 32 L113 32 L119 51 L186 51 L186 72 L18 72 Z"
    >
      <Glass d="M65 47 L79 34 L110 34 L114 47 Z" />
      {/* Bed rail, set in from the tail so the bed reads as open. */}
      <Seam d="M126 57 L180 57" />
    </IllustrationFrame>
  );
}

export function Pickup4DoorIllustration(props: VehicleIllustrationProps) {
  return (
    <IllustrationFrame
      {...props}
      style="pickup-4door"
      // Crew cab, shorter bed — the inverse proportion of the 2-door, which is
      // how the pair reads as a pair.
      bodyPath="M18 60 C18 53 25 50 35 49 L57 48 L73 32 L133 32 L139 53 L186 53 L186 72 L18 72 Z"
    >
      <Glass d="M61 47 L74 34 L130 34 L134 47 Z" />
      <Seam d="M99 35 L99 71" />
      <Seam d="M146 59 L180 59" />
    </IllustrationFrame>
  );
}

/* -------------------------------------------------------------------------
   Vans — one-box, distinguished by nose and glass area
   ---------------------------------------------------------------------- */

export function MinivanIllustration(props: VehicleIllustrationProps) {
  return (
    <IllustrationFrame
      {...props}
      style="minivan"
      // Sloped one-box nose and a tall greenhouse. Softer than the full-size
      // van everywhere.
      bodyPath="M16 63 C16 54 23 48 35 44 L59 32 L150 30 C168 30 180 37 183 47 L185 60 L185 72 L16 72 Z"
    >
      <Glass d="M41 46 L61 34 L146 33 L160 45 Z" />
      {/* The sliding-door track, which is the minivan's one unmistakable line. */}
      <Seam d="M97 47 L149 47" />
      <Seam d="M97 35 L97 71" />
    </IllustrationFrame>
  );
}

export function VanIllustration(props: VehicleIllustrationProps) {
  return (
    <IllustrationFrame
      {...props}
      style="van"
      // Tall and slab-sided, roof carried flat the whole length. At review the
      // first version read as a wagon — the fix is height, not detail: the roof
      // is ~14px above the SUVs and the sides are vertical.
      bodyPath="M16 66 C16 48 20 34 30 28 L46 20 L174 18 C182 18 186 23 186 31 L186 72 L16 72 Z"
    >
      {/* Glass stops at the B-pillar: everything behind it is panel. That is
          the difference from the minivan and it must survive at 48px. */}
      {/* Glass stops at the B-pillar; everything behind is panel. That plus the
          height is the whole distinction from the minivan. */}
      <Glass d="M33 40 L48 24 L84 23 L84 40 Z" />
      <Seam d="M90 20 L90 71" />
    </IllustrationFrame>
  );
}

/* -------------------------------------------------------------------------
   The exceptions
   ---------------------------------------------------------------------- */

export function MotorcycleIllustration(props: VehicleIllustrationProps) {
  const r = 16;
  const front = 46;
  const rear = 154;
  const hub = GROUND_Y - r;

  return (
    <IllustrationFrame
      {...props}
      style="motorcycle"
      /*
        The only style with its own wheels — larger, exposed, and set wider
        apart. Everything that makes a motorcycle read at a glance is the gap
        between two big wheels with a small mass slung between them, so the
        first version failed by drawing too much body and not enough gap.
      */
      wheels={[
        { x: front, r },
        { x: rear, r },
      ]}
      // Tank into seat into tail, as one low mass that does not reach either
      // wheel. Kept clear of the hubs so the wheels stay visibly open.
      bodyPath="M74 54 C82 44 96 40 112 40 L128 40 C136 40 140 43 141 49 L143 58 C144 62 141 64 136 64 L86 64 C76 64 70 60 74 54 Z"
    >
      {/*
        Fork, bars and the rear shock. Strokes rather than fill, because a
        motorcycle frame is open by nature and filling it would read as a
        scooter.
      */}
      <Seam d={`M${front} ${hub} L66 46 L62 34`} />
      {/* Handlebar. */}
      <Seam d="M52 33 L74 31" />
      {/* Rear suspension down to the hub. */}
      <Seam d={`M132 62 L${rear - 6} ${hub - 3}`} />
      {/* Engine mass under the tank, which is what fills the frame visually. */}
      <Seam d="M92 64 L100 74 L124 74 L130 64" />
    </IllustrationFrame>
  );
}

export function GenericVehicleIllustration(props: VehicleIllustrationProps) {
  return (
    <IllustrationFrame
      {...props}
      style="generic"
      // Deliberately the plainest shape in the set. This is what an unmapped
      // body class gets, so it must look intentional rather than like a
      // failure — no seams, no character, just a vehicle.
      bodyPath="M20 61 C20 53 27 50 37 49 L66 48 L87 35 L130 34 L151 48 L180 50 C184 51 186 55 186 61 L186 72 L20 72 Z"
    >
      <Glass d="M71 47 L88 37 L127 36 L145 47 Z" />
    </IllustrationFrame>
  );
}
