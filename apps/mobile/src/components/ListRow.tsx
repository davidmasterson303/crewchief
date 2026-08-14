import { Pressable, StyleSheet, Text, View } from 'react-native';

import { TABULAR, TARGET_MIN, border, space, text, type } from '../theme';

/**
 * One row in a divider-separated list.
 *
 * ── Divider-separated, never striped ────────────────────────────────────────
 *
 * Alternating fills read as a table of records; a hairline between rows reads
 * as a list of things. This product's rows are things — a service, a recall, a
 * mileage reading — and the summary cards on the garage and vehicle screens are
 * built from them.
 *
 * ── The value is tabular, always ────────────────────────────────────────────
 *
 * Mileage, dates, prices and scores must not reflow as their digits change. A
 * number that shifts sideways while it updates reads as a glitch, and on a list
 * of them the whole column shimmers.
 *
 * ── A missing value is an em dash, never a vanished row ─────────────────────
 *
 * If the row exists, the label is a promise that this fact is tracked. Dropping
 * the row when the value is unknown silently rewrites what the product claims
 * to know — and it is the difference between "we have no reading" and "we do
 * not track this".
 */
export default function ListRow({
  label,
  value,
  detail,
  onPress,
  accessory,
}: {
  label: string;
  /** `undefined` renders an em dash. Pass the value even when you have none. */
  value?: string | null;
  /** A second line under the label — provenance, timing, counts. */
  detail?: string;
  onPress?: () => void;
  /** Trailing affordance, e.g. a chevron. Decorative and hidden from the reader. */
  accessory?: React.ReactNode;
}) {
  const shown = value ?? '—';

  const body = (
    <View style={styles.row}>
      <View style={styles.labelBlock}>
        <Text style={styles.label}>{label}</Text>
        {detail ? <Text style={styles.detail}>{detail}</Text> : null}
      </View>
      <Text style={styles.value}>{shown}</Text>
      {accessory ? (
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {accessory}
        </View>
      ) : null}
    </View>
  );

  if (!onPress) return body;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      // One utterance, not three. A row read as "Mileage", "66,000 mi",
      // "button" makes the reader assemble the sentence themselves.
      accessibilityLabel={detail ? `${label}, ${shown}, ${detail}` : `${label}, ${shown}`}
      style={({ pressed }) => [pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: TARGET_MIN,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: border.panel,
  },
  pressed: { opacity: 1 },
  labelBlock: { flex: 1, gap: 2 },
  label: { ...type.ui, color: text.muted },
  detail: { ...type.label, letterSpacing: 0, color: text.muted },
  value: { ...type.value, ...TABULAR, color: text.primary, textAlign: 'right', flexShrink: 1 },
});
