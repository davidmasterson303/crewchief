import { Pressable, StyleSheet, Text, View } from 'react-native';

import Chevron from './Chevron';
import { TABULAR, TARGET_MIN, border, space, surface, text, type } from '../theme';

/**
 * A place to go, in a list of places to go.
 *
 * ── Why this is not `ListRow`, which looks identical in a screenshot ────────
 *
 * `ListRow` is a **fact**: a label naming something the product tracks, and the
 * value it currently holds. Its ink ramp says so — the label is `text.muted`
 * and the value is `text.primary`, because on a data row the value is the
 * payload and the label is the caption for it. That is right for "Mileage ·
 * 66,000 mi".
 *
 * It is exactly backwards for a destination, and the vehicle screen shipped it
 * that way. "This car" was three `ListRow`s with `value=""` — so *Service
 * history*, *Wishlist* and *Scan an invoice* rendered as muted grey captions,
 * against no value, with no chevron and no trailing anything. David's note on
 * 23 Aug was **"it's not clear that these are buttons I could tap"**, and it was
 * not clear because every signal the row had was pointed the other way.
 *
 * ⚠ `value=""` also defeated `ListRow`'s own em-dash rule. That rule reads
 * `value ?? '—'`, and an **empty string is not nullish** — so instead of the
 * honest "we have no reading" dash, the row rendered nothing at all, which is
 * the state that docblock exists to prevent. Passing `""` to say "this row has
 * no value" is a use `ListRow` cannot express, and the fix is a different
 * component rather than a fourth branch inside it.
 *
 * So: label in primary ink at the body weight, count in the quiet ramp, chevron
 * on the end. Three signals, all agreeing that this row goes somewhere.
 *
 * ── The count is optional and is never invented ─────────────────────────────
 *
 * The spec shows *Service history · 18*, *Wishlist · 4 · $4,980*,
 * *Service due · 60k*. Where a screen knows the number it passes it, and where
 * it does not it passes nothing — and nothing renders **nothing**, not a zero
 * and not a dash. A destination with no count beside it reads as a place; a
 * destination showing "0" claims the place is empty, which is a different and
 * usually unearned statement. Same rule as the dial: `null` is not `0`.
 */
export default function NavRow({
  label,
  count,
  detail,
  onPress,
  tone = 'default',
  last = false,
}: {
  label: string;
  /** What is behind the row — "18", "4 · $4,980". Omit when unknown. */
  count?: string | null;
  /** One quiet line under the label, for a destination that needs explaining. */
  detail?: string;
  onPress: () => void;
  /**
   * `quiet` drops the label to the secondary ramp.
   *
   * For a row that is a real destination but not one of this screen's
   * headlines — the details a car has rather than the things to do with it.
   * It keeps the chevron: it is still a place, just not a priority.
   */
  tone?: 'default' | 'quiet';
  /** The last row in a group draws no divider under itself. */
  last?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      /*
        One utterance. A row read out as "Wishlist", "4 · $4,980", "button"
        makes the reader assemble the sentence; the chevron is hidden from the
        tree entirely because "button" has already been said.
      */
      accessibilityLabel={[label, count, detail].filter(Boolean).join(', ')}
      style={({ pressed }) => [styles.row, last && styles.last, pressed && styles.pressed]}
    >
      <View style={styles.labelBlock}>
        <Text style={[styles.label, tone === 'quiet' && styles.labelQuiet]} numberOfLines={1}>
          {label}
        </Text>
        {detail ? (
          <Text style={styles.detail} numberOfLines={2}>
            {detail}
          </Text>
        ) : null}
      </View>

      {count ? (
        <Text style={styles.count} numberOfLines={1}>
          {count}
        </Text>
      ) : null}

      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Chevron />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: TARGET_MIN,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: border.panel,
  },
  /*
    The group's last row keeps its padding and loses its rule. A divider under
    the final item draws a line to nothing, which reads as a row that failed to
    render.
  */
  last: { borderBottomWidth: 0 },
  /* A fill swap, never a fade — the ink keeps full strength. See `ListRow`. */
  pressed: { backgroundColor: surface.raised },
  labelBlock: { flex: 1, gap: 2 },
  /**
   * ⚠ Primary ink at the body weight, which is the whole fix.
   *
   * `ListRow`'s label is `type.ui` in `text.muted` — 14px at the quietest step
   * the system allows a string to be. On a fact that is correct and on a
   * destination it is why these read as captions.
   */
  label: { ...type.bodyStrong, color: text.primary },
  labelQuiet: { color: text.secondary },
  detail: { ...type.value, color: text.muted },
  /*
    Tabular, because these are counts and money and they must not reflow as
    their digits change — the same rule the mileage row follows, for the same
    reason.
  */
  count: { ...type.value, ...TABULAR, color: text.muted, textAlign: 'right' },
});
