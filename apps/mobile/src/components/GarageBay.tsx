import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { getHealthBandJudgement } from '@crewchief/core/health-band';

import BayRoom, { BayLightPool, bayHeroHeight } from './BayRoom';
import ClusterGauge from './ClusterGauge';
import {
  UNKNOWN_TIMING,
  describeNextService,
} from '@crewchief/core/garage-next-service';
import { TABULAR, bay, space, surface, text, type } from '../theme';
import { useReducedMotion } from '../motion/reduced-motion';
import { interFace } from '../theme/fonts';

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

/*
  ⚠ The shutter's travel is no longer a constant, because the room's height is
  no longer one — `bayHeroHeight` reads the window. It is resolved once per
  render and used for both, in that order: a shutter that travels 112 over a
  room of 240 leaves a visible band of door at the top for the rest of the
  session, and that is exactly the bug a second literal would reintroduce.
*/

export interface BayVehicle {
  id: string;
  year?: number | null;
  make?: string | null;
  model?: string | null;
  trim?: string | null;
  photo_url?: string | null;
  current_mileage?: number | null;
  vehicle_status?: string | null;
  /**
   * The three stored next-service columns, when the sweep has written them.
   *
   * ⚠ **This docblock was wrong until 23 Aug, and the way it was wrong is the
   * reason §1 exists.** It said the migration was "written and **not applied**,
   * verified against the live database" — true when written, and false by the
   * time anyone read it. The columns are applied and carry data.
   *
   * What was actually missing was the **route's column list**: neither
   * `GARAGE_COLUMNS` nor `VEHICLE_COLUMNS` selected them, so the payload never
   * carried an answer and every car in the product rendered the unknown branch.
   * A note naming the wrong blocker is worse than no note — it sends the next
   * reader to write a migration that already ran.
   *
   * Still optional, and the unknown branch still matters: the sweep has not
   * written a row for every car, and "we have not worked it out" is a real
   * answer that must not render as "nothing is due".
   */
  next_service_label?: string | null;
  next_service_at_miles?: number | null;
  next_service_due_on?: string | null;
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
  today,
}: {
  vehicle: BayVehicle;
  /**
   * Today, as `YYYY-MM-DD`.
   *
   * Injected rather than read from a clock in here, for the reason the rest of
   * this codebase does it: a component with its own clock cannot be tested at
   * the date that matters — and "overdue since" versus "due now" turns on
   * exactly one day.
   */
  today: string;
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
    The hero's height, and the shutter's travel, from one call.

    ⚠ Read from `useWindowDimensions` rather than a constant because the room
    is now tall enough to push the dial off a short phone — see `bayHeroHeight`
    for the arithmetic. It is deliberately *not* held in state or memoised: the
    hook already re-renders on rotation, and a cached height is how a bay ends
    up with a door that no longer matches its room.
  */
  const { height: windowHeight } = useWindowDimensions();
  const heroHeight = bayHeroHeight(windowHeight);

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

  const nextService = describeNextService(
    {
      label: vehicle.next_service_label ?? null,
      atMiles: vehicle.next_service_at_miles ?? null,
      dueOn: vehicle.next_service_due_on ?? null,
    },
    vehicle.current_mileage ?? null,
    today
  );

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
            height={heroHeight}
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
                        outputRange: [0, -heroHeight],
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

      {/*
        The next-service row.

        ⚠ **It renders in both states, and that is the design rather than an
        oversight.** `docs/step4-api-gaps.md` §3 held this row for one sentence:
        "'No schedule yet' is not the same as 'nothing due', and the card must
        not imply the second." A row that disappears when the answer is unknown
        is the version that breaks that rule — a bay with no next-service line,
        sitting next to one that has it, reads as a car with nothing coming up.

        Keeping the label fixed is what makes the empty state safe to say. The
        subject of the sentence is settled before the value is read, so "No
        schedule yet" can only be heard as an answer to *that* question.

        It sits above the instrument for the same reason the advisor's estimate
        sits below its provenance line: this is a fact about the car, and the
        dial is a reading of it.
      */}
      <View style={styles.nextService}>
        <Text style={styles.nextServiceLabel}>NEXT SERVICE</Text>
        {nextService.kind === 'known' ? (
          <Text style={styles.nextServiceValue} numberOfLines={1}>
            {nextService.service} · {nextService.timing}
          </Text>
        ) : (
          /*
            Muted, and phrased to match the "No score yet" beneath it. Two
            absences on one card that word themselves differently read as two
            different kinds of problem.
          */
          <Text style={styles.nextServiceUnknown} numberOfLines={1}>
            {UNKNOWN_TIMING}
          </Text>
        )}
      </View>

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
  nextService: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
  },
  /** 12/600 at 0.6 tracking — the label role, and the floor. Never smaller. */
  nextServiceLabel: { ...type.label, color: text.muted },
  /*
    Right-aligned and allowed to take the slack, so the label column stays put
    across a stack of bays. A value that started at a different x on every card
    would make the list read as unaligned rather than as a set.
  */
  nextServiceValue: { ...type.ui, color: text.primary, flex: 1, textAlign: 'right' },
  /*
    The same size, one step quieter. Not italic and not a different face: this
    is a real answer to the question, not an apology for one.
  */
  nextServiceUnknown: { ...type.ui, color: text.muted, flex: 1, textAlign: 'right' },
  /**
   * ⚠ **No horizontal padding, as of 23 Aug.**
   *
   * It used to inset the whole stack, which is what forced the room to be a
   * card floating in the page. The hero bleeds to both edges now, so the inset
   * moved down onto the rows that still want one — the batten, the lockup, the
   * next-service row — and each of them names it.
   *
   * That move also fixed a double inset nobody had noticed: `GarageScreen`'s
   * `bayFooter` carries `space.lg` of its own, so the recall chip was sitting
   * 32pt in while everything above it sat at 16. Visible in any screenshot with
   * a recall on it, and invisible in every one without.
   */
  bay: { gap: space.md },
  target: { gap: space.md },

  batten: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
  },
  /**
   * The bay number, lit.
   *
   * 0.18em tracking at 12/700 — the board's figures. Tracking is what makes a
   * short numeric label read as a fixture rather than as a heading.
   */
  bayNumber: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: interFace('700'), fontWeight: '700',
    letterSpacing: 2.16,
    color: bay.light,
    ...TABULAR,
  },
  position: { ...type.label, fontFamily: interFace('500'), fontWeight: '500', letterSpacing: 0, color: text.muted, ...TABULAR },

  /*
    Square, since 23 Aug. It covers a room that runs to both edges of the
    screen, and a rounded shutter over a square room shows four lit corners
    through it for the length of the lift.
  */
  shutter: { backgroundColor: surface.nav },

  /**
   * The lockup, where the room lands.
   *
   * `marginTop` cancels exactly the gap `target` puts between the room and
   * this, so the name butts against the fade's last row instead of floating
   * below it. Flush, **not overlapping**: the fade reaches `surface.page` at
   * full opacity right at that edge, so the lockup reads as continuous with the
   * hero while every pixel behind it is the page. That is the difference
   * between this and a scrim, and `HERO_FADE` carries why it matters.
   */
  identity: { gap: 3, paddingHorizontal: space.lg, marginTop: -space.md },
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
