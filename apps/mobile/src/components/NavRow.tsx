import { Pressable, StyleSheet, Text, View } from 'react-native';

import Icon, { type IconName } from './Icon';
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
        <Icon name={icon} size={17} />
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
          <Text style={styles.count} numberOfLines={1}>
            {count}
          </Text>
        ) : null}

        <Icon name="chevron-right" size={16} color={text.nonText} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  /*
    No vertical padding here and no divider — both belong to `body`, so the
    pressed fill covers the whole row including the glyph column while the rule
    stays inset. `minHeight` still clears the 44pt floor on the row itself.
  */
  row: {
    minHeight: TARGET_MIN,
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingLeft: space.md,
  },
  pressed: { backgroundColor: surface.well },
  /** Fixed width so every label in the group starts on the same x. */
  glyph: { width: 30, justifyContent: 'center' },
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
  labelBlock: { flex: 1, gap: 2 },
  /**
   * ⚠ `type.ui` at primary, not `type.bodyStrong`.
   *
   * The first version set these at 16/600, which is a heading weight — five of
   * them stacked read as five headings rather than as a list. The spec's rows
   * are the 14pt control step, and the ink alone carries that they are live.
   */
  label: { ...type.uiStrong, color: text.primary },
  detail: { ...type.value, color: text.muted },
  /*
    Tabular, because these are counts and money and they must not reflow as
    their digits change — the same rule the mileage row follows.
  */
  count: { ...type.value, ...TABULAR, color: text.muted, textAlign: 'right' },
});
