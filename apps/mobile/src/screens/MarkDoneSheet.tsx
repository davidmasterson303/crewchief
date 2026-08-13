import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  completionProblems,
  describeCompletion,
  emptyCompletion,
  type CompletionDraft,
  type CompletionProblem,
} from '@crewchief/core/wishlist-completion';

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

          <Field label="Who did the work">
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
          </Field>

          {!draft.isDIY && (
            <Field label="Shop" problem={problemFor('shopName')}>
              <TextInput
                style={[styles.input, problemFor('shopName') && styles.inputBad]}
                value={draft.shopName}
                onChangeText={(shopName) => set({ shopName })}
                placeholder="Who did it"
                placeholderTextColor="#7A7A7A"
                accessibilityLabel="Shop name"
                autoCapitalize="words"
              />
            </Field>
          )}

          <Field label="When" problem={problemFor('serviceDate')}>
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
              placeholderTextColor="#7A7A7A"
              accessibilityLabel="Service date"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </Field>

          {/*
            Both costs are optional and the label says so, because the honest
            answer at the moment a job finishes is often "I do not know yet" —
            and a guessed number in permanent history is worse than a blank one.
          */}
          <View style={styles.costRow}>
            <View style={styles.costCell}>
              <Field label="Parts" hint="Optional" problem={problemFor('partsCost')}>
                <TextInput
                  style={[styles.input, problemFor('partsCost') && styles.inputBad]}
                  value={draft.partsCost}
                  onChangeText={(partsCost) => set({ partsCost })}
                  placeholder="—"
                  placeholderTextColor="#7A7A7A"
                  accessibilityLabel="Parts cost"
                  keyboardType="decimal-pad"
                />
              </Field>
            </View>
            <View style={styles.costCell}>
              <Field label="Labour" hint="Optional" problem={problemFor('laborCost')}>
                <TextInput
                  style={[styles.input, problemFor('laborCost') && styles.inputBad]}
                  value={draft.laborCost}
                  onChangeText={(laborCost) => set({ laborCost })}
                  placeholder="—"
                  placeholderTextColor="#7A7A7A"
                  accessibilityLabel="Labour cost"
                  keyboardType="decimal-pad"
                />
              </Field>
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

function Field({
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
  Opaque colours throughout, measured against `#080808`.
  `mobile-text-contrast.test.ts` composites opacity into its 4.5:1 check, and a
  translucent label on a form that writes permanent history is exactly what it
  exists to catch.
*/
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#080808' },

  bar: {
    paddingTop: 64,
    paddingHorizontal: 20,
    paddingBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  barTitle: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  barAction: { color: '#E6E6E6', fontSize: 16, minWidth: 64 },
  barSpacer: { minWidth: 64 },
  dim: { color: '#8F8F8F' },

  body: { paddingHorizontal: 20, paddingBottom: 32, gap: 20 },
  item: { color: '#FFFFFF', fontSize: 20, fontWeight: '700', lineHeight: 26 },

  field: { gap: 8 },
  labelRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  label: { color: '#E6E6E6', fontSize: 14, fontWeight: '600' },
  hint: { color: '#9A9A9A', fontSize: 12 },
  problem: { color: '#F2A3A3', fontSize: 13, lineHeight: 18 },

  input: {
    backgroundColor: '#161616',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2C2C2C',
    paddingHorizontal: 14,
    // 16px is the system floor for a focusable input, adopted as a rule rather
    // than as a browser workaround — see RB0.
    fontSize: 16,
    color: '#FFFFFF',
    minHeight: 48,
  },
  inputTight: { marginTop: 8 },
  inputBad: { borderColor: '#8C4B4B' },

  chipRow: { flexDirection: 'row', gap: 8 },
  choice: {
    flex: 1,
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2C2C2C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceOn: { backgroundColor: '#0E7490', borderColor: '#0E7490' },
  choiceText: { color: '#E6E6E6', fontSize: 15, fontWeight: '600' },
  // The v8 paired primary — #0E7490 with light ink measures 5.10:1. The pair
  // moves together; dark ink on this fill is 3.39:1 and fails.
  choiceTextOn: { color: '#F2FBFD' },

  costRow: { flexDirection: 'row', gap: 12 },
  costCell: { flex: 1 },

  consequence: { color: '#B8B8B8', fontSize: 13, lineHeight: 19 },

  footer: { paddingHorizontal: 20, paddingBottom: 40, paddingTop: 8 },
  cta: {
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: '#0E7490',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // An explicit fill rather than `opacity`, so the contrast audit can see it —
  // a parent alpha never reaches the comparison.
  ctaOff: { backgroundColor: '#4A4A4A' },
  ctaText: { color: '#F2FBFD', fontSize: 16, fontWeight: '700' },
});
