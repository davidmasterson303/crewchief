import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { apiRequest, ApiRequestError } from '../api/client';
import {
  hasRemedy,
  normaliseRecalls,
  type NormalisedRecall,
  type RecallSeverity,
} from '@crewchief/core/recalls';

/**
 * Phase 5.6 — where a recall notification lands.
 *
 * Replaces the placeholder on `VehicleDetailScreen`, which said "Recall detail
 * is on the web for now."
 *
 * ── Why this exists rather than the advisor ─────────────────────────────────
 *
 * The notification used to open the advisor with the question pre-typed, and
 * that was a reasonable answer to "explain this". David's call on 7 Aug was that
 * the point of the alert is to drive an action, not only to explain — so the
 * destination is a screen with the notice, what it means, and what to do about
 * it, and the advisor is one of the things you can do from it.
 *
 * ── The severity banner is the whole reason this is not a list ──────────────
 *
 * NHTSA sends `parkIt` and `parkOutSide`. A `do-not-drive` recall is not a
 * maintenance item and must not be rendered as one — the banner is the first
 * thing on the screen, before the vehicle name, because someone who opens this
 * from a notification needs the instruction before the context.
 *
 * ── Absent fields, which are the normal case here ───────────────────────────
 *
 * The stored payloads predate `Remedy` — see `recalls.ts`. Every section asks
 * before it draws. A "How it gets fixed" heading over an empty box reads as
 * "nobody knows how to fix this", which is a worse claim than staying quiet.
 */

interface Props {
  vehicleId: string;
  title?: string;
  onAskAdvisor: (vehicleId: string, ask: string) => void;
  onSignOut: () => void;
}

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'gone' }
  | { kind: 'loaded'; name: string; recalls: NormalisedRecall[] };

interface VehicleResponse {
  vehicle?: {
    year?: number | null;
    make?: string | null;
    model?: string | null;
    nhtsa_data?: { recalls?: unknown } | { recalls?: unknown }[] | null;
  };
}

function first<T>(value: T | T[] | null | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : (value ?? undefined);
}

/**
 * What the banner says, and it is deliberately an instruction rather than a
 * label. "Do not drive this vehicle" is what NHTSA means by `parkIt`; "Park
 * outside" without the reason reads as advice about parking.
 */
const SEVERITY_BANNER: Record<Exclude<RecallSeverity, 'standard'>, { title: string; body: string }> = {
  'do-not-drive': {
    title: 'Do not drive this vehicle',
    body: 'NHTSA has flagged this recall as do-not-drive. Contact your dealer before driving it again — the repair is free.',
  },
  'park-outside': {
    title: 'Park outside, away from buildings',
    body: 'NHTSA has flagged a fire risk while parked. Keep the vehicle away from structures until the recall work is done.',
  },
};

