import { StyleSheet, Text, View } from 'react-native';

import { formatRange } from '@crewchief/core/advice-range';
import { adviceDisclosure } from '@crewchief/core/advice-disclosure';
import type { ConsultantEstimate } from '@crewchief/core/consultant-estimate';

import Well from './Well';
import { border, space, text, type } from '../theme';

/**
 * The estimate under an advisor answer.
 *
 * ── `Well`'s first caller, and the one it was built for ─────────────────────
 *
 * Board screen 04: *"Answers are unboxed; **the estimate is a well**; provenance
 * is a claim, never a badge."* `Well` shipped on 14 Aug with no caller and its
 * header said why — the numbers did not exist. `POST /api/v1/consultant`
 * returned prose and nothing else, which was gap 4 in
 * `docs/step4-api-gaps.md`. The route now returns a structured `estimate`, so
 * this is that gap closed rather than a new component.
 *
 * ⚠ The primitive's warning still applies to everyone else: *"Do not adopt it
 * to close the gap. A well pressed into service as a card, a bubble or a panel
 * is worse than an unused file."* This is a recess holding figures the
 * surrounding answer is talking about, which is the one thing it is for.
 *
 * ── Why the answer above it stays unboxed ───────────────────────────────────
 *
 * The prose is not in a card and this is. That asymmetry is the design: an
 * advisor answer is speech and boxing it makes it a document, while the prices
 * are a *thing being referred to* and want an edge. Putting both in cards would
 * make the estimate a second, competing object — the exact confusion `Well`'s
 * "a well is not a card" note exists to prevent.
 */
export default function EstimateWell({ estimate }: { estimate: ConsultantEstimate }) {
  return (
    <Well style={styles.well}>
      {/*
        The framing sentence, and every word of it is load-bearing.

        "Estimated" not "Cost". "For this vehicle" because the numbers came out
        of an answer that had the car's context in front of it, and saying so is
        the provenance claim the board asks for — a sentence, never a badge.

        ⚠ There is deliberately no "in your area". The board's drawn copy reads
        "for this vehicle in your area", and this app has no location: the
        consultant prompt receives no postcode, no region, nothing. The same
        rule `describeQuote` already follows for its optional `area` — omitted
        rather than defaulted, because "in your area" with no location is a
        claim of local knowledge nobody supplied.
      */}
      <Text style={styles.caption}>Estimated, for this vehicle</Text>

      {estimate.lines.map((line) => (
        <View key={line.label} style={styles.row}>
          <Text style={styles.label} numberOfLines={2}>
            {line.label}
          </Text>
          {/*
            The price never wraps and never shrinks. On a narrow phone something
            has to give, and it is the label — a truncated job name is still
            recognisable, while "$110–" on one line and "$160" on the next reads
            as two different numbers.
          */}
          <Text style={styles.amount}>{formatRange(line.range)}</Text>
        </View>
      ))}

      {estimate.likely ? (
        <View style={[styles.row, styles.total]}>
          {/*
            "Most likely" and not "Total", because it is not one. The server
            takes this figure from the model rather than summing the lines
            above, precisely so a line marked "if needed" is not charged for
            when it probably is not needed — so a reader who adds up the rows
            and gets a different number is seeing the feature, not a bug. The
            wording is what tells them that.
          */}
          <Text style={styles.likelyLabel}>Most likely</Text>
          <Text style={styles.likelyAmount}>{formatRange(estimate.likely)}</Text>
        </View>
      ) : null}

      {/*
        ── ⚠ UX-16 / D11 · the estimate is its own claim ─────────────────────

        The advisor's answer above already carries `adviceDisclosure`
        ('consultant'), and that is not sufficient here. This block is where the
        prose stops and *numbers* start — a reader who skims the answer and
        stops on the figures has read a set of prices with no provenance
        attached, and prices are the thing they will repeat to a shop.

        The estimate surface says what the consultant one does not: that the
        real number depends on the shop, the parts and what they find. That is
        the caveat specific to money, and it is why `advice-disclosure.ts`
        models four surfaces rather than one string.
      */}
      <Text style={styles.disclosure}>{adviceDisclosure('estimate')}</Text>
    </Well>
  );
}

const styles = StyleSheet.create({
  well: { marginTop: space.sm },
  /*
    13/400, the quietest role above the 12px floor. Not `type.label` — that is
    600 weight at 0.6 tracking, which reads as a section heading and would make
    this framing sentence compete with the prices it is introducing.
  */
  caption: { ...type.value, color: text.muted },
  /*
    Same role as the caption that opens the well — quiet, above the 12px floor,
    and deliberately not `type.label`, which would make a caveat compete with
    the prices it qualifies.
  */
  disclosure: { ...type.value, color: text.muted, marginTop: space.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: space.md,
  },
  /** Takes the slack, so the amount keeps its intrinsic width. */
  label: { ...type.body, color: text.secondary, flex: 1 },
  amount: { ...type.body, color: text.primary },
  total: {
    borderTopWidth: 1,
    borderTopColor: border.panel,
    paddingTop: space.sm,
  },
  /*
    16/600 — the same size as the lines above, one weight up. The total is a
    summary of them, not a different kind of thing, so it earns emphasis rather
    than a separate role.
  */
  likelyLabel: { ...type.bodyStrong, color: text.primary, flex: 1 },
  likelyAmount: { ...type.bodyStrong, color: text.primary },
});
