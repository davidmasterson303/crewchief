import { StyleSheet, Text, View } from 'react-native';

import { radius, space, status, text, type } from '../theme';

export type AlertTone = 'critical' | 'attention' | 'confirm';

/**
 * The banner that carries something time-critical.
 *
 * ── Solid fills, never a tinted transparency ────────────────────────────────
 *
 * These carry the only instructions in the product that cannot wait — a
 * do-not-drive recall, a park-outside warning — and a wash over an unknown
 * backdrop is precisely where the 4.47:1 defect came from on the advisor CTA.
 * The `critical` and `attention` pairs are opaque and measured.
 *
 * `Chip`'s soft washes are the other half of that decision: a wash is fine when
 * the message can wait, and wrong when it cannot.
 *
 * ── Severity is the data's, not the screen's ────────────────────────────────
 *
 * NHTSA's `parkIt` and `parkOutSide` flags decide `critical`; nothing here
 * infers urgency from wording. And a recall must **never** read as more or less
 * urgent because of the register — the sport treatment changes light and radii,
 * not what is dangerous.
 *
 * ── Announced, not just coloured ────────────────────────────────────────────
 *
 * The whole banner is one accessibility node with an explicit role, so a screen
 * reader gets the headline and body as a single utterance rather than two
 * unrelated strings — and gets them at all, which colour alone never provides.
 */
export default function AlertBanner({
  tone,
  headline,
  body,
}: {
  tone: AlertTone;
  headline: string;
  body?: string;
}) {
  return (
    <View
      accessible
      accessibilityRole="alert"
      accessibilityLabel={body ? `${headline}. ${body}` : headline}
      style={[styles.banner, styles[tone]]}
    >
      <Text style={styles.headline}>{headline}</Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    borderRadius: radius.card,
    borderWidth: 1,
    padding: space.lg,
    gap: space.xs,
  },
  critical: { backgroundColor: status.criticalFill, borderColor: status.criticalBorder },
  attention: { backgroundColor: status.attentionFill, borderColor: status.attentionBorder },
  confirm: { backgroundColor: status.confirmFill, borderColor: status.confirmFill },

  /*
    White on all three fills, measured. The tone lives in the fill rather than
    in the ink: coloured text on a coloured banner is how one of these ends up
    at 3:1 without anyone choosing it.
  */
  headline: { ...type.title, fontSize: 17, lineHeight: 23, color: text.primary },
  body: { ...type.ui, color: text.secondary },
});
