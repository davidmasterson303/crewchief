import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Session } from '@supabase/supabase-js';

import { apiRequest, ApiRequestError } from '../api/client';
import { signOut } from '../auth/session';
import { checkSharedCore } from '../core-check';
import { API_BASE_URL } from '../config';

/**
 * The end-to-end proof, standing in for the garage until 3.2 builds it.
 *
 * This screen exists to answer the question Phase 3.1 is actually about: does a
 * token minted on this device open the API? Everything else in the auth stack
 * can be right while that is wrong, and it was wrong until 31 Jul —
 * `/api/v1/vehicles` accepted a cookie session only, so the one endpoint the
 * garage cannot work without returned 401 to every bearer token.
 *
 * It calls that route and shows what came back. When 3.2 replaces it, the call
 * stays and the presentation changes.
 */
export function SignedInScreen({ session }: { session: Session }) {
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'ok'; count: number; names: string[] }
    | { status: 'error'; message: string; code: number }
  >({ status: 'loading' });

  const loadGarage = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const body = await apiRequest<{ vehicles?: { year?: number; make?: string; model?: string }[] }>(
        '/vehicles'
      );
      const vehicles = body.vehicles ?? [];
      setState({
        status: 'ok',
        count: vehicles.length,
        names: vehicles.map((v) => `${v.year ?? ''} ${v.make ?? ''} ${v.model ?? ''}`.trim()),
      });
    } catch (error) {
      const apiError = error as ApiRequestError;
      setState({
        status: 'error',
        message: apiError.message,
        code: apiError.status ?? 0,
      });
    }
  }, []);

  useEffect(() => {
    void loadGarage();
  }, [loadGarage]);

  const coreChecks = checkSharedCore();
  const coreFailures = coreChecks.filter((c) => !c.ok).length;

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.title}>Signed in</Text>
      <Text style={styles.subtitle}>{session.user.email}</Text>

      <Text style={styles.heading}>Garage — GET /api/v1/vehicles</Text>
      {state.status === 'loading' ? (
        <Text style={styles.detail}>Loading…</Text>
      ) : state.status === 'ok' ? (
        <View>
          <Text style={styles.good}>
            ✓ {state.count} vehicle{state.count === 1 ? '' : 's'} — the bearer token opened the API
          </Text>
          {state.names.map((name) => (
            <Text key={name} style={styles.detail}>
              {name}
            </Text>
          ))}
          {state.count === 0 ? (
            // Not a failure: an authenticated account with no cars of its own
            // is the ordinary case here. Said out loud so an empty list is not
            // read as a broken request.
            <Text style={styles.detail}>
              An empty garage still proves the call succeeded — 200, not 401.
            </Text>
          ) : null}
        </View>
      ) : (
        <View>
          <Text style={styles.bad}>
            ✗ {state.code || 'network'} — {state.message}
          </Text>
          {state.code === 401 ? (
            <Text style={styles.detail}>
              A 401 here means the bearer path is not accepting this token.
            </Text>
          ) : null}
        </View>
      )}

      <Text style={styles.heading}>Shared core</Text>
      <Text style={coreFailures === 0 ? styles.good : styles.bad}>
        {coreFailures === 0
          ? `✓ ${coreChecks.length} checks passed — @crewchief/core runs on device`
          : `✗ ${coreFailures} of ${coreChecks.length} failed`}
      </Text>
      {coreChecks
        .filter((c) => !c.ok)
        .map((c) => (
          <Text key={c.label} style={styles.detail}>
            {c.label}: {c.detail}
          </Text>
        ))}

      <View style={styles.actions}>
        <Pressable style={styles.secondary} onPress={loadGarage}>
          <Text style={styles.secondaryText}>Retry</Text>
        </Pressable>
        <Pressable style={styles.secondary} onPress={() => void signOut()}>
          <Text style={styles.secondaryText}>Sign out</Text>
        </Pressable>
      </View>

      <Text style={styles.footer}>{API_BASE_URL}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 24, paddingTop: 72, gap: 8 },
  title: { color: '#fff', fontSize: 26, fontWeight: '700', letterSpacing: -0.5 },
  subtitle: { color: 'rgba(255,255,255,0.45)', fontSize: 14, marginBottom: 18 },
  heading: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: 20,
  },
  good: { color: '#4ade80', fontSize: 14, marginTop: 4 },
  bad: { color: '#f87171', fontSize: 14, marginTop: 4 },
  detail: { color: 'rgba(255,255,255,0.45)', fontSize: 13, marginTop: 3 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 32 },
  secondary: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: 9,
    paddingVertical: 11,
    paddingHorizontal: 20,
  },
  secondaryText: { color: '#fff', fontSize: 14 },
  footer: { color: 'rgba(255,255,255,0.22)', fontSize: 11, marginTop: 28 },
});
