import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import Button from './Button';
import { PAGE_BODY, border, radius, space, surface, text, type } from '../theme';
import type { AiConsentCopy } from '@crewchief/core/ai-consent-copy';

/**
 * Explicit permission before a person's data reaches Google.
 *
 * ── ⚠ Guideline 5.1.2(i), amended November 2025 (LEG-02) ────────────────────
 *
 * Apple now requires **explicit permission** before personal data is shared
 * with a third-party AI — not disclosure, permission. The product had the
 * disclosure and the only consent was sign-up wrap.
 *
 * ── The two rules this component exists to keep ─────────────────────────────
 *
 * **Refusal must not block the app.** Declining means *"no AI features"*, never
 * *"no app"* — blocking the product on a privacy refusal trades a 5.1.2 problem
 * for a 5.1.1(v)-shaped one. So `Not now` is a real, equally reachable choice
 * and `declineNote` says what it costs, which is little.
 *
 * **It is not dismissible by accident.** `onRequestClose` maps to the Android
 * back gesture and to nothing on iOS; it declines rather than closing silently,
 * because "the sheet went away" must never be recorded as a yes. There is
 * deliberately no backdrop tap.
 *
 * ── The copy is in `core`, and that is the point ────────────────────────────
 *
 * A consent whose wording differs between the phone and the web upload dialog
 * is two different consents, and only one of them is the one somebody actually
 * gave. `@crewchief/core/ai-consent-copy` holds both sheets' text.
 */
export default function AiConsentSheet({
  visible,
  copy,
  onAccept,
  onDecline,
}: {
  visible: boolean;
  copy: AiConsentCopy;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      /* The back gesture is a refusal, not a dismissal. See the docblock. */
      onRequestClose={onDecline}
    >
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.body}>
          <Text accessibilityRole="header" style={styles.title}>
            {copy.title}
          </Text>
          <Text style={styles.lead}>{copy.body}</Text>

          <View style={styles.points}>
            {copy.points.map((point) => (
              <View key={point} style={styles.point}>
                {/*
                  A bullet glyph rather than a list marker: React Native has no
                  list semantics, and the hanging indent is what makes a wrapped
                  line align under the text rather than under the mark.
                */}
                <Text style={styles.bullet}>{'•'}</Text>
                <Text style={styles.pointText}>{point}</Text>
              </View>
            ))}
          </View>

          <Text style={styles.declineNote}>{copy.declineNote}</Text>
        </ScrollView>

        <View style={styles.actions}>
          <Button label={copy.accept} variant="primary" onPress={onAccept} />
          {/*
            ⚠ A real control, not a quiet escape hatch. `outline` rather than
            `ghost`: a decline that reads as an afterthought is a decline
            somebody does not know they can make, which is the shape of consent
            the amendment exists to stop.
          */}
          <Pressable
            onPress={onDecline}
            accessibilityRole="button"
            accessibilityLabel={copy.decline}
            style={styles.decline}
          >
            <Text style={styles.declineLabel}>{copy.decline}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: surface.page },
  body: { ...PAGE_BODY, paddingTop: 64 },
  title: { ...type.editorial, color: text.primary, letterSpacing: -0.4 },
  lead: { ...type.body, color: text.secondary },

  points: {
    gap: space.sm,
    padding: space.lg,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: border.panel,
    backgroundColor: surface.card,
  },
  point: { flexDirection: 'row', gap: space.sm },
  bullet: { ...type.body, color: text.muted },
  pointText: { ...type.body, fontSize: 15, lineHeight: 21, color: text.primary, flex: 1 },

  declineNote: { ...type.value, color: text.muted },

  actions: { padding: PAGE_BODY.paddingHorizontal, gap: space.sm },
  decline: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  declineLabel: { ...type.uiStrong, color: text.secondary },
});
