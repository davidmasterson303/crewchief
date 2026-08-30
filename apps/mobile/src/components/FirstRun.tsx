import { StyleSheet, Text, View } from 'react-native';

import EmptyState from './EmptyState';
import { border, space, text, type } from '../theme';

/**
 * What Well Kept does, said once, to someone who has never had a car in it.
 *
 * ── ⚠ Not a route, and that is deliberate ───────────────────────────────────
 *
 * This renders *inside* the garage, in place of its empty state, under the
 * garage's own header. A full-screen takeover was the first instinct and
 * `GarageScreen`'s header carries the argument against it: **"an affordance
 * placed in one branch of a screen that renders several"** is how the account
 * control went missing once already. Covering the whole screen here would hide
 * Account from the one person most likely to need it — somebody who has just
 * signed up, cannot work out what this is, and wants to sign out or delete the
 * account they just made.
 *
 * So the header stays, and this replaces only the body.
 *
 * ── The copy is three promises the product actually keeps ───────────────────
 *
 * Every line below was checked against the code before it was written, because
 * this is the one screen whose job is to make claims and the one place an
 * overclaim is invisible — nobody can contradict it yet, since they have no car
 * in the product to check it against.
 *
 * ⚠ **In particular there is no VIN claim.** `lib/vehicle-research.ts` fetches
 * recalls from `recallsByVehicle?make=…&model=…&modelYear=…`, so the match is
 * at model level and not to a specific car. "Recalls checked against your VIN"
 * would be the more impressive sentence and it would be false — and false in
 * the direction that matters, telling an owner their particular car is clear
 * when only its model was looked at.
 *
 * The schedule line is the opposite case, where the true claim is the stronger
 * one: `service-due.ts` exists precisely because a generic interval table was
 * rejected — *"a Honda and a BMW do not share an interval"* — so "not a generic
 * table" is a real difference rather than a boast.
 */

/** One promise. A word, and the sentence that keeps it. */
const PROMISES = [
  {
    title: 'What it needs, and when',
    body: 'The schedule for your car specifically — not a generic table of intervals.',
  },
  {
    title: 'Recalls, watched',
    body: 'Open safety recalls from NHTSA for its year, make and model, so you hear about one before it becomes a problem.',
  },
  {
    title: 'Somewhere to ask',
    body: 'An advisor that already knows its history, its open issues and its recalls. You do not need to explain the car to it.',
  },
];

export default function FirstRun({ onAddVehicle }: { onAddVehicle: () => void }) {
  return (
    <EmptyState
      headline="Start with one car"
      /*
        What happens *after* the tap, in one sentence, because that is the thing
        being asked for on trust. "Add your first car and Well Kept gets to work
        on it" — the copy this replaces — described the button rather than the
        product.
      */
      body="Add it and Well Kept researches it: what it needs, what has been recalled, and what the work should cost."
      actionLabel="Add your first car"
      onAction={onAddVehicle}
    >
      <View style={styles.promises}>
        {PROMISES.map((promise, index) => (
          <View
            key={promise.title}
            // A rule between items rather than around them — the list is one
            // thing with parts, not three cards competing with the action above.
            style={[styles.promise, index > 0 && styles.divided]}
          >
            <Text style={styles.promiseTitle}>{promise.title}</Text>
            <Text style={styles.promiseBody}>{promise.body}</Text>
          </View>
        ))}
      </View>

      {/*
        ⚠ The one line about money, and it is a limit rather than a feature.

        `advice-range.ts` is explicit that this posture holds on *every* advice
        surface, and this screen is where the expectation gets set. Someone told
        "what the work should cost" above will read a single number as a promise
        of one; saying now that it is a range costs one sentence here and saves
        the product being wrong later.
      */}
      <Text style={styles.caveat}>
        Costs come as ranges. A single number would be a guess, and you would be
        the one paying for it.
      </Text>
    </EmptyState>
  );
}

const styles = StyleSheet.create({
  promises: { width: '100%', marginTop: space.lg },
  promise: { paddingVertical: space.md, gap: space.xs },
  divided: { borderTopWidth: 1, borderTopColor: border.panel },
  promiseTitle: { ...type.uiStrong, color: text.primary },
  /*
    Left-aligned, where `EmptyState`'s own headline and body are centred. Three
    sentences of centred prose is a wedding invitation; these are read as a
    list, and a ragged left edge makes each one restart.
  */
  promiseBody: { ...type.value, color: text.secondary, textAlign: 'left' },
  caveat: { ...type.value, color: text.muted, marginTop: space.md, textAlign: 'left' },
});
