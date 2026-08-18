import { View, Text, StyleSheet, type ViewStyle } from 'react-native';

import { border, radius, space, surface, text, type } from '../theme';

/**
 * A panel. The most-missing primitive in this app.
 *
 * Every screen currently draws its own container — twelve slightly different
 * radii, borders and paddings, none of them wrong on their own and none of them
 * the same. That inconsistency is most of what reads as "sparse": the eye finds
 * no repeating structure, so nothing groups.
 *
 * ── `elevated`, and why the ladder matters more than the values ─────────────
 *
 * A card on the page background sits on `surface.card`. A card *inside* another
 * panel needs the next step up or it disappears, and the temptation at that
 * point is to reach for a border instead — which is how a screen ends up with
 * four nested outlines. `elevated` takes the step; the border stays subtle.
 */
export default function Card({
  title,
  footnote,
  elevated = false,
  style,
  children,
}: {
  /** Optional heading. Omit for a bare container. */
  title?: string;
  /** Quiet line under the content — provenance, counts, "estimated from". */
  footnote?: string;
  /** Use inside another panel, where the base surface would vanish. */
  elevated?: boolean;
  style?: ViewStyle;
  children?: React.ReactNode;
}) {
  return (
    <View style={[styles.card, elevated && styles.elevated, style]}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {children}
      {footnote ? <Text style={styles.footnote}>{footnote}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: surface.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: border.panel,
    padding: space.lg,
    gap: space.md,
  },
  elevated: {
    backgroundColor: surface.well,
    borderColor: border.field,
  },
  title: { ...type.title, color: text.primary },
  footnote: { ...type.value, color: text.muted },
});
