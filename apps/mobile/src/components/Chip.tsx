import { StyleSheet, Text, View } from 'react-native';

import { TYPE_MIN, border, radius, space, status, surface, text, type } from '../theme';

export type ChipTone = 'neutral' | 'attention' | 'critical' | 'confirm';

/**
 * A small status word — Addressed, Due soon, Overdue, Estimated, Stock.
 *
 * ── The 12px floor, and the defect this primitive exists to end ─────────────
 *
 * The design system's own `patterns.css` ships `.chip` at **11px**, under the
 * type floor, and every chip on the board overrides it back to 12. That is an
 * export-side defect — there is no `patterns.css` in this repository and no
 * `.chip` in `globals.css` — but it is exactly the rule worth encoding here:
 * a floor that call sites have to remember is a floor that leaks.
 *
 * So the size is not a prop. `TYPE_MIN` is the smallest rendered text in the
 * product and a chip is the control most likely to argue for an exception.
 *
 * ── Provenance is never a chip ──────────────────────────────────────────────
 *
 * "Based on…" is a `ProvenanceRow`, not a chip, and specifically never a green
 * one — a confirm-toned badge beside a generated answer reads as *verified*,
 * which is a claim this product cannot make about a model's output. `confirm`
 * here is for a state the user reached (Addressed), not for a source.
 */
export default function Chip({ label, tone = 'neutral' }: { label: string; tone?: ChipTone }) {
  return (
    <View style={[styles.chip, styles[tone]]}>
      <Text style={[styles.label, styles[`${tone}Label` as const]]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  /*
    Not overridable, deliberately. See the docblock — this is the one place the
    11px chip can be prevented rather than corrected.
  */
  label: { ...type.label, fontSize: TYPE_MIN, letterSpacing: 0.4 },

  neutral: { backgroundColor: surface.raised, borderColor: border.panel },
  neutralLabel: { color: text.muted },

  attention: { backgroundColor: status.attentionWash, borderColor: status.attentionWashBorder },
  attentionLabel: { color: status.attention },

  critical: { backgroundColor: status.dangerWash, borderColor: status.dangerWashBorder },
  criticalLabel: { color: status.dangerText },

  confirm: { backgroundColor: surface.raised, borderColor: border.panel },
  confirmLabel: { color: status.confirm },
});
