import { StyleSheet, Text, View } from 'react-native';

import { border, radius, space, surface, text, type } from '../theme';

/**
 * A set of rows in one inset block, with its label outside it.
 *
 * ── Why this exists, which is a correction ──────────────────────────────────
 *
 * The vehicle hub's destinations were `NavRow`s inside a `Card` with a
 * `SectionHeader` at the top of it. That is a *card with a title*, and it is
 * not what `specs/native-vehicle-detail.spec.html` draws. David's read on
 * 23 Aug, after the first attempt: *"'This car' section is still really bad UI
 * and UX, it's ugly and uninviting to engage with."*
 *
 * Looking at the rendered spec rather than its text — which is what I should
 * have done the first time — the differences are structural, not decorative:
 *
 *   - The label **`THIS CAR` sits above the block, not inside it.** A heading
 *     inside a card competes with the rows; a label outside names the group and
 *     gets out of the way.
 *   - Every row carries a **Lucide icon**. This is the single biggest reason
 *     the first attempt read as a wall of text: four left-aligned words in a
 *     box, with nothing to scan by.
 *   - The dividers are **inset to the label column**, not run edge to edge. A
 *     full-bleed rule cuts the block into slices; an inset one reads as a
 *     seam between rows of the same object.
 *   - The rows are **tighter** than a comfortable card row. A hub is a list of
 *     places, and places want to be countable at a glance.
 *
 * ── It is not a `Card`, and that is deliberate ──────────────────────────────
 *
 * `Card` is `surface.card` with a border and its own padding — a container for
 * *content*. This is a control surface: one step down the ladder, no border,
 * no inner padding of its own, because the rows own their insets so a pressed
 * row can fill the block's full width. Two different jobs, and collapsing them
 * is what produced the version David rejected.
 */
export default function ListGroup({
  label,
  children,
}: {
  /**
   * The group's name, rendered above it.
   *
   * Optional: a single unlabelled group on a screen that has already said what
   * it is does not need naming twice.
   */
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.wrap}>
      {label ? <Text style={styles.label}>{label.toUpperCase()}</Text> : null}
      {/*
        `overflow: hidden` so a pressed row's fill is clipped to the rounded
        corners. Without it the first and last rows paint square corners over
        the block's radius on press, which is the kind of thing that only
        appears under a finger and never in a screenshot.
      */}
      <View style={styles.group}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  /**
   * 12/600 at 0.6 tracking in the muted ink — the label role, and the floor.
   *
   * Indented to match the rows' own inset so the label sits over the column it
   * names rather than over the block's edge.
   */
  label: { ...type.label, color: text.muted, paddingHorizontal: space.xs },
  group: {
    backgroundColor: surface.raised,
    /**
     * ⚠ `radius.button`, not `radius.card` — and `mobile-surface-ladder` is why.
     *
     * The first version paired the **bar** surface with the **card** radius,
     * which is a container on two ladder steps at once. That guard exists
     * because four screens once shipped a private card on `surface.raised`, and
     * it caught this the same way. It was right to.
     *
     * The resolution is not an exemption, it is picking a lane: this is a stack
     * of **controls**, so it takes the control surface and the control radius.
     * A card would be `surface.card` with a border and its own padding, and
     * that is the thing `Card` already is.
     */
    borderRadius: radius.button,
    overflow: 'hidden',
    /*
      A hairline, not `border.field`. The block is a surface step above the
      page and mostly separates itself; the edge is there to stop it dissolving
      on the darkest step of the ladder rather than to draw a box.
    */
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: border.panel,
  },
});
