import { StatusBar } from 'expo-status-bar';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { API_BASE_URL } from './src/config';
import { checkSharedCore, type CoreCheck } from './src/core-check';

/**
 * Day-one scaffold, and it earns its keep by proving one thing.
 *
 * The monorepo was chosen so that `@crewchief/core` is a direct workspace
 * dependency — one commit changes an API and its client together, rather than
 * the two drifting apart, which is this codebase's named recurring bug. That
 * argument is worth nothing if core does not actually resolve inside Metro,
 * and "it typechecks" does not prove it does: Metro has its own resolver, and
 * the repo now holds two majors of React for it to pick the wrong one of.
 *
 * So the first screen runs shared code and shows the result. When this is
 * replaced by the real sign-in screen, the checks move into a test rather than
 * being deleted.
 */
export default function App() {
  const checks = checkSharedCore();
  const failed = checks.filter((c) => !c.ok);

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>CrewChief</Text>
        <Text style={styles.subtitle}>
          {failed.length === 0
            ? '@crewchief/core resolves and runs'
            : `${failed.length} shared-core check(s) failed`}
        </Text>

        {checks.map((check) => (
          <CheckRow key={check.label} check={check} />
        ))}

        <Text style={styles.footer}>API: {API_BASE_URL}</Text>
      </ScrollView>
      <StatusBar style="light" />
    </View>
  );
}

function CheckRow({ check }: { check: CoreCheck }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.mark, check.ok ? styles.ok : styles.bad]}>
        {check.ok ? '✓' : '✗'}
      </Text>
      <View style={styles.rowText}>
        <Text style={styles.label}>{check.label}</Text>
        <Text style={styles.detail}>{check.detail}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080808' },
  content: { padding: 24, paddingTop: 72, gap: 12 },
  title: { color: '#fff', fontSize: 28, fontWeight: '700', letterSpacing: -0.5 },
  subtitle: { color: 'rgba(255,255,255,0.45)', fontSize: 14, marginBottom: 12 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  rowText: { flex: 1 },
  mark: { fontSize: 15, width: 16 },
  ok: { color: '#4ade80' },
  bad: { color: '#f87171' },
  label: { color: '#fff', fontSize: 14 },
  detail: { color: 'rgba(255,255,255,0.4)', fontSize: 12, marginTop: 2 },
  footer: { color: 'rgba(255,255,255,0.25)', fontSize: 11, marginTop: 24 },
});
