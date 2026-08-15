import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { getHealthBandJudgement } from '@crewchief/core/health-band';

import BayRoom, { BAY_ROOM_HEIGHT, BayLightPool } from './BayRoom';
import ClusterGauge from './ClusterGauge';
import { bay, space, surface, text, type, TABULAR } from '../theme';
import { useReducedMotion } from '../motion/reduced-motion';

/**
 * One car, in one bay.
 *
 * ── Why the garage is a bay and not a list ──────────────────────────────────
 *
 * The board's own line: *"Home. One car in a lit room, swiped between. Door
 * lifts, bay lights come up, needle sweeps."* A list of cards is a database
 * browser; a bay is a place you keep a car. The difference is the whole reason
 * the hero dial exists — a 184pt instrument has nowhere to live in a list row,
 * which is why this and the plinth were deferred out of step 3 rather than
 * built around a placeholder and then built again.
 *
 * ── The size the board actually uses ────────────────────────────────────────
 *
 * ⚠ **164, not `HERO_SIZE`.** The instruments card specifies the hero at 184pt;
 * the bay screen passes `size="164"`. Both are the board's, and the screen is
 * the more specific claim — 184 is the dial's own design size, 164 is what fits
 * a bay with a room, an identity lockup and a service row above the fold. The
 * component default is untouched; the caller chooses, which is exactly how the
 * board expresses it too.
 */
const BAY_DIAL = 164;

/** Door lift, then lights, then the needle. The order is the sentence. */
const DOOR_MS = 460;

/**
 * How far the shutter travels — the room's own height, from `BayRoom`.
 *
 * Imported rather than repeated: a shutter that travels 112 over a room of 120
 * leaves a visible band of door at the top for the rest of the session.
 */
const ROOM_HEIGHT = BAY_ROOM_HEIGHT;

export interface BayVehicle {
  id: string;
  year?: number | null;
  make?: string | null;
  model?: string | null;
  trim?: string | null;
  photo_url?: string | null;
  current_mileage?: number | null;
  vehicle_status?: string | null;
}

