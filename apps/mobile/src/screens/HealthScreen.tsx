import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import Button from '../components/Button';
import Card from '../components/Card';
import ClusterGauge, { HERO_SIZE } from '../components/ClusterGauge';
import HealthDrivers from '../components/HealthDrivers';
import HealthHistory, { type HealthReading } from '../components/HealthHistory';
import Plinth from '../components/Plinth';
import SectionHeader from '../components/SectionHeader';
import { Skeleton, SkeletonCard } from '../components/Skeleton';
import { apiRequest, ApiRequestError } from '../api/client';
import type { HealthDriver } from '@crewchief/core/health-drivers';
import { getHealthBandJudgement } from '@crewchief/core/health-band';
import { space, text, type } from '../theme';

/**
 * The score, and everything behind it.
 *
 * ── Why this is a screen and not three cards on the vehicle hub ─────────────
 *
 * `VehicleDetailScreen` carried the dial, the summary, the three drivers and
 * the history chart, plus a build dial, a ladder and five detail rows. David's
 * note on 23 Aug: *"really, the whole information architecture is unclear,
 * cluttered, uninspired and confusing."*
 *
 * The design system agrees and says why —
 * `specs/native-vehicle-detail.spec.html` is **"a hub, not tabs"**: the vehicle
 * screen names a car and lists places to go, and *"every section is a real
 * pushed route with a real back gesture … on a phone a stack is the better
 * shape, because each destination gets the full screen and the platform's own
 * back."*
 *
 * So the reading stays on the hub — one dial, one word, one sentence — and the
 * *account of it* lives here, where there is room for the drivers to have their
 * explanations and the chart to be a chart.
 *
 * ── ⚠ The hero dial, and this is the screen that earns it ───────────────────
 *
 * The board's rule is *"one dial per screen"* and puts the 184pt hero on the
 * garage bay. The vehicle hub therefore takes the 104pt card dial — a second
 * hero on it would be a second screen claiming the same instrument. Here there
 * is exactly one dial and it is the subject, so it is drawn at hero size.
 *
 * ── The drivers do not add up to the score, and are not presented as if ─────
 *
 * `health_score` comes from the model; the three drivers are computed from the
 * schedule, the recall list and mileage against age. They explain the subject
 * without summing to it, which is why they sit **below** the summary rather
 * than beside the dial — three numbers next to a total invite arithmetic that
 * does not hold.
 */

interface HealthSummary {
  health_score?: number | null;
  summary?: string | null;
}

interface HealthResponse {
  vehicle?: {
    year?: number | null;
    make?: string | null;
    model?: string | null;
    vehicle_health_summary?: HealthSummary | HealthSummary[] | null;
  };
  /*
    ⚠ Both are **top level**, and both are snake_case — `health_drivers` and
    `health_history`, not `drivers` and `history`. They sit outside `vehicle`
    because they are computed rather than stored, which `load-vehicle`'s own
    docblock argues keeps a derived value from reading as a column. Getting
    either name wrong here is silent: the arrays are optional, so the screen
    renders a score with no account of it and nothing reports a thing.
  */
  health_drivers?: HealthDriver[];
  health_history?: HealthReading[];
}

function first<T>(value: T | T[] | null | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : (value ?? undefined);
}

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'gone' }
  | {
      kind: 'loaded';
      name: string;
      /** `null` is "we cannot say", and it is never drawn as a zero. */
      score: number | null;
      summary: string | null;
      drivers: HealthDriver[];
      history: HealthReading[];
    };

