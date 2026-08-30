'use client';

import type { VehicleBodyStyle } from '@wellkept/core/vehicle-body-style';
import {
  IllustrationFrame,
  Glass,
  Panel,
  Seam,
  Strut,
  ROOF,
  SILL,
  type RoofHeight,
  type Stance,
  type VehicleIllustrationProps,
} from './VehicleIllustration';

/**
 * The twelve silhouettes, seated on the shared proportion grid.
 *
 * All side profile, **facing left**, sharing a viewBox, ground line, wheel
 * geometry and stroke weight so they swap cleanly in one card slot.
 *
 * ── Facing left, and what that requires ────────────────────────────────────
 *
 * Nose at low x, tail at high x. Two rules make the direction readable rather
 * than merely asserted, and both are checked by `illustration-grid.test.ts`:
 *
 *   1. **The nose is shorter than the tail.** The body's leading edge sits
 *      closer to the sill than its trailing edge, so the front reads as a hood
 *      and the rear as a deck or tailgate.
 *   2. **No shape is front/rear symmetric.** Where a shape has a windshield and
 *      a rear window, the windshield is the more raked of the two.
 *
 * ── Distinguishable at 48px ────────────────────────────────────────────────
 *
 * That is the whole design constraint, and pass 1 failed it: six shapes were
 * interchangeable because they shared a stance. Differences are therefore
 * structural first — roof height, clearance, box count, bed, glass area — and
 * detail second. Detail disappears at 48px; a stance does not.
 *
 * **Nothing here may resemble an identifiable production vehicle.** No
 * brand-suggestive grille, badge or light signature; no gradients; no
 * photorealism. If a car person could name one of these, it is wrong.
 */

/**
 * Where each style sits on the grid. One registry, read by both the components
 * and the conformance test, so a shape cannot quietly drift off the grid.
 *
 * `roof: null` means deliberately unassigned rather than unchecked — the
 * generic fallback is meant to commit to no body type, and the motorcycle is
 * the set's one geometric exception.
 */
export const GRID: Record<
  VehicleBodyStyle,
  { roof: RoofHeight | null; stance: Stance | null }
> = {
  sedan: { roof: 'STANDARD', stance: 'CAR' },
  coupe: { roof: 'STANDARD', stance: 'CAR' },
  sports: { roof: 'LOW', stance: 'CAR' },
  wagon: { roof: 'STANDARD', stance: 'CAR' },
  'suv-small': { roof: 'TALL', stance: 'RAISED' },
  'suv-large': { roof: 'TALL', stance: 'RAISED' },
  'pickup-2door': { roof: 'TALL', stance: 'RAISED' },
  'pickup-4door': { roof: 'TALL', stance: 'RAISED' },
  minivan: { roof: 'TALL', stance: 'CAR' },
  van: { roof: 'TALL', stance: 'CAR' },
  // The abstract fallback: no roof group, car clearance.
  generic: { roof: null, stance: 'CAR' },
  // Opts out of the grid entirely; see the note on the component.
  motorcycle: { roof: null, stance: null },
};

/* -------------------------------------------------------------------------
   Three-box cars — ROOF.STANDARD / SILL.CAR unless noted
   ---------------------------------------------------------------------- */

export function SedanIllustration(props: VehicleIllustrationProps) {
  return (
    <IllustrationFrame
      {...props}
      style="sedan"
      stance="CAR"
      /*
        The reference three-box. Roof plateau x=88→124 sits over the rear seat;
        the raked windshield (22px of run) against the steeper rear glass (17px)
        is what makes the nose read as the nose.
      */
      bodyPath="M16 62 C16 57 21 55 30 54 L66 53 L88 34 L124 34 L141 50 L182 52 L186 57 L186 72 L16 72 Z"
    >
      <Glass d="M70 52 L89 36 L122 36 L138 49 Z" />
      {/* Two seams: the four-door tell at a glance. */}
      <Seam d="M103 37 L103 71" />
      <Seam d="M130 41 L130 71" />
    </IllustrationFrame>
  );
}

export function CoupeIllustration(props: VehicleIllustrationProps) {
  return (
    <IllustrationFrame
      {...props}
      style="coupe"
      stance="CAR"
      /*
        Sedan height — deliberately, because the coupe's job is to be clearly
        *taller* than the sports car while still being clearly quicker than the
        sedan. That quickness comes from the roof plateau, 22px against the
        sedan's 36px, not from dropping the roofline into the sports car's lane.
      */
      bodyPath="M16 62 C16 56 21 54 30 53 L68 52 L92 34 L114 34 L137 50 L180 52 L186 57 L186 72 L16 72 Z"
    >
      <Glass d="M72 51 L93 36 L112 36 L134 49 Z" />
      {/* One long door, seam at the B-pillar. */}
      <Seam d="M116 37 L116 71" />
    </IllustrationFrame>
  );
}

