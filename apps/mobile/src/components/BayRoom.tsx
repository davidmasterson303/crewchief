import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, Ellipse, RadialGradient, Rect, Stop } from 'react-native-svg';

import { TARGET_MIN, bay, border, radius, space, surface, text, type } from '../theme';

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
 */

/**
 * Board: `height: 112px`. The room is wide and shallow — a bay, not a photo.
 *
 * Exported because the bay's door travels exactly this far. A shutter that
 * lifts 112 over a room of 120 leaves a band of door at the top forever.
 */
export const BAY_ROOM_HEIGHT = 112;

export default function BayRoom({
  photo,
  make,
  onAddPhoto,
  busy = false,
  height = BAY_ROOM_HEIGHT,
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
        <Image
          source={{ uri: photo }}
          style={StyleSheet.absoluteFill}
          /*
            `contain`. The room holds the car; it does not crop it. Same
            reasoning as the plate, and the same reason the focal-point crop
            was retired on web.
          */
          resizeMode="contain"
          accessibilityRole="image"
          accessibilityLabel={make ? `${make} photo` : 'Vehicle photo'}
        />
      ) : wordmark ? (
        <Text style={styles.wordmark} numberOfLines={1}>
          {wordmark}
        </Text>
      ) : null}

      {onAddPhoto ? (
        <Pressable
          onPress={onAddPhoto}
          disabled={busy}
          style={styles.action}
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
  room: {
    width: '100%',
    overflow: 'hidden',
    borderRadius: radius.hero,
    borderWidth: 1,
    borderColor: border.panel,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /**
   * 28/800 at 0.2em tracking, in the muted ink.
   *
   * Quiet on purpose. It is the back wall of the room, not a heading — the
   * car's actual name is directly below in the editorial role, and two loud
   * pieces of type stacked would fight.
   */
  wordmark: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 5.6,
    color: text.muted,
    paddingLeft: 5.6,
  },
  action: {
    position: 'absolute',
    right: space.sm,
    bottom: space.sm,
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
  actionLabel: { ...type.label, color: text.primary },
});
