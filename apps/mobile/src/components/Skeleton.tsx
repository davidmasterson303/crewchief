import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, type ViewStyle } from 'react-native';

import { radius, space, surface } from '../theme';
import { useReducedMotion } from '../motion/reduced-motion';

/**
 * Loading placeholders. This app had none at all.
 *
 * ── Why "none" is a real defect and not a missing nicety ────────────────────
 *
 * Web ships `components/Skeletons.tsx`. Mobile shipped spinners and blank
 * space, and the screens that fetch — the garage, the dossier, the advisor —
 * are the ones a reviewer opens first, over a cold network, on a device that
 * has never cached anything. An empty screen that fills a second later is
 * indistinguishable from a broken one for that second, and "it looked like
 * nothing was there" is a rejection note, not a taste note.
 *
 * ── The animation is honest about what it does not know ─────────────────────
 *
 * A pulse, not a left-to-right shimmer. Shimmer implies progress and there is
 * none to report: these requests have no measurable completion. A pulse says
 * "working" without claiming to know how far along it is.
 *
 * `useNativeDriver` because opacity qualifies, and a placeholder that stutters
 * while the JS thread parses the response it is waiting for is worse than no
 * placeholder.
 *
 * ── ⚠ Reduced motion, added 16 Aug ──────────────────────────────────────────
 *
 * This was the **one animation in the app with no guard** — an unconditional
 * infinite loop, on the screens a reviewer opens first, while the dials, the
 * bay door and the build needle all checked the preference correctly. Found by
 * an external design audit, not by anything here.
 *
 * It holds at the bright end rather than the dim one. A static placeholder at
 * 0.4 reads as a disabled control; at 0.9 it reads as content that has not
 * arrived, which is what it is.
 */
export function Skeleton({ width, height = 14, style }: { width?: number | `${number}%`; height?: number; style?: ViewStyle }) {
  const reduced = useReducedMotion();
  const pulse = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    if (reduced) {
      pulse.setValue(0.9);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.9, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduced]);

  return (
    <Animated.View
      // One announcement for the group, made by the parent. A screen reader
      // reading eight identical "loading" bars is worse than silence.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.bar, { height, width: width ?? '100%', opacity: pulse }, style]}
    />
  );
}

/**
 * A card-shaped placeholder, for lists that will resolve into cards.
 *
 * Deliberately mirrors `Card`'s padding and radius: a placeholder whose shape
 * does not match what replaces it produces a visible jump, which is the thing
 * a skeleton exists to prevent.
 */
export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <View
      accessible
      accessibilityLabel="Loading"
      accessibilityRole="progressbar"
      style={styles.card}
    >
      <Skeleton width="60%" height={18} />
      {Array.from({ length: lines }).map((_, i) => (
        // The last line is short, the way a real paragraph ends.
        <Skeleton key={i} width={i === lines - 1 ? '40%' : '100%'} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: surface.well,
    borderRadius: radius.well,
  },
  card: {
    backgroundColor: surface.card,
    borderRadius: radius.card,
    padding: space.lg,
    gap: space.md,
  },
});
