import { StyleSheet, Text, View, Pressable } from 'react-native';

import { TARGET_MIN, border, brand, radius, space, surface, text, type } from '../theme';

/**
 * Two or three views of one subject, switched in place.
 *
 * ── What it is for, and what it is not ──────────────────────────────────────
 *
 * It exists because of **R14 and R15**: `Service due` and `Service history`
 * were two hub rows answering one question ("what has this car had done, and
 * what does it need"), and `Wishlist` and `Build` were two more answering
 * another ("what should I do to it next"). Splitting each across two
 * destinations made the owner decide which list a job belonged on *before* they
 * could look for it — and "Charge Pipe" is genuinely both.
 *
 * A segmented control is the right shape for exactly that: one subject, two
 * views, and switching between them costs nothing and loses no place.
 *
 * ⚠ **Not for navigation between unrelated screens.** If the two sides do not
 * share a subject, they are two destinations and this is a worse tab bar. The
 * test is whether a person could reasonably expect to find an item on either
 * side — if not, they are not segments.
 *
 * ── The selected segment is the brand fill ──────────────────────────────────
 *
 * Not white. `Button`'s docblock carries the argument: there is one filled
 * treatment in this app and it is `brand.primary`. A selected segment is a
 * filled control like any other.
 */
export default function Segmented<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
}: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (next: T) => void;
  /** Names the *group*, since each segment names only itself. */
  accessibilityLabel: string;
}) {
  return (
    <View
      style={styles.track}
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
    >
      {options.map((option) => {
        const selected = option.value === value;

        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="tab"
            /*
              ⚠ `selected`, not `checked`. VoiceOver announces a tab's selected
              state; a segment that only *looks* chosen is a control whose state
              is carried entirely by a fill colour, which is the failure the
              chip family's "never colour alone" rule exists to prevent.
            */
            accessibilityState={{ selected }}
            style={({ pressed }) => [
              styles.segment,
              selected && styles.segmentOn,
              pressed && !selected && styles.segmentPressed,
            ]}
          >
            <Text style={[styles.label, selected && styles.labelOn]} numberOfLines={1}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  /*
    A well, not a card: this is a control surface. `radius.pill` on the track
    with the same on each segment is the platform's own segmented shape.
  */
  track: {
    flexDirection: 'row',
    backgroundColor: surface.well,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: border.panel,
    padding: 2,
    gap: 2,
  },
  segment: {
    flex: 1,
    minHeight: TARGET_MIN - 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.sm,
    borderRadius: radius.pill,
  },
  /* A fill swap, never a group opacity — see `Button`. */
  segmentPressed: { backgroundColor: surface.raised },
  segmentOn: { backgroundColor: brand.primary },
  label: { ...type.uiStrong, color: text.secondary },
  labelOn: { color: text.onPrimary },
});
