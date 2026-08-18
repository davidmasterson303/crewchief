import { StyleSheet, Text, View } from 'react-native';

import { space, text, type } from '../theme';
import Button from './Button';

/**
 * What a screen says when it has nothing to show.
 *
 * ── Every empty state here is a first impression ────────────────────────────
 *
 * On a mobile-first product every one of these is reached by someone who has
 * just installed the app — the garage with no cars, the wishlist with nothing
 * on it, the service history of a vehicle whose invoices have not been scanned.
 * A reviewer meets several of them in the first two minutes, and
 * `contrast.test.tsx` already singles the garage's out as *"the first thing a
 * new user sees"*.
 *
 * ── The shape is deliberate: say what, say why, offer the door ──────────────
 *
 * A headline alone reads as a failure. The `body` is where the screen explains
 * that nothing is wrong, and `action` is the way out — because an empty state
 * without one is a dead end that asks the person to work out the next step
 * themselves, on a phone, having used the product for ninety seconds.
 *
 * `action` is optional only for the states that genuinely have no next step.
 * Prefer giving one.
 */
export default function EmptyState({
  headline,
  body,
  actionLabel,
  actionAccessibilityLabel,
  onAction,
  children,
}: {
  headline: string;
  /** Why it is empty, in plain words. Not an apology. */
  body: string;
  actionLabel?: string;
  /**
   * Override the action's spoken name.
   *
   * The garage needs it and its own comment says why: the header already
   * carries an "Add a car" control, and two controls with the same spoken name
   * on one screen are ambiguous to a screen reader in a way they are not to the
   * eye, which has position to go on.
   */
  actionAccessibilityLabel?: string;
  onAction?: () => void;
  /**
   * Extra quiet content under the body — the advisor's example questions.
   *
   * ⚠ Not a slot for controls. The advisor's own note is the rule: those
   * examples are **not** prompts to tap, because making them buttons would turn
   * a conversation into a menu on the first screen a new user meets. Anything
   * pressable belongs in `action`, where the ladder can see it.
   */
  children?: React.ReactNode;
}) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.headline}>{headline}</Text>
      <Text style={styles.body}>{body}</Text>
      {children}
      {actionLabel && onAction ? (
        <Button
          label={actionLabel}
          accessibilityLabel={actionAccessibilityLabel}
          onPress={onAction}
          style={styles.action}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  /*
    Not vertically centred in the viewport. A block that floats in the middle of
    an otherwise blank screen reads as an error page; sitting below the content
    that would be there reads as a section with nothing in it yet, which is what
    this is.
  */
  wrap: {
    paddingVertical: space.h1,
    paddingHorizontal: space.lg,
    gap: space.sm,
    alignItems: 'center',
  },
  headline: { ...type.title, color: text.primary, textAlign: 'center' },
  body: { ...type.body, color: text.muted, textAlign: 'center' },
  action: { marginTop: space.md, alignSelf: 'stretch' },
});
