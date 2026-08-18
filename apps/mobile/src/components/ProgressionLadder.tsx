import { StyleSheet, Text, View } from 'react-native';
import { ROLE_LADDER, roleLabel, type ModRole } from '@crewchief/core/mod-progression';

import { border, radius, register, space, surface, text, type } from '../theme';

/**
 * The five rungs, and where this car is on them.
 *
 * ── What it is for ──────────────────────────────────────────────────────────
 *
 * `nextRungs` answers "what should I do next"; it does not answer "why that,
 * and not the turbo". The ladder is the second question drawn: **foundation,
 * then control, then the parts that enable the next step, then the parts that
 * keep it alive, then appearance.** An owner who can see the sequence can
 * disagree with it, which is the point — a recommendation with no visible
 * reasoning is a black box, and this product's whole argument is that it is not
 * one.
 *
 * ── Cold start is the normal case, not the empty state ──────────────────────
 *
 * ⚠ `modification_tracking` is **empty across the entire product** — nobody has
 * recorded a completed mod. So the overwhelmingly common render is *nothing
 * done, foundation next*, and that is not a failure to design around with an
 * `EmptyState`: with no history, the first step genuinely is the first step.
 * The ladder shows the whole scale from the first launch and marks where the
 * car actually is. `mod-progression.ts` makes the same argument in its header.
 *
 * ── Why the wording is imported ─────────────────────────────────────────────
 *
 * `roleLabel` lives in core for the reason `progressionSummary` does: a rung the
 * phone calls "Handling" and the web calls "Control" is two ladders. In
 * particular `control` reads "Control before more power", because the rung's
 * argument is *when* it comes rather than what it contains, and that argument is
 * product judgement rather than copy for this screen to choose.
 */
export default function ProgressionLadder({
  /** Roles this car already has completed work in. Usually empty — see above. */
  done = [],
  /** The role the next suggested part sits on. `nextRungs(...)[0].role`. */
  next,
}: {
  done?: ModRole[];
  next?: ModRole;
}) {
  const completed = new Set(done);

  return (
    <View accessibilityRole="list" accessibilityLabel="Build progression" style={styles.ladder}>
      {ROLE_LADDER.map((role, index) => {
        const isDone = completed.has(role);
        const isNext = role === next;
        const last = index === ROLE_LADDER.length - 1;

        return (
          <View key={role} accessibilityRole="text" style={styles.rung}>
            {/*
              The rail and the marker.

              A fixed-width column so every label starts on the same x whatever
              its marker is doing — a ladder whose rungs do not line up is a
              list with dots.
            */}
            <View style={styles.rail}>
              <View
                style={[styles.marker, isDone && styles.markerDone, isNext && styles.markerNext]}
              />
              {/*
                The connector, drawn *below* each marker except the last. A
                trailing segment under the final rung would imply a sixth rung
                that does not exist — the ladder is five, and the product's
                position is that a build has no end but the *scale* does.
              */}
              {!last && <View style={[styles.connector, isDone && styles.connectorDone]} />}
            </View>

            <View style={styles.body}>
              <Text style={[styles.label, isDone && styles.labelDone, isNext && styles.labelNext]}>
                {roleLabel(role)}
              </Text>

              {/*
                One state word, never both. A rung cannot be finished and next
                at the same time, and rendering two chips where one is possible
                is how a "done · next" appears in a screenshot nobody can
                explain.

                These read as words rather than colour alone — a marker that
                only changed hue would carry the entire state on a 10pt dot,
                which fails for anyone who cannot separate the two.
              */}
              {isDone ? (
                <Text style={styles.stateDone}>done</Text>
              ) : isNext ? (
                <Text style={styles.stateNext}>next</Text>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const MARKER = 10;
const RAIL = 20;

const styles = StyleSheet.create({
  ladder: { gap: 0 },
  rung: { flexDirection: 'row', gap: space.md },
  rail: { width: RAIL, alignItems: 'center' },
  marker: {
    width: MARKER,
    height: MARKER,
    borderRadius: radius.pill,
    marginTop: space.xs,
    backgroundColor: surface.well,
    borderWidth: 1,
    borderColor: border.field,
  },
  /** Filled — this rung is behind the car. */
  markerDone: { backgroundColor: register.accent, borderColor: register.accent },
  /**
   * Ringed rather than filled. The marker for "next" is an outline because the
   * work has not happened; filling it would make a suggestion look like a
   * record.
   */
  markerNext: { borderColor: register.accent, borderWidth: 2, backgroundColor: surface.page },
  connector: {
    flex: 1,
    width: 1,
    marginTop: space.xs,
    marginBottom: space.xs,
    backgroundColor: border.panel,
  },
  connectorDone: { backgroundColor: border.field },

  body: { flex: 1, paddingBottom: space.lg, gap: space.xs },
  label: { ...type.ui, color: text.secondary },
  /**
   * A completed rung goes quiet, not bright. It is history; the eye belongs on
   * the rung that is next.
   */
  labelDone: { color: text.muted },
  labelNext: { ...type.uiStrong, color: text.primary },

  stateDone: { ...type.label, color: text.muted },
  stateNext: { ...type.label, color: register.accent },
});
