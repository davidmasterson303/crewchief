import { Modal, StyleSheet, Text, View } from 'react-native';

import Button from '../components/Button';
import { PUSH_PRIMER_COPY } from '@crewchief/core/push-priming';
import { surface, text } from '../theme';
import { interFace } from '../theme/fonts';

/**
 * The screen that comes *before* iOS asks. Phase 5, C5.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * iOS shows its notification dialog exactly once and a "no" is only undoable in
 * Settings. Until this screen, the app spent that one ask on entry to the
 * signed-in stack — on somebody who had just signed in and not yet seen what
 * the product does.
 *
 * This screen is refusable at no cost: declining it leaves the system ask
 * unspent, so it can be offered again in a month. That is the whole point.
 * **It is not a second prompt bolted onto the first; it is what makes the first
 * one recoverable.**
 *
 * ── The copy is not mine ────────────────────────────────────────────────────
 *
 * Every string comes from `PUSH_PRIMER_COPY` in `@crewchief/core/push-priming`,
 * marked as a placeholder for David in Phase 5.5. Nothing is written inline
 * here, so replacing the wording is one edit in one file, needs no build, and
 * cannot leave this component saying something the shared copy does not.
 *
 * ── Decline is not a lesser button ──────────────────────────────────────────
 *
 * "Not now" is a full-width control with the same tap target as accept, not
 * greyed text in a corner. A primer that makes refusal awkward gets a resentful
 * yes or a system-level no, and the second one is permanent — so the design
 * that looks weaker converts better where it counts.
 */
export function PushPrimer({
  visible,
  onAccept,
  onDecline,
}: {
  visible: boolean;
  /** Called when the user opts in. The caller raises the *system* prompt. */
  onAccept: () => void;
  /** Called on "not now" — records the dismissal, spends nothing. */
  onDecline: () => void;
}) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      /*
        A hardware/gesture dismissal is a decline, not a no-op. Leaving it
        unhandled would let someone close the screen without the dismissal being
        recorded, and the primer would return on the very next launch.
      */
      onRequestClose={onDecline}
    >
      <View style={styles.root}>
        <View style={styles.body}>
          <Text style={styles.title}>{PUSH_PRIMER_COPY.title}</Text>
          <Text style={styles.paragraph}>{PUSH_PRIMER_COPY.body}</Text>
          <Text style={styles.detail}>{PUSH_PRIMER_COPY.detail}</Text>
        </View>

        <View style={styles.actions}>
          {/*
            The primitive, not a private pair.

            These were two hand-rolled `Pressable`s that reimplemented `primary`
            and `outline` — and reimplemented them differently. Their pressed
            state was `opacity: 0.9`, which fades the **label** along with the
            fill; `Button`'s rule is that pressed deepens and never lightens, so
            the ink keeps its full strength. They also carried the card radius
            on a button, and their own 52pt height where the primitive already
            holds the 44pt floor.

            One control, one set of states, one place to fix them.
          */}
          <Button label={PUSH_PRIMER_COPY.accept} onPress={onAccept} />
          <Button label={PUSH_PRIMER_COPY.decline} onPress={onDecline} variant="outline" />

          <Text style={styles.reassurance}>{PUSH_PRIMER_COPY.reassurance}</Text>
        </View>
      </View>
    </Modal>
  );
}

/*
  Every colour here is fully opaque and chosen against `surface.page`, the same
  ground the account screen uses. `contrast.test.tsx` enforces a 4.5:1 floor
  with opacity composited in, and a translucent body on a screen this important
  is exactly the shape it catches.
*/
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: surface.page, justifyContent: 'space-between' },
  body: { paddingHorizontal: 28, paddingTop: 96, gap: 18 },
  title: { color: text.primary, fontSize: 26, fontFamily: interFace('700'), fontWeight: '700', lineHeight: 32 },
  paragraph: { color: text.secondary, fontSize: 16, lineHeight: 24 },
  detail: { color: text.muted, fontSize: 14, lineHeight: 21 },

  actions: { paddingHorizontal: 28, paddingBottom: 56, gap: 12 },

  reassurance: { color: text.muted, fontSize: 13, textAlign: 'center', marginTop: 4 },
});
