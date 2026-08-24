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

            {/*
              ── R45 · the state is a chip beside the rung, not under it ─────

              `done` and `next` were a **second line of muted text under the
              rung's name**, which reads as a subtitle that has been truncated
              to one word — the review's phrasing was "a broken subtitle", and
              that is exactly what it looked like. A state is not a description
              of the thing; it is a mark on it.

              So they sit on the rung's own line, right-aligned. The row's name
              takes the slack and the state keeps its width.

              One state word, never both. A rung cannot be finished and next at
              the same time, and rendering two where one is possible is how a
              "done · next" appears in a screenshot nobody can explain.

              ⚠ These stay **words**, not colour alone. A marker that only
              changed hue would carry the entire state on a 10pt dot, which
              fails for anyone who cannot separate the two.
            */}
            <View style={styles.body}>
              <Text
                style={[styles.label, isDone && styles.labelDone, isNext && styles.labelNext]}
              >
                {roleLabel(role)}
              </Text>

              {isDone ? (
                <Text style={[styles.state, styles.stateDone]}>done</Text>
              ) : isNext ? (
                <Text style={[styles.state, styles.stateNext]}>next</Text>
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

  /* R45. One line: the name takes the slack, the state keeps its width. */
  body: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    paddingBottom: space.lg,
  },
  label: { ...type.ui, color: text.secondary, flexShrink: 1 },
  /**
   * A completed rung goes quiet, not bright. It is history; the eye belongs on
   * the rung that is next.
   */
  labelDone: { color: text.muted },
  labelNext: { ...type.uiStrong, color: text.primary },

  /*
    Chip-shaped: a hairline pill rather than a bare word, so the state reads as
    a mark on the rung rather than as more of its label. `Chip` itself is not
    used — its five tones are the status families (attention, critical,
    confirm), and "next" is neither a status nor a severity. It is where the
    car is on a scale, which is the register accent's own job.
  */
  state: {
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: space.sm,
    paddingVertical: 1,
  },
  stateDone: { ...type.label, color: text.muted, borderColor: border.field },
  stateNext: { ...type.label, color: register.accent, borderColor: register.accent },
});
