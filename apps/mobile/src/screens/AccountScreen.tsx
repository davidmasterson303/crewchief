import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { deleteAccount } from '../api/account';
import { ApiRequestError } from '../api/client';
import {
  DELETION_CONFIRM_PHRASE,
  DELETION_INVENTORY,
  describeDeletion,
  isDeletionConfirmed,
} from '@crewchief/core/account-deletion';

/**
 * Account — sign out, and delete the account. App Store guideline 5.1.1(v).
 *
 * ── Why this screen exists ──────────────────────────────────────────────────
 *
 * Apple requires account deletion to be initiated from inside the reviewed app
 * and routinely rejects "delete your account on our website". Deletion has
 * worked since Phase 1 and the bearer-capable route has existed since 1 Aug —
 * what was missing was any way to reach it from the phone. `apps/mobile/src`
 * held exactly two screens and no account surface at all, which is why the
 * roadmap carries 5.1.1(v) as 🔴 absent rather than as untested.
 *
 * ── Reachable, and not buried ───────────────────────────────────────────────
 *
 * The guideline says the option must be genuinely available. It is one tap
 * from the garage — the only screen a signed-in user sees — and not behind a
 * web view, an email request or a support form.
 *
 * ── The confirmation is the same one the web asks for ───────────────────────
 *
 * Type-to-confirm, with the phrase and the comparison imported rather than
 * rewritten. Apple permits a confirmation step provided it is not
 * "unnecessarily difficult"; one word is enough to stop a misclick on an
 * irreversible action and not enough to obstruct someone who means it.
 *
 * The inventory is spelled out rather than summarised as "your data", because
 * "your data" is the phrasing that lets someone agree to this without
 * realising it takes the invoice images too.
 */
export function AccountScreen({
  visible,
  email,
  onClose,
  onSignOut,
  onDeleted,
}: {
  visible: boolean;
  email: string | null;
  onClose: () => void;
  onSignOut: () => void;
  /** Called after the account is gone, so the app can clear the session. */
  onDeleted: (summary: string) => void;
}) {
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmed = isDeletionConfirmed(confirmText);

  async function handleDelete() {
    if (!confirmed || deleting) return;

    setDeleting(true);
    setError(null);

    try {
      const { deleted } = await deleteAccount();
      /*
        The session is cleared by the caller, not here. The token names an auth
        user that no longer exists, so leaving it in the Keychain would leave
        the app rendering a garage it can no longer load — the failure would
        arrive as a 401 on the next request rather than as the deletion it
        actually is.
      */
      onDeleted(describeDeletion(deleted));
    } catch (err) {
      const message =
        err instanceof ApiRequestError
          ? err.message
          : 'Could not delete your account. Please try again.';
      setError(message);
      setDeleting(false);
    }
  }

  function handleClose() {
    if (deleting) return;
    setConfirmText('');
    setError(null);
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleClose} transparent={false}>
      <View style={styles.root}>
        <View style={styles.bar}>
          <Text style={styles.title}>Account</Text>
          <Pressable onPress={handleClose} hitSlop={12} disabled={deleting}>
            <Text style={[styles.close, deleting && styles.disabledText]}>Done</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {email && (
            <View style={styles.section}>
              <Text style={styles.label}>Signed in as</Text>
              <Text style={styles.value}>{email}</Text>
            </View>
          )}

          <Pressable
            onPress={onSignOut}
            disabled={deleting}
            style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
          >
            <Text style={styles.actionText}>Sign out</Text>
          </Pressable>

          <View style={styles.danger}>
            <Text style={styles.dangerTitle}>Delete account</Text>
            <Text style={styles.dangerBody}>
              This cannot be undone. Deleting your account permanently removes:
            </Text>

            {DELETION_INVENTORY.map((item) => (
              <Text key={item} style={styles.inventoryItem}>
                {'•'}  {item}
              </Text>
            ))}

            <Text style={styles.confirmLabel}>
              Type {DELETION_CONFIRM_PHRASE} to confirm
            </Text>
            <TextInput
              value={confirmText}
              onChangeText={setConfirmText}
              placeholder={DELETION_CONFIRM_PHRASE}
              placeholderTextColor="rgba(255,255,255,0.25)"
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!deleting}
              style={styles.input}
              accessibilityLabel={`Type ${DELETION_CONFIRM_PHRASE} to confirm account deletion`}
            />

            {error && <Text style={styles.error}>{error}</Text>}

            <Pressable
              onPress={() => void handleDelete()}
              disabled={!confirmed || deleting}
              accessibilityRole="button"
              accessibilityState={{ disabled: !confirmed || deleting }}
              style={({ pressed }) => [
                styles.deleteButton,
                (!confirmed || deleting) && styles.deleteButtonDisabled,
                pressed && confirmed && !deleting && styles.deleteButtonPressed,
              ]}
            >
              {deleting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.deleteButtonText}>Delete my account</Text>
              )}
            </Pressable>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#080808' },
  bar: {
    paddingTop: 64,
    paddingHorizontal: 20,
    paddingBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  title: { color: '#fff', fontSize: 22, fontWeight: '700' },
  close: { color: '#22d3ee', fontSize: 16, minHeight: 44, lineHeight: 44 },
  disabledText: { color: 'rgba(255,255,255,0.25)' },

  body: { padding: 20, gap: 24 },
  section: { gap: 4 },
  label: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  value: { color: '#fff', fontSize: 16 },

  action: {
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionPressed: { backgroundColor: 'rgba(255,255,255,0.06)' },
  actionText: { color: '#fff', fontSize: 16, fontWeight: '600' },

  danger: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.3)',
    backgroundColor: 'rgba(248,113,113,0.06)',
    padding: 18,
    gap: 10,
  },
  dangerTitle: { color: '#fca5a5', fontSize: 17, fontWeight: '700' },
  dangerBody: { color: 'rgba(255,255,255,0.6)', fontSize: 14, lineHeight: 20 },
  inventoryItem: { color: 'rgba(255,255,255,0.5)', fontSize: 13, lineHeight: 19 },

  confirmLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 13, marginTop: 6 },
  input: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    backgroundColor: 'rgba(0,0,0,0.4)',
    color: '#fff',
    // 16px so iOS does not zoom the page on focus — the same rule R2 enforces
    // on the web, and the same reason.
    fontSize: 16,
    paddingHorizontal: 14,
    letterSpacing: 2,
  },
  error: { color: '#fca5a5', fontSize: 13 },

  deleteButton: {
    minHeight: 50,
    borderRadius: 12,
    backgroundColor: '#dc2626',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  deleteButtonDisabled: { backgroundColor: 'rgba(220,38,38,0.35)' },
  deleteButtonPressed: { backgroundColor: '#b91c1c' },
  deleteButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
