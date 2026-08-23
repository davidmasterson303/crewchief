import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type TextInputProps,
} from 'react-native';

import Field from './Field';
import { TARGET_MIN, border, radius, space, surface, text, type } from '../theme';

/**
 * A text field that offers what it knows, and still takes what it does not.
 *
 * ── Why this is a field with a list under it, and not a picker ──────────────
 *
 * A picker asserts that the list is complete. This product's lists are not:
 * `COMMON_MAKES` is 56 marques an owner in this market is likely to pick, and
 * vPIC's model list is whatever NHTSA has registered for one make in one year,
 * which is missing plenty of grey imports and every kit car. A control that
 * cannot express "mine is not in here" would refuse those cars outright, which
 * is `CLAUDE.md` §10 broken in the most literal way available — asserting a
 * precision the data does not have.
 *
 * So the input is always a real text input, the suggestions are an accelerator,
 * and nothing here can block a submit. The list going missing — offline, vPIC
 * down, a make nobody has registered — degrades this to exactly the field that
 * shipped before it.
 *
 * ── Inline, not floating ────────────────────────────────────────────────────
 *
 * The suggestions push the form down rather than overlaying it. An absolutely
 * positioned dropdown inside a `ScrollView` is clipped by the scroller on
 * Android and mis-measures on iOS the moment the keyboard resizes the frame,
 * and the failure is invisible in a simulator held at one size. Pushing costs a
 * little movement and works everywhere.
 *
 * ⚠ The scroller above this **must** carry `keyboardShouldPersistTaps="handled"`
 * or the first tap on a suggestion is swallowed dismissing the keyboard, and
 * the owner has to tap every choice twice. `AddVehicleScreen` sets it; it is
 * noted here because this component cannot.
 *
 * ── Which panel is open is the form's business, not this component's ────────
 *
 * `open` is a prop rather than internal focus state, and the reason is a bug
 * that only appears with more than one of these on a screen. Nothing here
 * closes on blur — see the ⚠ at `onFocus` for why it must not — so a component
 * owning its own open flag would leave every panel it had ever opened on
 * screen at once, each shoving the form further down as the owner tabs through
 * it.
 *
 * One `openField` in the parent makes focusing the model close the make, which
 * is the behaviour anyone would expect and cannot be built from local state.
 */
export default function Suggest({
  label,
  hint,
  problem,
  value,
  onChangeText,
  onPick,
  suggestions,
  loading = false,
  quiet,
  open,
  onOpen,
  ...input
}: {
  label: string;
  hint?: string;
  problem?: string;
  value: string;
  onChangeText: (next: string) => void;
  /**
   * A suggestion was taken.
   *
   * Separate from `onChangeText` because the form has to tell the two apart:
   * typing keeps the panel open, choosing closes it, and one callback carrying
   * both cannot express that.
   */
  onPick: (chosen: string) => void;
  /** What to offer, already filtered and ordered by the caller. */
  suggestions: readonly string[];
  /** A lookup is in flight. Shown rather than hidden — see `quiet`. */
  loading?: boolean;
  /**
   * What to say when there is nothing to offer and nothing in flight.
   *
   * Optional, and omitting it renders no panel at all. When it is given it
   * should say *why* the list is empty — "No models listed for a 2015 BMW" is
   * an answer; a silent absence is indistinguishable from a broken lookup, and
   * this product would rather say it cannot tell you.
   */
  quiet?: string;
  /** Whether this field's panel is the one showing. Owned by the form. */
  open: boolean;
  /** This field took focus, and is asking to be the open one. */
  onOpen: () => void;
} & Omit<TextInputProps, 'value' | 'onChangeText' | 'style'>) {
  const showing = open && (loading || suggestions.length > 0 || Boolean(quiet));

  return (
    <View style={styles.wrap}>
      <Field
        label={label}
        hint={hint}
        problem={problem}
        value={value}
        onChangeText={onChangeText}
        onFocus={onOpen}
        /*
          ⚠ No `onBlur` closing this.

          Tapping a suggestion blurs the input, and on iOS the blur lands before
          the press — so closing on blur unmounts the row under the finger and
          the tap goes nowhere. It is the single most common way a typeahead is
          shipped broken, and it is untestable by looking at it in a simulator
          with a mouse. The panel closes on `onPick`, or when another field
          takes over — both are moments it is certainly finished with.
        */
        autoCorrect={false}
        {...input}
      />

      {showing ? (
        <View style={styles.panel}>
          {loading ? (
            <View style={styles.note}>
              <ActivityIndicator color={text.muted} />
              <Text style={styles.noteText}>Looking these up…</Text>
            </View>
          ) : suggestions.length > 0 ? (
            suggestions.map((suggestion) => (
              <Pressable
                key={suggestion}
                onPress={() => onPick(suggestion)}
                accessibilityRole="button"
                /*
                  Named with the field it fills. A screen reader moving through
                  a form that offers eight bare marque names has no way to know
                  which question they answer.
                */
                accessibilityLabel={`${suggestion}, use as ${label.toLowerCase()}`}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              >
                <Text style={styles.rowText}>{suggestion}</Text>
              </Pressable>
            ))
          ) : (
            <View style={styles.note}>
              <Text style={styles.noteText}>{quiet}</Text>
            </View>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  /*
    A card step above the field's well, so the list reads as something laid over
    the form rather than as more form. The border does the separating at the top
    edge, where the panel meets the input it belongs to.
  */
  panel: {
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: border.field,
    backgroundColor: surface.card,
    overflow: 'hidden',
  },
  /** 44 is the floor, and a list of choices is the last place to shave it. */
  row: {
    minHeight: TARGET_MIN,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  rowPressed: { backgroundColor: surface.well },
  rowText: { ...type.body, color: text.primary },
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: TARGET_MIN,
    paddingHorizontal: space.md,
  },
  noteText: { ...type.value, color: text.muted },
});
