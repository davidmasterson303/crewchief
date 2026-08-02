import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import type { Session } from '@supabase/supabase-js';

import { onSessionChange, signOut, startSessionAutoRefresh } from './src/auth/session';
import { supabase } from './src/auth/supabase';
import { SignInScreen } from './src/screens/SignInScreen';
import { GarageScreen } from './src/screens/GarageScreen';

/**
 * The session gate.
 *
 * Three states, and the third is the one that matters: **unknown**. Reading the
 * stored session off the Keychain is asynchronous, so for the first frames the
 * app does not yet know whether anyone is signed in. Rendering the sign-in
 * screen during that window would flash a login form at a signed-in user on
 * every cold start — `hooks/useVehicles.ts` carries the web version of this
 * lesson, where a query fired before the session resolved and cached an empty
 * garage.
 *
 * So `undefined` means "still asking" and renders nothing but a spinner.
 */
export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    // Drives token refresh off foreground/background — see session.ts.
    const stopRefresh = startSessionAutoRefresh();

    supabase.auth.getSession().then(({ data }) => setSession(data.session));

    const unsubscribe = onSessionChange(setSession);

    return () => {
      stopRefresh();
      unsubscribe();
    };
  }, []);

  return (
    <View style={styles.root}>
      {session === undefined ? (
        <View style={styles.loading}>
          <ActivityIndicator color="rgba(255,255,255,0.5)" />
        </View>
      ) : session ? (
        /*
          Phase 3.2 replaces the 3.1 proof screen. `SignedInScreen` existed to
          answer one question — does a token minted on this device open the API
          — and it did, on the simulator, 1 Aug. The garage makes the same call
          and shows the answer as a product rather than as a diagnostic.
        */
        <GarageScreen accessToken={session.access_token} onSignOut={() => void signOut()} />
      ) : (
        <SignInScreen />
      )}
      <StatusBar style="light" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#080808' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