export function SportsIllustration(props: VehicleIllustrationProps) {
  return (
    <IllustrationFrame
      {...props}
      style="sports"
      stance="CAR"
      /*
        The set's only LOW roof — 10px under the coupe, which is what finally
        separates the pair that pass 1 drew as twins. Also the widest stance
        (x=10→191 against the coupe's 16→186), a long raked nose, and the cabin
        pushed rearward: plateau centre x=120 against a wheelbase centre of 101.
      */
      bodyPath="M10 67 C10 62 15 60 24 59 L84 57 L108 44 L132 44 L154 58 L186 60 L191 65 L191 72 L10 72 Z"
    >
      <Glass d="M88 56 L109 46 L130 46 L150 57 Z" />
      <Seam d="M134 47 L134 71" />
    </IllustrationFrame>
  );
}

export function WagonIllustration(props: VehicleIllustrationProps) {
  return (
    <IllustrationFrame
      {...props}
      style="wagon"
      stance="CAR"
      /*
        Sedan nose and roof height, then the roof runs flat to x=168 and drops
        near-vertically. Against the sedan the difference is 44px of extra roof
        and a 27px tail face — structural, so it survives 48px where pass 1's
        version did not.
      */
      bodyPath="M16 62 C16 57 21 55 30 54 L66 53 L88 34 L168 34 C176 34 181 38 182 45 L182 72 L16 72 Z"
    >
      <Glass d="M70 52 L89 36 L166 36 L175 46 Z" />
      <Seam d="M103 37 L103 71" />
      <Seam d="M134 37 L134 71" />
    </IllustrationFrame>
  );
}

/* -------------------------------------------------------------------------
   Two-box utilities — ROOF.TALL / SILL.RAISED
   ---------------------------------------------------------------------- */

export function SmallSuvIllustration(props: VehicleIllustrationProps) {
  return (
    <IllustrationFrame
      {...props}
      style="suv-small"
      stance="RAISED"
      /*
        Pass 1's read as a sedan because it shared the sedan's stance. Now TALL
        + RAISED: 44px of body height against the sedan's 38, on the larger
        wheel, with 18px of air under the sill. Short overhangs (24px either
        side of the axles) and an upright tailgate keep it compact.
      */
      bodyPath="M26 54 C26 48 31 46 38 45 L60 44 L80 22 L152 22 L170 29 L172 66 L26 66 Z"
    >
      <Glass d="M64 43 L81 24 L146 24 L160 32 Z" />
      {/* One seam — two window bays, against the large SUV's three. */}
      <Seam d="M110 25 L110 65" />
    </IllustrationFrame>
  );
}

export function LargeSuvIllustration(props: VehicleIllustrationProps) {
  return (
    <IllustrationFrame
      {...props}
      style="suv-large"
      stance="RAISED"
      /*
        Pass 1 read as a limo because it was long *and* low. Same TALL + RAISED
        stance as the small SUV — the pair are meant to share a stance — with
        176px of length against 146px and a third side window, which is the
        cheapest way to say "three rows" in a silhouette.
      */
      bodyPath="M12 55 C12 49 17 47 24 46 L58 45 L76 22 L168 22 L186 29 L188 66 L12 66 Z"
    >
      <Glass d="M62 44 L77 24 L164 24 L179 31 Z" />
      <Seam d="M104 25 L104 65" />
      <Seam d="M138 25 L138 65" />
    </IllustrationFrame>
  );
}

/* -------------------------------------------------------------------------
   Pickups — cab length against bed length is the whole distinction
   ---------------------------------------------------------------------- */

export function Pickup2DoorIllustration(props: VehicleIllustrationProps) {
  return (
    <IllustrationFrame
      {...props}
      style="pickup-2door"
      stance="RAISED"
      /*
        Single cab (plateau 76→104), long bed (110→186, 76px). The 24px step
        down from cab roof to bed rail is the shape that has to survive 48px,
        and it is the largest single step in the set.
      */
      bodyPath="M20 54 C20 48 25 46 32 45 L58 44 L76 22 L104 22 L110 46 L186 46 L186 66 L20 66 Z"
    >
      <Glass d="M62 43 L77 24 L101 24 L106 43 Z" />
      {/* Bed rail, inset from the tail so the bed reads as open. */}
      <Seam d="M120 53 L178 53" />
    </IllustrationFrame>
  );
}

export function Pickup4DoorIllustration(props: VehicleIllustrationProps) {
  return (
    <IllustrationFrame
      {...props}
      style="pickup-4door"
      stance="RAISED"
      /*
        Crew cab (plateau 72→130), shorter bed (136→186, 50px) — the inverse
        proportion of the 2-door, which is how the pair reads as a pair. Pass 1
        lost the bed almost entirely and read as a sedan; the break behind the
        cab is now the same full 24px drop as the 2-door's, so the bed is
        unmistakable even though it is a third shorter.
      */
      bodyPath="M20 54 C20 48 25 46 32 45 L54 44 L72 22 L130 22 L136 46 L186 46 L186 66 L20 66 Z"
    >
      <Glass d="M58 43 L73 24 L127 24 L132 43 Z" />
      <Seam d="M100 25 L100 65" />
      <Seam d="M146 53 L178 53" />
    </IllustrationFrame>
  );
}

