import { StyleSheet, View, type ViewStyle } from 'react-native';

import { plinth, radius, space } from '../theme';

/**
 * The block an instrument stands on.
 *
 * ── Why the dial needs one at all ───────────────────────────────────────────
 *
 * A 196pt dial dropped straight onto a card is a picture of a dial. The plinth
 * is what makes it an object in the room: a slab cut from the page's own
 * material, standing proud of it, with a lit top edge. It is the same argument
 * the bay makes one screen up — the product looks like a car rather than like a
 * dashboard product — and it is why this was deferred out of step 3 with the
 * bay rather than built around a placeholder.
 *
 * ── ⚠ No blur. This is the rule, not a preference ───────────────────────────
 *
 * `plinth.fill` is the page colour at 92%, which is what gives it the read of
 * glass. It must stay a **flat fill**:
 *
 *   - A real backdrop blur costs a native module and therefore a cloud build.
 *   - It would drop frames under a sweeping needle, which is the one moment
 *     this surface exists to stage.
 *   - And the deciding one: a surface whose contrast depends on whatever
 *     happens to be behind it is where the 1.09:1 advisor button came from. A
 *     plinth is a surface or it is a hazard.
 *
 * ── The catch-light ─────────────────────────────────────────────────────────
 *
 * One hairline inset along the top, not a shadow underneath. A shadow would put
 * the slab *on* something; a lit edge says it was milled and is being lit from
 * where the bay's light already comes from. Inset rather than a border so it
 * sits inside the radius and does not fight the edge.
 */
export default function Plinth({
  children,
  style,
}: {
  children?: React.ReactNode;
  style?: ViewStyle;
}) {
  return (
    <View style={[styles.plinth, style]}>
      {/*
        Decorative, and hidden from the accessibility tree — a 1px line has
        nothing to say to a screen reader, and an unlabelled node in the middle
        of an instrument is noise while navigating it.
      */}
      <View
        style={styles.catchLight}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  plinth: {
    backgroundColor: plinth.fill,
    /**
     * `radius-md` from the board. Mobile has no token of that name — the scale
     * is well 8 / button 12 / card 14 / hero 20 — and 14 is web's own
     * `--radius`, which sits where "md" does between `--radius-sm` and
     * `--radius-xl`. Mapped rather than a new value invented for one component.
     */
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: plinth.edge,
    paddingVertical: space.lg,
    paddingHorizontal: space.md,
    alignItems: 'center',
    overflow: 'hidden',
  },
  catchLight: {
    position: 'absolute',
    top: 0,
    left: space.md,
    right: space.md,
    height: 1,
    backgroundColor: plinth.catchLight,
  },
});