export default function GarageBay({
  vehicle,
  score,
  index,
  total,
  subtitle,
  active = true,
  onOpen,
  onAddPhoto,
  uploading,
  footer,
}: {
  vehicle: BayVehicle;
  /** Health score, or null when the car has none. Null is not zero. */
  score?: number | null;
  /** Zero-based position, for the batten. */
  index: number;
  total: number;
  /** "Premium · Daily driver · 48,210 mi" — assembled by the caller. */
  subtitle?: string;
  /**
   * Whether this is the bay on screen.
   *
   * The intro and the needle sweep run for the focused bay only. Three bays
   * igniting at once in a paged list — two of them off-screen — is three
   * animations nobody sees and one that arrives already finished.
   */
  active?: boolean;
  /** Opens the car. The room and its lockup are the target — not the dial. */
  onOpen?: () => void;
  onAddPhoto?: () => void;
  uploading?: boolean;
  /** The next-service row, or anything else the screen hangs under the dial. */
  footer?: React.ReactNode;
}) {
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);
  const door = useRef(new Animated.Value(0)).current;

  /*
    ── The door ───────────────────────────────────────────────────────────────

    A shutter over the room that lifts out of the top.

    `translateY`, not `scaleY`. React Native scales about an element's **centre**,
    so a `scaleY` from 1 to 0 closes like an iris — which reads as the room being
    switched off rather than a door going up. And not a height animation either:
    that relayouts every frame and drags the identity lockup and the dial with
    it. Translating a full-size overlay up by its own height is the only one of
    the three that is actually a door.

    ⚠ Reduced motion does not shorten this — it removes it. A door that lifts
    quickly is still a door lifting, and the preference is about motion rather
    than duration. The end state is the same either way: `open` true, shutter
    gone, dial swept.
  */
  useEffect(() => {
    if (!active) {
      door.setValue(0);
      setOpen(false);
      return;
    }

    if (reduced) {
      door.setValue(1);
      setOpen(true);
      return;
    }

    const lift = Animated.timing(door, {
      toValue: 1,
      duration: DOOR_MS,
      easing: Easing.out(Easing.cubic),
      /*
        `scaleY` is transform-only, so this one genuinely can run on the native
        driver — unlike the dials, whose values drive SVG attributes. The
        callback still sets `open` on the JS side, which is what releases the
        needle.
      */
      useNativeDriver: true,
    });

    lift.start(() => setOpen(true));

    return () => {
      lift.stop();
      // Lands open whether or not it finished. A half-lifted door left behind
      // by a swipe is the one state this must never rest in.
      setOpen(true);
    };
  }, [active, reduced, door]);

  const name = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ');
  const band = typeof score === 'number' ? getHealthBandJudgement(score) : null;

  return (
    <View style={styles.bay}>
      {/*
        The batten. Bay number in the light's own colour, position on the right.

        ⚠ `bay.light` is `brand.accent` and this is one of the few places a
        string may wear it — it is signage, not body copy, and it sits on the
        page surface at full strength rather than over an unknown backdrop.
      */}
      <View style={styles.batten}>
        <Text style={styles.bayNumber}>BAY {String(index + 1).padStart(2, '0')}</Text>
        <Text style={styles.position}>
          {index + 1} of {total}
        </Text>
      </View>

      {/*
        The room and the name are one target, and the dial is not part of it.

        A whole-bay Pressable would swallow the dial, which is an instrument to
        be read rather than a button — and it would make the "Add photo" control
        a nested tap inside a target the size of the screen. Tapping the car
        opens the car; that is the whole rule.
      */}
      <Pressable
        onPress={onOpen}
        disabled={!onOpen}
        accessibilityRole={onOpen ? 'button' : undefined}
        accessibilityLabel={onOpen ? `${name || 'Vehicle'}, open details` : undefined}
        style={styles.target}
      >
        <View>
          <BayRoom
            photo={vehicle.photo_url}
            make={vehicle.make}
            onAddPhoto={onAddPhoto}
            busy={uploading}
          />

          {/*
          The shutter. Painted in the nav surface — the darkest step — because a
          door is not part of the room's lighting and should read as something
          in front of it.
        */}
          {!open && (
            <Animated.View
              pointerEvents="none"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[
                StyleSheet.absoluteFill,
                styles.shutter,
                {
                  transform: [
                    {
                      translateY: door.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0, -ROOM_HEIGHT],
                      }),
                    },
                  ],
                },
              ]}
            />
          )}
        </View>

        <View style={styles.identity}>
          <Text style={styles.name} numberOfLines={1}>
            {name || 'Vehicle'}
          </Text>
          {subtitle ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      </Pressable>

      <View style={styles.instrument}>
        {band && typeof score === 'number' ? (
          <>
            {/*
              `active` is the door, not the bay. The needle waits for the room
              to be visible — a sweep that ran behind a closed shutter would be
              the animation this screen exists to stage, spent on nothing.
            */}
            <ClusterGauge score={score} size={BAY_DIAL} active={open} />
            <BayLightPool />
          </>
        ) : (
          /*
            No score is not a zero, and it is not an empty dial either. A dial
            drawn at 0 asserts a reading; this says there is none.
          */
          <Text style={styles.noScore}>No score yet</Text>
        )}
      </View>

      {footer}
    </View>
  );
}

const styles = StyleSheet.create({
  bay: { gap: space.md, paddingHorizontal: space.lg },
  target: { gap: space.md },

  batten: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  /**
   * The bay number, lit.
   *
   * 0.18em tracking at 12/700 — the board's figures. Tracking is what makes a
   * short numeric label read as a fixture rather than as a heading.
   */
  bayNumber: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    letterSpacing: 2.16,
    color: bay.light,
    ...TABULAR,
  },
  position: { ...type.label, fontWeight: '500', letterSpacing: 0, color: text.muted, ...TABULAR },

  shutter: { backgroundColor: surface.nav, borderRadius: 20 },

  identity: { gap: 3 },
  /**
   * The one editorial role on this screen.
   *
   * ⚠ Still the system sans — the Newsreader serif is not loaded in the native
   * app, and adding the asset is a native change. That decision got cheaper on
   * 15 Aug: the EAS budget was confirmed at 12 iOS builds left this month, so a
   * build for a font is affordable rather than a real trade.
   */
  name: { ...type.editorial, color: text.primary },
  subtitle: { ...type.value, color: text.muted },

  instrument: { alignItems: 'center' },
  noScore: { ...type.body, color: text.muted, paddingVertical: space.xl },
});

export { BAY_DIAL };
