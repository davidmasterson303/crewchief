import { Pressable, StyleSheet, Text, View } from 'react-native';

import Icon, { type IconName } from './Icon';
import { TABULAR, border, space, surface, text, type } from '../theme';

/**
 * A place to go, in a list of places to go.
 *
 * ── Why this is not `ListRow`, which looks identical in a screenshot ────────
 *
 * `ListRow` is a **fact**: a label naming something the product tracks, and the
 * value it currently holds. Its ink ramp says so — the label is `text.muted`
 * and the value is `text.primary`, because on a data row the value is the
 * payload and the label is the caption for it. That is right for "Mileage ·
 * 66,000 mi" and exactly backwards for a destination.
 *
 * ⚠ `value=""` also defeated `ListRow`'s em-dash rule, which reads `value ?? '—'`
 * — an **empty string is not nullish**, so the row rendered nothing where the
 * dash should have been. Passing `""` to mean "no value" is a use `ListRow`
 * cannot express, which is why this is a separate component rather than a
 * fourth branch inside it.
 *
 * ── ⚠ The icon is not decoration, and this row shipped without one ──────────
 *
 * The first version of this had the ink ramp right and no glyph, and David's
 * verdict was that the section was still *"ugly and uninviting to engage
 * with"*. He was right, and the rendered spec says why: every row in
 * `native-vehicle-detail` carries a Lucide mark. Four left-aligned words in a
 * box give the eye nothing to land on, so a hub of five destinations reads as a
 * paragraph rather than as five things.
 *
 * `icon` is therefore **required**. An optional one would be omitted under
 * deadline on exactly the screen that needs it, which is what happened.
 */
export default function NavRow({
  icon,
  label,
  count,
  detail,
  onPress,
  last = false,
}: {
  icon: IconName;
  label: string;
  /** What is behind the row — "18", "4 · $4,980". Omit when unknown. */
  count?: string | null;
  /** One quiet line under the label, for a destination that needs explaining. */
  detail?: string;
  onPress: () => void;
  /** The last row in a group draws no divider under itself. */
  last?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      /*
        One utterance. A row read out as "Wishlist", "4 · $4,980", "button"
        makes the reader assemble the sentence; the icon and the chevron are
        both hidden from the tree because "button" has already been said.
      */
      accessibilityLabel={[label, count, detail].filter(Boolean).join(', ')}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.glyph}>
        <Icon name={icon} size={19} color={text.secondary} />
      </View>

      {/*
        ⚠ The divider lives on this inner view, not on the row, so it starts at
        the label column and stops at the row's right inset. A rule that runs
        edge to edge cuts the group into slices; an inset one reads as a seam
        between rows of one object. It is the iOS grouped-table convention and
        the spec draws it that way.
      */}
      <View style={[styles.body, !last && styles.divided]}>
        <View style={styles.labelBlock}>
          <Text style={styles.label} numberOfLines={1}>
            {label}
          </Text>
          {detail ? (
            <Text style={styles.detail} numberOfLines={2}>
              {detail}
            </Text>
          ) : null}
        </View>

        {count ? (
          <Text style={styles.count} numberOfLines={1} ellipsizeMode="tail">
            {count}
          </Text>
        ) : null}

        <Icon name="chevron-right" size={18} color={text.secondary} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  /**
   * No vertical padding and no divider here — both belong to `body`, so the
   * pressed fill covers the whole row including the glyph column while the rule
   * stays inset.
   *
   * ⚠ 56, not 44.
   *
   * The floor is 44 and these were sitting on it, next to a 52pt filled
   * primary. David, 23 Aug: *"why are these buttons so much smaller than 'ask
   * the advisor'… 'ask the advisor' looks like a cta, the others don't by
   * comparison."* He is right, and the comparison is the point — a row that
   * clears the minimum is not the same as a row that looks like somewhere to
   * go. The spec draws these compact; on a real device against a real CTA they
   * read as caption text. Logged in `docs/design-system-drift.md`.
   */
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingLeft: space.lg,
  },
  pressed: { backgroundColor: surface.well },
  /** Fixed width so every label in the group starts on the same x. */
  glyph: { width: 32, justifyContent: 'center' },
  body: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    paddingRight: space.md,
  },
  divided: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: border.panel,
  },
  /**
   * ⚠ `flexShrink: 0` — the label never gives up its width.
   *
   * "Service due" rendered as **"Se…"** on the device, because the count beside
   * it was the whole next-service sentence and both were free to shrink. The
   * label is the destination's name; it is the one thing on the row that must
   * survive. The count is supplementary and truncates instead.
   */
  labelBlock: { flexShrink: 0, gap: 2 },
  /**
   * ⚠ 16/600, and this went round twice.
   *
   * It shipped at 16 first, was dropped to the spec's 14pt control step on the
   * reasoning that five 16pt rows read as five headings, and came back to 16 on
   * 23 Aug — because on a device, beside a filled primary, 14pt read as caption
   * text rather than as somewhere to go. The "five headings" worry was real and
   * is answered by the row height and the icon column instead, which give the
   * group structure the type no longer has to supply.
   */
  label: { ...type.bodyStrong, color: text.primary },
  detail: { ...type.value, color: text.muted },
  /*
    Tabular, because these are counts and money and they must not reflow as
    their digits change — the same rule the mileage row follows.
  */
  /* Takes the slack and truncates, so the label never has to. */
  count: { ...type.value, ...TABULAR, color: text.muted, textAlign: 'right', flex: 1 },
});
