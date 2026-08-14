import { StyleSheet, Text, View } from 'react-native';

import { space, text, type } from '../theme';

/**
 * The label that names a block.
 *
 * The cheapest fix for the thing that made this app read as a wall: a long
 * screen with no headers has no shape, so the eye has nothing to skip to and
 * every block looks equally important.
 *
 * ── A real heading, not styled text ─────────────────────────────────────────
 *
 * `accessibilityRole="header"` is what lets a screen-reader user jump between
 * sections by rotor. Without it a header is a paragraph that happens to be
 * uppercase, and the navigation it implies visually does not exist for anyone
 * not looking at it.
 *
 * ── Uppercasing is done here, once ──────────────────────────────────────────
 *
 * `type.label` carries the size and tracking but not the case, so the token
 * stays usable for sentence-case labels. Doing it at call sites is how half of
 * them end up shouting and half do not.
 */
export default function SectionHeader({ title, trailing }: { title: string; trailing?: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <Text accessibilityRole="header" style={styles.title}>
        {title.toUpperCase()}
      </Text>
      {trailing}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    marginBottom: space.sm,
  },
  title: { ...type.label, color: text.muted },
});