export function HealthScreen({
  vehicleId,
  title,
  onSignOut,
}: {
  vehicleId: string;
  title?: string;
  onSignOut: () => void;
}) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setState({ kind: 'loading' });

      try {
        const data = await apiRequest<HealthResponse>(
          `/load-vehicle?vehicleId=${encodeURIComponent(vehicleId)}`
        );

        const health = first(data.vehicle?.vehicle_health_summary);

        setState({
          kind: 'loaded',
          name:
            [data.vehicle?.year, data.vehicle?.make, data.vehicle?.model]
              .filter(Boolean)
              .join(' ') ||
            title ||
            'this car',
          score: typeof health?.health_score === 'number' ? health.health_score : null,
          summary: health?.summary ?? null,
          drivers: Array.isArray(data.health_drivers) ? data.health_drivers : [],
          history: Array.isArray(data.health_history) ? data.health_history : [],
        });
      } catch (error) {
        if (error instanceof ApiRequestError && error.status === 401) {
          onSignOut();
          return;
        }
        if (error instanceof ApiRequestError && error.status === 404) {
          setState({ kind: 'gone' });
          return;
        }
        setState({
          kind: 'error',
          message: error instanceof Error ? error.message : 'Could not load this score',
        });
      } finally {
        setRefreshing(false);
      }
    },
    [vehicleId, title, onSignOut]
  );

  useEffect(() => {
    void load();
  }, [load]);

  if (state.kind === 'loading') {
    return (
      <ScrollView contentContainerStyle={styles.body}>
        <Skeleton height={220} />
        <SkeletonCard lines={3} />
        <SkeletonCard lines={2} />
      </ScrollView>
    );
  }

  if (state.kind === 'gone') {
    return (
      <View style={styles.centre}>
        <Text style={styles.errorTitle}>This vehicle is no longer here</Text>
        <Text style={styles.errorBody}>It may have been removed from another device.</Text>
      </View>
    );
  }

  if (state.kind === 'error') {
    return (
      <View style={styles.centre}>
        <Text style={styles.errorTitle}>Could not load this score</Text>
        <Text style={styles.errorBody}>{state.message}</Text>
        <Button label="Try again" variant="outline" onPress={() => void load()} />
      </View>
    );
  }

  const band = state.score === null ? null : getHealthBandJudgement(state.score);

  return (
    <ScrollView
      contentContainerStyle={styles.body}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void load(true)}
          tintColor={text.muted}
        />
      }
    >
      <Card>
        {state.score !== null && band ? (
          <>
            <Plinth>
              <ClusterGauge score={state.score} size={HERO_SIZE} />
            </Plinth>
            {state.summary ? <Text style={styles.summary}>{state.summary}</Text> : null}
          </>
        ) : (
          /*
            No score is not a zero and not an empty dial. A dial drawn at 0
            asserts a reading; this says there is none — the same rule the
            garage bay follows, and `advice-range.ts` carries why the product
            says "we cannot say" rather than guessing a default.
          */
          <Text style={styles.summary}>
            No score yet. We work one out once we have looked this car over — that happens a
            few seconds after it is added, and again as work is recorded.
          </Text>
        )}
      </Card>

      {state.drivers.length > 0 && (
        <Card>
          <SectionHeader title="What is driving it" />
          <HealthDrivers drivers={state.drivers} />
        </Card>
      )}

      {/*
        ⚠ Nothing at all below two readings, rather than an empty panel under a
        heading. `HealthHistory` declines to draw a one-point chart — correctly,
        because a one-point chart is a dot — and a `Card` around it would still
        render the title, which reads as a load that failed.

        That is the state this account is in today: one recorded reading for the
        real car, so this appears once the sweep has run twice.
      */}
      {state.history.length >= 2 && (
        <Card>
          <SectionHeader title="Over time" />
          <HealthHistory history={state.history} />
        </Card>
      )}

      <Text style={styles.footnote}>
        The score is an assessment from what we know about {state.name} — its schedule, its
        recorded work and its mileage for its age. It is not an inspection.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.lg, gap: space.md, paddingBottom: space.h2 },
  centre: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.h1,
    gap: space.sm,
  },
  errorTitle: { ...type.title, color: text.primary },
  errorBody: { ...type.body, color: text.muted, textAlign: 'center' },
  summary: { ...type.body, color: text.secondary },
  footnote: { ...type.value, color: text.muted },
});
