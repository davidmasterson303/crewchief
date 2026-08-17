import { StyleSheet, View, type ViewStyle } from 'react-native';

import { border, radius, space, surface } from '../theme';

/**
 * A recess — the estimate block in the advisor, a read-only value group.
 *
 * ── ⚠ One caller, and only one is correct ──────────────────────────────────
 *
 * `EstimateWell` — the priced lines under an advisor answer, which is the
 * caller this was built for and the only one it has.
 *
 * It sat unused from 14 to 16 Aug and the header said why: the numbers did not
 * exist. `POST /api/v1/consultant` returned prose and nothing else, written up
 * as gap 4 in `docs/step4-api-gaps.md`. That gap is closed — the route now
 * returns a structured `estimate` parsed from tags the model emits — so this is
 * a primitive that waited for its feature and got it.
 *
 * ⚠ **The warning that came with it still stands.** Do not adopt this to make
 * something look grouped. A well pressed into service as a card, a bubble or a
 * panel is worse than an unused file: it teaches the next reader that the
 * distinction below does not mean anything.
 *
 * For the record, since it was got wrong once: the first audit read this as
 * "four screens hand-roll it" and that was **wrong**. The two `surface.well`
 * sites in this app are the advisor's chat bubble, which is a bubble and not a
 * recess, and the garage's dev-only token block, which never ships.
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