export function RecallDetailScreen({ vehicleId, title, onAskAdvisor, onSignOut }: Props) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setState({ kind: 'loading' });

      try {
        /*
          No `/api/v1` here — `apiRequest` prepends `API_PREFIX`. Writing the
          full path produces `/api/v1/api/v1/…` and a 404 that looks like a
          missing vehicle rather than a bad URL.
        */
        const data = await apiRequest<VehicleResponse>(
          `/load-vehicle?vehicleId=${encodeURIComponent(vehicleId)}`
        );

        const vehicle = data.vehicle;
        const name =
          [vehicle?.year, vehicle?.make, vehicle?.model].filter(Boolean).join(' ') ||
          title ||
          'this vehicle';

        setState({
          kind: 'loaded',
          name,
          recalls: normaliseRecalls(first(vehicle?.nhtsa_data)?.recalls),
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
          message: error instanceof Error ? error.message : 'Could not load recalls',
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
      <View style={styles.centre}>
        <ActivityIndicator color="rgba(255,255,255,0.6)" />
      </View>
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
        <Text style={styles.errorTitle}>Could not load recalls</Text>
        <Text style={styles.errorBody}>{state.message}</Text>
        <Pressable style={styles.button} onPress={() => void load()} accessibilityRole="button">
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  const worst = state.recalls[0]?.severity;
  const banner = worst && worst !== 'standard' ? SEVERITY_BANNER[worst] : null;

  return (
    <ScrollView
      contentContainerStyle={styles.body}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void load(true)}
          tintColor="rgba(255,255,255,0.5)"
        />
      }
    >
      {/*
        Before the vehicle name, deliberately. Someone arriving from a
        notification needs the instruction before the context.
      */}
      {banner && (
        <View
          style={[styles.banner, worst === 'do-not-drive' ? styles.bannerSevere : styles.bannerWarn]}
          accessibilityRole="alert"
        >
          <Text style={styles.bannerTitle}>{banner.title}</Text>
          <Text style={styles.bannerBody}>{banner.body}</Text>
        </View>
      )}

      <Text style={styles.name}>{state.name}</Text>
      <Text style={styles.count}>
        {state.recalls.length === 0
          ? 'No recalls on record'
          : `${state.recalls.length} ${state.recalls.length === 1 ? 'recall' : 'recalls'} on record`}
      </Text>

      {state.recalls.length === 0 && (
        <View style={styles.card}>
          {/*
            Not "you have no recalls". This app reads NHTSA's list, and an
            empty list is a statement about that list rather than about the car.
          */}
          <Text style={styles.body14}>
            NHTSA has no open recalls listed for this vehicle. That is their record, not a
            guarantee — a dealer can check against the VIN.
          </Text>
        </View>
      )}

      {state.recalls.map((recall, index) => (
        <View key={recall.campaignNumber ?? `recall-${index}`} style={styles.card}>
          {recall.component && <Text style={styles.component}>{recall.component}</Text>}

          {recall.summary && <Text style={styles.summary}>{recall.summary}</Text>}

          {recall.consequence && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>What could happen</Text>
              <Text style={styles.body14}>{recall.consequence}</Text>
            </View>
          )}

          {/*
            Asked, not assumed. The stored payloads predate this field, so on
            the demo cars this section is simply absent rather than empty.
          */}
          {hasRemedy(recall) && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>How it gets fixed</Text>
              <Text style={styles.body14}>{recall.remedy}</Text>
            </View>
          )}

          <View style={styles.metaRow}>
            {recall.campaignNumber && (
              <Text style={styles.meta}>Campaign {recall.campaignNumber}</Text>
            )}
            {recall.reportedOn && <Text style={styles.meta}>Issued {recall.reportedOn}</Text>}
          </View>

          {/*
            The advisor stays reachable, carrying this specific recall as the
            question. It is no longer the destination, but "what does this mean
            for my car" is still the thing the product answers best.
          */}
          <Pressable
            style={styles.askCta}
            accessibilityRole="button"
            accessibilityLabel={`Ask the advisor about the ${recall.component ?? 'recall'} recall`}
            onPress={() =>
              onAskAdvisor(
                vehicleId,
                `What does this recall mean for my ${state.name}? ${recall.summary ?? recall.component ?? ''}`
              )
            }
          >
            <Text style={styles.askCtaText}>Ask the advisor about this</Text>
          </Pressable>
        </View>
      ))}

      {state.recalls.length > 0 && (
        <Text style={styles.footnote}>
          Recall data from NHTSA. Repairs under an open recall are free at a franchised
          dealer, whatever the age of the vehicle.
        </Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 20, gap: 16, paddingBottom: 40 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 10 },

  name: { color: '#fff', fontSize: 24, fontWeight: '700', letterSpacing: -0.5 },
  count: { color: 'rgba(255,255,255,0.5)', fontSize: 14, marginTop: -10 },

  banner: { borderRadius: 14, padding: 16, gap: 6, borderWidth: 1 },
  /*
    Solid fills rather than tinted transparency. These two carry the only
    instructions on the screen that are time-critical, and a wash over an
    unknown backdrop is exactly where the 4.47:1 contrast defect came from on
    the advisor CTA. Both are measured in `mobile-text-contrast`.
  */
  bannerSevere: { backgroundColor: '#4a0f0f', borderColor: '#7f1d1d' },
  bannerWarn: { backgroundColor: '#4a3308', borderColor: '#854d0e' },
  bannerTitle: { color: '#fff', fontSize: 17, fontWeight: '700', letterSpacing: -0.2 },
  bannerBody: { color: 'rgba(255,255,255,0.85)', fontSize: 14, lineHeight: 20 },

  card: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 14,
    padding: 16,
    gap: 10,
  },
  component: {
    color: '#e0a468',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  summary: { color: '#fff', fontSize: 15, lineHeight: 21 },

  section: { gap: 4 },
  sectionLabel: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.4,
  },
  body14: { color: 'rgba(255,255,255,0.7)', fontSize: 14, lineHeight: 20 },

  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  meta: { color: 'rgba(255,255,255,0.5)', fontSize: 12 },

  askCta: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  askCtaText: { color: '#fff', fontSize: 14, fontWeight: '600' },

  footnote: { color: 'rgba(255,255,255,0.5)', fontSize: 12, lineHeight: 18 },

  errorTitle: { color: '#fff', fontSize: 17, fontWeight: '600' },
  errorBody: { color: 'rgba(255,255,255,0.5)', fontSize: 14, textAlign: 'center' },
  button: {
    marginTop: 6,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.1)',
    minHeight: 44,
    justifyContent: 'center',
  },
  buttonText: { color: '#fff', fontSize: 14 },
});