/* -------------------------------------------------------------------------
   Vans — ROOF.TALL / SILL.CAR. Tall but not raised, which is the whole
   difference from the SUVs.
   ---------------------------------------------------------------------- */

export function MinivanIllustration(props: VehicleIllustrationProps) {
  return (
    <IllustrationFrame
      {...props}
      style="minivan"
      stance="CAR"
      /*
        One box with a long sloped nose: the leading edge climbs from y=63 at
        x=16 to the roof at x=58, a 42px ramp that nothing else in the set has.
        Tail tapers rather than standing vertical, which is the read against the
        full-size van.
      */
      bodyPath="M16 63 C16 55 22 50 33 46 L58 23 L156 22 C170 22 180 29 183 39 L185 52 L185 72 L16 72 Z"
    >
      <Glass d="M40 45 L60 25 L152 24 L166 36 Z" />
      {/* The sliding-door track, the minivan's one unmistakable line. */}
      <Seam d="M100 44 L152 44" />
      <Seam d="M98 25 L98 71" />
    </IllustrationFrame>
  );
}

export function VanIllustration(props: VehicleIllustrationProps) {
  return (
    <IllustrationFrame
      {...props}
      style="van"
      stance="CAR"
      /*
        Slab-sided, roof flat from x=44 to x=178, tail dead vertical for 42px.
        The nose is short and steep rather than absent — a fully vertical front
        would leave the shape front/rear ambiguous, which is the one thing a
        silhouette cannot afford.
      */
      bodyPath="M14 60 C14 44 18 34 26 30 L44 22 L178 22 C184 22 186 25 186 30 L186 72 L14 72 Z"
    >
      {/*
        Glass stops at the B-pillar; everything behind it is panel. That plus
        the flat roof is the whole distinction from the minivan, whose glass
        runs the full length.
      */}
      <Glass d="M30 40 L46 24 L84 24 L84 40 Z" />
      <Seam d="M90 23 L90 71" />
    </IllustrationFrame>
  );
}

/* -------------------------------------------------------------------------
   The exceptions
   ---------------------------------------------------------------------- */

export function MotorcycleIllustration(props: VehicleIllustrationProps) {
  const r = 16;
  const front = 48;
  const rear = 152;
  const hub = 84 - r;

  return (
    <IllustrationFrame
      {...props}
      style="motorcycle"
      // Stance is nominal: the wheel override below replaces the grid entirely,
      // and GRID records this as the set's one exception.
      stance="CAR"
      wheels={[
        { x: front, r },
        { x: rear, r },
      ]}
      /*
        Pass 1 read as a scooter because it was a single closed blob between the
        wheels. What makes a motorcycle read is the *open* structure: a fuel
        tank, a step down to the seat, an exposed frame triangle and a long
        angled fork. So the tank is the only closed mass, and everything else is
        stroke — which is also why this is the one shape that needs `Panel`.
      */
      bodyPath="M82 56 C84 45 94 41 108 41 L120 41 C126 41 129 44 130 49 L131 57 C131 60 128 61 124 61 L88 61 C83 61 80 60 82 56 Z"
    >
      {/* Seat and tail, stepped down off the back of the tank. */}
      <Panel d="M129 49 L150 47 L155 41 L158 44 L153 53 C152 56 149 57 145 57 L130 57 Z" />
      {/*
        Fork, bars, frame and shock are `Strut`, not `Seam`.

        On every other shape a stroke is detail drawn on a mass. Here there is
        no mass — these lines *are* the motorcycle, and at seam weight they read
        as thin floating strokes rather than structure. Body weight is what
        makes them silhouette. The engine line below stays a `Seam`, because it
        is the one mark here that really is detail inside the frame triangle.
      */}
      <Strut d={`M${front} ${hub} L74 38`} />
      <Strut d="M74 38 L75 33" />
      <Strut d="M64 34 L86 32" />
      <Strut d="M92 61 L108 76 L128 60" />
      <Seam d="M100 70 L124 70" />
      <Strut d={`M128 57 L${rear - 8} ${hub - 6}`} />
    </IllustrationFrame>
  );
}

export function GenericVehicleIllustration(props: VehicleIllustrationProps) {
  return (
    <IllustrationFrame
      {...props}
      style="generic"
      stance="CAR"
      /*
        Pass 1 drew this as a second sedan, so an unmapped body class looked
        like a wrong answer rather than no answer. It is now the only shape in
        the set with no roof plateau, no window seams and no straight panels —
        one continuous arc. Deliberately more abstract than everything else, so
        it reads "vehicle, unspecified" rather than "sedan". It still obeys the
        direction rule: the nose ramp is 88px against a 12px tail face.
      */
      bodyPath="M16 66 C16 50 46 38 104 38 C150 38 178 47 180 60 L180 72 L16 72 Z"
    >
      <Glass d="M50 53 C62 45 80 42 104 42 C128 42 146 46 156 53 Z" />
    </IllustrationFrame>
  );
}
