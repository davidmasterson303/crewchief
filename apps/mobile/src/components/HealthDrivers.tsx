import { StyleSheet, Text, View } from 'react-native';
import { getHealthBandJudgement, healthBandHex } from '@crewchief/core/health-band';
import type { HealthDriver } from '@crewchief/core/health-drivers';

import { TABULAR, border, space, text, type } from '../theme';
import { interFace } from '../theme/fonts';

/**
 * What the health score is made of — the three drivers.
 *
 * ── ⚠ These do not add up to the score, and this component must not imply it ─
 *
 * `health_score` comes from the model. These three are **computed** from facts
 * the database holds — `evaluateSchedule` over the car's own schedule, the
 * NHTSA recall list, and mileage against model-year age. So they explain the
 * *subject* without arithmetically explaining the *total*.
 *
 * That is why they are laid out as three peers with their own labels, and never
 * as terms in a sum. No plus signs, no "= 74", no ordering that suggests one
 * contributes more than another. `health-drivers.ts` carries the same warning
 * at the source; this is where it would actually be broken.
 *
 * Whether `health_score` eventually becomes a function of the three is a
 * product decision that has not been taken.
 *
 * ── Why each driver carries a sentence ──────────────────────────────────────
 *
 * Because the card exists to be tapped. A number with no account of itself is
 * the black box this product's whole argument is against — and it is the reason
 * the drivers are computed rather than generated, since a driver the model
 * invented could not be explained at all.
 */
export default function HealthDrivers({ drivers }: { drivers: HealthDriver[] }) {
  if (drivers.length === 0) return null;

  return (
    <View style={styles.drivers}>
      {drivers.map((driver) => (
        <View key={driver.key} style={styles.driver}>
          <View style={styles.row}>
            <Text style={styles.label}>{driver.label}</Text>
            {/*
              ⚠ Banded on the same ramp as the score, because a driver *is* a
              reading on that scale — 40 means the same thing here as it does on
              the dial. An unmeasured driver takes the muted ink instead, never
              a band: colouring a `null` would assert a condition nobody checked,
              which is the overclaim the garage card's "no score is not a zero"
              rule exists to prevent.
            */}
            <Text
              style={[
                styles.reading,
                driver.score === null
                  ? styles.unknown
                  : { color: healthBandHex(getHealthBandJudgement(driver.score)) },
              ]}
            >
              {driver.score === null ? '—' : driver.score}
            </Text>
          </View>

          {/*
            Always present, including at `null`. A dash on its own reads as a
            bug; "Recalls have not been checked for this vehicle" reads as an
            honest gap, and it is the difference between the two that the
            sentence is carrying.
          */}
          <Text style={styles.detail}>{driver.detail}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  drivers: { gap: space.md },
  /**
   * Separated by a rule rather than by three nested cards.
   *
   * The card ladder has three steps and this is inside the second one; a third
   * box per driver would spend the whole ladder on one card and leave the
   * screen nowhere to go. A hairline is enough to group a label with its own
   * sentence.
   */
  driver: { gap: 2, paddingTop: space.md, borderTopWidth: 1, borderTopColor: border.panel },
  row: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  label: { ...type.uiStrong, color: text.primary },
  /** 20, tabular. A reading, not a heading — it must not reflow as it changes. */
  reading: { fontSize: 20, lineHeight: 24, fontFamily: interFace('700'), fontWeight: '700', ...TABULAR },
  unknown: { color: text.muted },
  detail: { ...type.value, color: text.muted },
});
