import { StyleSheet, Text } from 'react-native';

import { space, text, type } from '../theme';

/**
 * What an answer was based on.
 *
 * ── "Based on…", never "Sources", and never green ───────────────────────────
 *
 * Three rules, and all three are about the same thing: not letting a generated
 * answer borrow the appearance of a verified one.
 *
 * **"Sources"** implies citations that can be followed. What this actually
 * lists is the context the advisor was given — this car's service records, its
 * open recalls — which is provenance, not citation.
 *
 * **Never a chip, never green.** A confirm-toned badge beside a model's answer
 * reads as *verified*, and nothing here verifies anything. That is why this is
 * a quiet line of text rather than a badge: `Chip` exists and this deliberately
 * does not use it.
 *
 * It is also `cc-design-0003` applied at the smallest scale — answers as ranges
 * and comparisons, never verdicts. A verdict-shaped provenance badge undoes a
 * carefully hedged answer above it.
 */
export default function ProvenanceRow({ kinds }: { kinds: string[] }) {
  if (kinds.length === 0) return null;

  return (
    <Text style={styles.line}>
      Based on {kinds.join(' · ')}
    </Text>
  );
}

const styles = StyleSheet.create({
  /*
    `text.muted` is the floor, and this sits on it deliberately — quiet enough
    to stay out of the answer's way, never quieter than a string may be.
  */
  line: { ...type.label, letterSpacing: 0, color: text.muted, marginTop: space.xs },
});
