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
  onAction,
}: {
  headline: string;
  /** Why it is empty, in plain words. Not an apology. */
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.headline}>{headline}</Text>
      <Text style={styles.body}>{body}</Text>
      {actionLabel && onAction ? (
        <Button label={actionLabel} onPress={onAction} style={styles.action} />
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
