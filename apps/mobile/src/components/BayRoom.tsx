import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, {
  Defs,
  Ellipse,
  LinearGradient,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';

import { TARGET_MIN, bay, border, radius, space, surface, text, type } from '../theme';
import { interFace } from '../theme/fonts';

/**
 * The lit room a car stands in.
 *
 * ── Why this is not `VehiclePlate` at another size ──────────────────────────
 *
 * The plate is a **card treatment**: a make-derived field with the vehicle named
 * on it, so a garage of unphotographed cars still reads as a set of distinct
 * objects. The bay is a **place**. One car, lit from above, and the light is
 * the same light for every car in the garage — a room whose colour changed per
 * make would read as a lightbox, not a garage.
 *
 * So they share no paint. `vehicleFieldStops` is deliberately absent here.
 *
 * ── The lighting stack, from the baseline board ─────────────────────────────
 *
 * `radial-gradient(130% 110% at 50% 16%, #2a2724, #111214 74%)` — the source is
 * up near the ceiling and slightly forward, which is where a garage strip light
 * actually is, and the fall-off reaches the far corners rather than vignetting
 * hard. Rendered as SVG because React Native's StyleSheet has no gradient.
 *
 * ⚠ The gradient is wider than it is tall in *percentage* terms (130% × 110%),
 * which an SVG radial cannot say directly — it takes one radius. The ellipse
 * ratio is restored with `gradientTransform`, because scaling the whole `<Rect>`
 * instead would scale the wordmark sitting on it.
 *
 * ── 23 Aug: the room became a hero, and why every part of that changed ──────
 *
 * It was a 112pt inset panel with the photograph **contained** inside it. On a
 * 393pt screen that gave a landscape photo roughly 149 × 112 of actual car,
 * centred in a box with dead gradient either side — a thumbnail on the one
 * screen whose entire argument is *"one car in a lit room"*. Manual testing
 * called it exactly what it was.
 *
 * Three changes, and they only work together:
 *
 *   - **Full bleed.** No border, no corner radius, no page inset. The room is
 *     now the width of the phone, and the bay's other rows carry the inset that
 *     used to live on the whole stack.
 *   - **contain-over-blur**, lifted from web's `VehicleIdentity` rather than
 *     invented here. A sharp *contained* copy over an over-scanned *blurred*
 *     copy of itself. This is the part that makes the extra size safe: filling
 *     a wide box by cropping `cover` is what web removed in CC-142, because on
 *     a 3:4 phone photo — the overwhelmingly common upload — a centre crop
 *     enlarges ~3× and keeps a horizontal band through the vertical middle,
 *     which is sky, ceiling or strip lights. The car was frequently not in the
 *     hero at all. Contained over its own blur, a DSLR landscape and a vertical
 *     phone snapshot both land whole.
 *   - **A fade into the page**, so the identity lockup underneath has somewhere
 *     to sit. See `HERO_FADE` for why this is a fade to an opaque colour rather
 *     than a scrim over the photograph.
 *
 * `Image`'s `blurRadius` is a core React Native prop on both platforms, so the
 * blurred layer costs no native module and therefore no EAS build.
 */

/**
 * The framed room's height, kept as the floor of the hero range.
 *
 * Exported because the bay's door travels exactly the hero's height. A shutter
 * that lifts 112 over a room of 240 leaves a band of door on screen forever,
 * which is why this number and the door's are the same number.
 */
export const BAY_ROOM_HEIGHT = 112;

/** The tallest the hero goes, on the tallest phone. */
export const BAY_HERO_MAX = 240;
/** The shortest it goes, below which it is a strip again. */
export const BAY_HERO_MIN = 168;

/**
 * How tall the hero is on a given screen.
 *
 * ⚠ **Keyed to the window's height, not its width**, because the constraint is
 * vertical: the bay has to fit a batten, this room, an identity lockup, a
 * next-service row and a 164pt instrument, and the instrument is the one thing
 * that must not fall below the fold. A fixed 240 fits an iPhone 15 with room to
 * spare and pushes the dial off the bottom of an SE.
 *
 * 0.28 lands exactly on `BAY_HERO_MAX` at 852pt (the 15/16 Pro), which is the
 * device this was designed against — the clamp is what protects the two ends
 * rather than what does the work in the middle.
 */
export function bayHeroHeight(windowHeight: number): number {
  return Math.round(Math.min(BAY_HERO_MAX, Math.max(BAY_HERO_MIN, windowHeight * 0.28)));
}

/**
 * How far up from the bottom the room dissolves into the page.
 *
 * ⚠ **This is a fade to an opaque colour, not a scrim over a photograph**, and
 * the distinction is the whole reason it is safe to put the car's name beneath
 * it. `DiagnosticHero` on web carries the measurement that settled this: the
 * hero it replaced composited a photograph through six layers and passed ~1.7%
 * of it at the bottom edge. The rule that came out of that is *nothing is
 * printed over a photograph* — so the fade reaches `surface.page` at full
 * opacity, the lockup sits below where it has landed, and the ink is measured
 * against the page exactly as the contrast harness assumes.
 *
 * A translucent scrim would be the version that fails: its real contrast would
 * depend on whatever the owner happened to photograph, which is unmeasurable
 * and is where the 1.09:1 advisor button came from.
 */
const HERO_FADE = 84;

/**
 * How far the sharp copy is held clear of the bottom edge.
 *
 * The contained photo centres in whatever box it is given, so without this it
 * would centre across the fade and lose its wheels in it. Lifting the box
 * instead of shortening the fade keeps the dissolve long enough to read as one.
 */
const SHARP_INSET = 44;

/**
 * The blurred fill is drawn past the edges rather than to them.
 *
 * React Native's `blurRadius` samples inside the view's bounds, so an unscaled
 * blurred layer feathers into its own transparent border and leaves a visible
 * lighter rim on all four sides. Over-scanning pushes that artefact off-screen,
 * which is the same thing web's `scale(1.1)` on the blur layer is doing.
 */
const BLUR_OVERSCAN = 1.16;

export default function BayRoom({
  photo,
  make,
  onAddPhoto,
  busy = false,
  height = BAY_HERO_MAX,
}: {
  photo?: string | null;
  make?: string | null;
  /** Omitted means no control — see `VehiclePlate` for why that is not a failure. */
  onAddPhoto?: () => void;
  busy?: boolean;
  height?: number;
}) {
  /*
    The wordmark, and it is the make alone.

    Not the model, and not the full name — those sit directly beneath the room
    in their own lockup, and repeating them inside it would be the card body's
    duplication problem moved one screen along. At 0.2em tracking a make reads
    as signage on the back wall, which is the whole idea.
  */
  const wordmark = (make ?? '').trim().toUpperCase();

  return (
    <View style={[styles.room, { height }]}>
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient
            id="bayRoom"
            cx="0.5"
            cy="0.16"
            r="0.65"
            /*
              `130% 110%` around a point at `50% 16%`. The transform stretches
              the circle to that ratio about its own centre — SVG has no
              two-radius radial, and scaling the rect would take the wordmark
              with it.
            */
            gradientTransform="translate(0.5 0.16) scale(2 1.69) translate(-0.5 -0.16)"
          >
            <Stop offset="0" stopColor={bay.roomNear} />
            <Stop offset="0.74" stopColor={bay.roomFar} />
            <Stop offset="1" stopColor={bay.roomFar} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#bayRoom)" />
      </Svg>

      {photo ? (
        <>
          {/*
            The fill. Same file as the sharp copy, deliberately — there is no
            32px placeholder for an owner upload the way `vehicle-blur.ts` has
            one for the demo photographs, because a signed URL covers one
            specific object and a derived path would 403. Decoding it twice is
            the cost; at a 32px blur radius nobody can tell which copy is which,
            and the alternative is a hero with dead gradient down both sides.
          */}
          <Image
            source={{ uri: photo }}
            style={[StyleSheet.absoluteFill, styles.fill]}
            resizeMode="cover"
            blurRadius={32}
            /*
              Decorative: it is the same photograph as the layer above, and a
              screen reader announcing the car twice is worse than not
              announcing the blur at all.
            */
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
          <Image
            source={{ uri: photo }}
            style={[StyleSheet.absoluteFill, styles.sharp]}
            /*
              `contain`. The room holds the car; it does not crop it. This is
              the decision CC-142 made on web and the reason the focal-point
              anchor could be deleted rather than tuned — a crop the owner
              cannot see the edges of is a crop that puts their car off-frame.
            */
            resizeMode="contain"
            accessibilityRole="image"
            accessibilityLabel={make ? `${make} photo` : 'Vehicle photo'}
          />
        </>
      ) : wordmark ? (
        <Text style={[styles.wordmark, { marginBottom: SHARP_INSET }]} numberOfLines={1}>
          {wordmark}
        </Text>
      ) : null}

      {/*
        The dissolve. Drawn over the photograph and under the controls, so the
        room ends in the page colour rather than at an edge.
      */}
      <Svg
        width="100%"
        height={HERO_FADE}
        style={styles.fade}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Defs>
          <LinearGradient id="bayFade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={surface.page} stopOpacity={0} />
            <Stop offset="0.55" stopColor={surface.page} stopOpacity={0.82} />
            <Stop offset="1" stopColor={surface.page} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#bayFade)" />
      </Svg>

      {onAddPhoto ? (
        <Pressable
          onPress={onAddPhoto}
          disabled={busy}
          /*
            ⚠ Top right, not bottom right. It moved with the hero: the bottom
            of this room is now the fade the car's name lands in, and a pill
            parked there either collides with the name on a long one or forces
            the name to dodge it. The top corner is the one part of a hero that
            is reliably empty, because a contained photograph centres.

            A fill swap on press, matching `Button`'s `quiet` step — raised at
            rest, well when pressed. A control sitting on an unknown photograph
            has to acknowledge the tap with its own surface; fading it would
            take the label with it, which is the rule this app removed group
            opacity for.
          */
          style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
          accessibilityRole="button"
          accessibilityState={{ busy, disabled: busy }}
          accessibilityLabel={photo ? 'Change photo' : 'Add photo'}
        >
          <Text style={styles.actionLabel}>{photo ? 'Change photo' : 'Add photo'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * The pool of light the dial stands in.
 *
 * Board: a 220×22 strip carrying
 * `radial-gradient(ellipse 62% 100% at 50% 0%, rgb(34 211 238 / 0.14), transparent 72%)`
 * — hung from the *top* edge, so it reads as light falling from the instrument
 * rather than a shadow under it. That is why it is not a shadow: a dial that
 * cast one would be an object sitting on a surface, and this one is lit glass.
 *
 * Purely decorative, so it is hidden from the accessibility tree entirely.
 */
export function BayLightPool({ width = 220, height = 22 }: { width?: number; height?: number }) {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={width} height={height}>
        <Defs>
          <RadialGradient id="bayPool" cx="0.5" cy="0" r="0.5" gradientTransform="scale(1.24 2)">
            <Stop offset="0" stopColor={bay.light} stopOpacity={0.14} />
            <Stop offset="0.72" stopColor={bay.light} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Ellipse cx={width / 2} cy={0} rx={width * 0.31} ry={height} fill="url(#bayPool)" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  /**
   * ⚠ No border and no `borderRadius`.
   *
   * Both were right on a 112pt inset panel and are wrong on a hero: an edge
   * drawn around something that runs to both sides of the screen is an edge
   * around the screen. `radius.hero` still exists and is still what
   * `VehiclePlate` uses — this is the one surface that stopped being a card.
   */
  room: { width: '100%', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  /** Over-scanned so `blurRadius`'s edge feathering falls outside the room. */
  fill: { transform: [{ scale: BLUR_OVERSCAN }] },
  /** Held clear of the fade, so a contained car keeps its wheels. */
  sharp: { bottom: SHARP_INSET },
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  /**
   * 28/800 at 0.2em tracking, in the muted ink.
   *
   * Quiet on purpose. It is the back wall of the room, not a heading — the
   * car's actual name is directly below in the editorial role, and two loud
   * pieces of type stacked would fight. It did **not** grow with the hero for
   * that reason: a bigger room is more air around the signage, not bigger
   * signage.
   */
  wordmark: {
    fontSize: 28,
    /*
      ⚠ One line, and it has to be. `mobile-font-faces.test.ts` matches the face
      and the weight adjacently — RN does not synthesise weights, so a bare
      `fontWeight: '800'` renders San Francisco rather than Inter black, and a
      half-applied typeface reads as a design choice rather than a bug.
    */
    fontFamily: interFace('800'), fontWeight: '800',
    letterSpacing: 5.6,
    color: text.muted,
    paddingLeft: 5.6,
  },
  action: {
    position: 'absolute',
    right: space.lg,
    top: space.md,
    minHeight: TARGET_MIN,
    paddingHorizontal: space.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    // Solid, never a wash — this sits over an unknown photograph.
    backgroundColor: surface.raised,
    borderWidth: 1,
    borderColor: border.field,
  },
  actionPressed: { backgroundColor: surface.well },
  actionLabel: { ...type.label, color: text.primary },
});
