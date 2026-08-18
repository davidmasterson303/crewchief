import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Field from '../components/Field';
import { border, brand, radius, status, surface, text } from '../theme';

import {
  completionProblems,
  describeCompletion,
  emptyCompletion,
  type CompletionDraft,
  type CompletionProblem,
} from '@crewchief/core/wishlist-completion';
import { interFace } from '../theme/fonts';

/**
 * Marking a wishlist item done, on the phone.
 *
 * ── Why this is a sheet and not an inline row action ────────────────────────
 *
 * It writes into the car's permanent service history and deletes the wishlist
 * entry, with no undo. A one-tap "Done" on a list row would be the cheapest
 * possible gesture attached to the most consequential action on the screen —
 * and on a phone, the row under your thumb is the one you hit by accident.
 *
 * ── No date picker, deliberately ────────────────────────────────────────────
 *
 * `@react-native-community/datetimepicker` is a **native module**, and a native
 * module costs one of fifteen monthly cloud builds. The dates that matter here
 * are today and yesterday — you mark a job done when you have just done it — so
 * two chips cover almost every real case, and the field stays typeable for the
 * rest.
 *
 * ── Everything it decides lives in core ─────────────────────────────────────
 *
 * What is required, what a blank cost means, whether a date is allowed:
 * `@crewchief/core/wishlist-completion`. This file collects and displays. The
 * web dialog can adopt the same rules without either surface drifting, which
 * matters because both write to the same history table.
 */

export function MarkDoneSheet({
  visible,
  itemName,
  today,
  saving,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  itemName: string;
  /** ISO date, injected so the sheet has no clock of its own. */
  today: string;
  saving: boolean;
  onCancel: () => void;
  onConfirm: (draft: CompletionDraft) => void;
}) {
  const [draft, setDraft] = useState<CompletionDraft>(() => emptyCompletion(today));
  const [showProblems, setShowProblems] = useState(false);

  const problems = useMemo(() => completionProblems(draft, today), [draft, today]);
  const problemFor = (field: CompletionProblem['field']) =>
    showProblems ? problems.find((p) => p.field === field)?.message : undefined;

  function set(patch: Partial<CompletionDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function confirm() {
    /*
      Problems are computed continuously and *shown* only after a submit
      attempt. A form that turns red while you are still typing the first field
      is telling you off for not having finished, and on a phone it does it
      while the keyboard covers half the screen.
    */
    if (problems.length > 0) {
      setShowProblems(true);
      return;
    }
    onConfirm(draft);
  }

  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000)
    .toISOString()
    .slice(0, 10);

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onCancel}>
      <View style={styles.root}>
        <View style={styles.bar}>
          <Pressable onPress={onCancel} hitSlop={12} disabled={saving} accessibilityRole="button">
            <Text style={[styles.barAction, saving && styles.dim]}>Cancel</Text>
          </Pressable>
          <Text style={styles.barTitle} numberOfLines={1}>
            Mark done
          </Text>
          <View style={styles.barSpacer} />
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.item} numberOfLines={2}>
            {itemName}
          </Text>

          <FieldGroup label="Who did the work">
            <View style={styles.chipRow}>
              <Choice
                label="I did it"
                on={draft.isDIY}
                onPress={() => set({ isDIY: true })}
              />
              <Choice
                label="A shop did it"
                on={!draft.isDIY}
                onPress={() => set({ isDIY: false })}
              />
            </View>
          </FieldGroup>

          {!draft.isDIY && (
            <Field
              label="Shop"
              problem={problemFor('shopName')}
              value={draft.shopName}
              onChangeText={(shopName) => set({ shopName })}
              placeholder="Who did it"
              autoCapitalize="words"
            />
          )}

          <FieldGroup label="When" problem={problemFor('serviceDate')}>
            <View style={styles.chipRow}>
              <Choice
                label="Today"
                on={draft.serviceDate === today}
                onPress={() => set({ serviceDate: today })}
              />
              <Choice
                label="Yesterday"
                on={draft.serviceDate === yesterday}
                onPress={() => set({ serviceDate: yesterday })}
              />
            </View>
            <TextInput
              style={[styles.input, styles.inputTight, problemFor('serviceDate') && styles.inputBad]}
              value={draft.serviceDate}
              onChangeText={(serviceDate) => set({ serviceDate })}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={text.muted}
              accessibilityLabel="Service date"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </FieldGroup>

          {/*
            Both costs are optional and the label says so, because the honest
            answer at the moment a job finishes is often "I do not know yet" —
            and a guessed number in permanent history is worse than a blank one.
          */}
          <View style={styles.costRow}>
            <View style={styles.costCell}>
              <Field
                label="Parts"
                hint="Optional"
                problem={problemFor('partsCost')}
                value={draft.partsCost}
                onChangeText={(partsCost) => set({ partsCost })}
                placeholder="—"
                keyboardType="decimal-pad"
              />
            </View>
            <View style={styles.costCell}>
              <Field
                label="Labour"
                hint="Optional"
                problem={problemFor('laborCost')}
                value={draft.laborCost}
                onChangeText={(laborCost) => set({ laborCost })}
                placeholder="—"
                keyboardType="decimal-pad"
              />
            </View>
          </View>

          {/*
            What is about to happen, in a sentence, above the button that does
            it. The result lands in the service history — somewhere the user is
            not looking — so naming the destination is what makes this an
            informed tap rather than a hopeful one.
          */}
          <Text style={styles.consequence}>{describeCompletion(itemName, draft)}</Text>
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Mark done"
            accessibilityState={{ disabled: saving }}
            style={[styles.cta, saving && styles.ctaOff]}
            onPress={confirm}
            disabled={saving}
          >
            <Text style={styles.ctaText}>{saving ? 'Saving…' : 'Mark done'}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

