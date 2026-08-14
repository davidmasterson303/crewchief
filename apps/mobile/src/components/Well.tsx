import { StyleSheet, View, type ViewStyle } from 'react-native';

import { border, radius, space, surface } from '../theme';

/**
 * A recess — the estimate block in the advisor, a read-only value group.
 *
 * ── A well is not a card ────────────────────────────────────────────────────
 *
 * A `Card` is raised and holds a thing. A well is *cut into* the surface it
 * sits on and holds a figure the surrounding text is talking about. The
 * distinction matters because they are one step apart on the ladder and get
 * confused constantly: the estimate under an advisor answer is part of that
 * answer, and boxing it as a card makes it a second, competing object.
 *
 * ── The machined top edge ───────────────────────────────────────────────────
 *
 * A single hairline along the top, brighter than the border — the light
 * catching a cut edge. It is the cheapest way to read as recessed rather than
 * raised without a shadow, and shadows on a dark surface are close to
 * invisible anyway.
 *
 * No blur. The board is explicit about this for the vehicle plinth and the same
 * applies here: translucency over an unknown backdrop is where this product's
 * measured contrast defects came from, and a well is opaque so the text inside
 * it can be measured once and stay measured.
 */
export default function Well({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  return (
    <View style={[styles.well, style]}>
      <View style={styles.catchLight} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  well: {
    backgroundColor: surface.well,
    borderRadius: radius.well,
    borderWidth: 1,
    borderColor: border.panel,
    padding: space.md,
    gap: space.sm,
    overflow: 'hidden',
  },
  catchLight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: border.field,
  },
});