/**
 * A labelled **group** — a label, arbitrary content, and a problem line.
 *
 * ⚠ This was called `Field`, and that name is why the primitive went unused
 * here: a local component wearing an import's name reads as adoption. It is the
 * third instance of the pattern in this app, after the advisor's `EmptyState`
 * and four private cards.
 *
 * It is genuinely not a `Field`. The primitive owns its own `TextInput`; this
 * wraps whatever it is given — a row of choice chips, or chips *and* an input
 * together. Where a group holds nothing but an input, the primitive is used
 * directly and this does not appear.
 */
function FieldGroup({
  label,
  hint,
  problem,
  children,
}: {
  label: string;
  hint?: string;
  problem?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      {children}
      {problem ? <Text style={styles.problem}>{problem}</Text> : null}
    </View>
  );
}

function Choice({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.choice, on && styles.choiceOn]}
    >
      <Text style={[styles.choiceText, on && styles.choiceTextOn]}>{label}</Text>
    </Pressable>
  );
}

/*
  Opaque colours throughout, measured against `surface.page`.
  `mobile-text-contrast.test.ts` composites opacity into its 4.5:1 check, and a
  translucent label on a form that writes permanent history is exactly what it
  exists to catch.
*/
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: surface.page },

  bar: {
    paddingTop: 64,
    paddingHorizontal: 20,
    paddingBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  barTitle: { color: text.primary, fontSize: 17, fontFamily: interFace('700'), fontWeight: '700' },
  barAction: { color: text.secondary, fontSize: 16, minWidth: 64 },
  barSpacer: { minWidth: 64 },
  dim: { color: text.muted },

  body: { paddingHorizontal: 20, paddingBottom: 32, gap: 20 },
  item: { color: text.primary, fontSize: 20, fontFamily: interFace('700'), fontWeight: '700', lineHeight: 26 },

  field: { gap: 8 },
  labelRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  label: { color: text.secondary, fontSize: 14, fontFamily: interFace('600'), fontWeight: '600' },
  hint: { color: text.muted, fontSize: 12 },
  problem: { color: status.dangerText, fontSize: 13, lineHeight: 18 },

  input: {
    backgroundColor: surface.raised,
    borderRadius: radius.button,
    borderWidth: 1,
    borderColor: border.field,
    paddingHorizontal: 14,
    // 16px is the system floor for a focusable input, adopted as a rule rather
    // than as a browser workaround — see RB0.
    fontSize: 16,
    color: text.primary,
    minHeight: 48,
  },
  inputTight: { marginTop: 8 },
  inputBad: { borderColor: status.dangerBorder },

  chipRow: { flexDirection: 'row', gap: 8 },
  choice: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.button,
    borderWidth: 1,
    borderColor: border.field,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceOn: { backgroundColor: brand.primary, borderColor: brand.primary },
  choiceText: { color: text.secondary, fontSize: 15, fontFamily: interFace('600'), fontWeight: '600' },
  // The v8 paired primary — #0E7490 with light ink measures 5.10:1. The pair
  // moves together; dark ink on this fill is 3.39:1 and fails.
  choiceTextOn: { color: text.onPrimary },

  costRow: { flexDirection: 'row', gap: 12 },
  costCell: { flex: 1 },

  consequence: { color: text.muted, fontSize: 13, lineHeight: 19 },

  footer: { paddingHorizontal: 20, paddingBottom: 40, paddingTop: 8 },
  cta: {
    minHeight: 52,
    borderRadius: radius.card,
    backgroundColor: brand.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // An explicit fill rather than `opacity`, so the contrast audit can see it —
  // a parent alpha never reaches the comparison.
  ctaOff: { backgroundColor: surface.disabled },
  ctaText: { color: text.onPrimary, fontSize: 16, fontFamily: interFace('700'), fontWeight: '700' },
});
