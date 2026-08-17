import { useEffect, useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { API_BASE_URL } from '../config';
import Button from '../components/Button';
import Field from '../components/Field';

import { deleteAccount, getSubscription } from '../api/account';
import { ApiRequestError } from '../api/client';
import { border, brand, radius, space, status, surface, text } from '../theme';
import {
  DELETION_CONFIRM_PHRASE,
  DELETION_INVENTORY,
  subscriptionNotice,
  describeDeletion,
  isDeletionConfirmed,
} from '@crewchief/core/account-deletion';
import { interFace } from '../theme/fonts';

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
  const [subscribed, setSubscribed] = useState(false);

  const confirmed = isDeletionConfirmed(confirmText);
  const notice = subscriptionNotice(subscribed);

  /*
    E5. Read on open rather than on mount: this is a modal that outlives a
    subscription purchase, and a screen that checked once at app start would
    tell somebody who subscribed ten minutes ago that they have nothing to
    cancel.

    A failure here resolves to "no subscription" and is deliberately silent.
    The screen's job is deletion — Apple requires that flow to work — and
    blocking or erroring it because a secondary read failed would obstruct the
    guideline this whole screen exists to satisfy. The server already fails the
    other way, warning when it cannot read, so the quiet case here is a network
    failure rather than an unknown entitlement.
  */
  useEffect(() => {
    if (!visible) return;

    let cancelled = false;
    void getSubscription().then((subscription) => {
      if (!cancelled) setSubscribed(subscription.live);
    });

    return () => {
      cancelled = true;
    };
  }, [visible]);

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

          {/*
            An exact variant match, not an approximation: this was transparent
            with a `border.field` edge, pressing to `surface.raised` — which is
            `Button`'s `outline` down to the token.
          */}
          <Button label="Sign out" variant="outline" onPress={onSignOut} disabled={deleting} />

          {/*
            ── Why these are in the binary rather than only on the website ────

            Guideline 3.1.2 requires an app selling auto-renewable subscriptions
            to carry functional links to both documents. Neither existed
            anywhere in this product until 14 Aug — not missing links, missing
            pages — so this is the half that makes them reachable.

            Above the delete section on purpose. Somebody reading the account
            screen to work out what happens to their data should meet the policy
            *before* the irreversible control, not after it.
          */}
          <View style={styles.legal}>
            <Text style={styles.label}>Legal</Text>
            <Pressable
              onPress={() => void Linking.openURL(`${API_BASE_URL}/privacy`)}
              disabled={deleting}
              accessibilityRole="link"
              accessibilityLabel="Privacy Policy, opens in your browser"
              style={styles.legalRow}
            >
              <Text style={styles.legalText}>Privacy Policy</Text>
            </Pressable>
            <Pressable
              onPress={() => void Linking.openURL(`${API_BASE_URL}/terms`)}
              disabled={deleting}
              accessibilityRole="link"
              accessibilityLabel="Terms of Use, opens in your browser"
              style={styles.legalRow}
            >
              <Text style={styles.legalText}>Terms of Use</Text>
            </Pressable>
          </View>

          <View style={styles.danger}>
            <Text style={styles.dangerTitle}>Delete account</Text>

            {/*
              Above the inventory, not below it: somebody who has decided to
              delete stops reading once they find the confirm field, and this
              is the one item on the screen that costs money to miss.
            */}
            {notice && (
              <View style={styles.notice}>
                <Text style={styles.noticeHeadline}>{notice.headline}</Text>
                <Text style={styles.noticeBody}>{notice.action}</Text>
              </View>
            )}

            <Text style={styles.dangerBody}>
              This cannot be undone. Deleting your account permanently removes:
            </Text>

            {DELETION_INVENTORY.map((item) => (
              <Text key={item} style={styles.inventoryItem}>
                {'•'}  {item}
              </Text>
            ))}

            {/*
              One label doing both jobs, and it takes the **longer** wording.

              The visible text read "Type DELETE to confirm" while the spoken
              name was "…to confirm account deletion". `Field` speaks the label
              it shows, so one of the two had to win — and on the single
              irreversible control in this product, the more explicit one does.
              It is three words of redundancy inside a section already titled
              "Delete account"; that is the safe direction to be redundant in.
            */}
            <Field
              label={`Type ${DELETION_CONFIRM_PHRASE} to confirm account deletion`}
              value={confirmText}
              onChangeText={setConfirmText}
              placeholder={DELETION_CONFIRM_PHRASE}
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!deleting}
            />

            {error && <Text style={styles.error}>{error}</Text>}

            {/*
              The `delete` variant, matched token for token — `status.danger`,
              pressing to `status.dangerPressed`, disabling to `surface.disabled`.
              The primitive also keeps the accessible name through the spinner,
              which this screen was already doing by hand and for the same
              reason: the `<Text>` naming it is what gets replaced.
            */}
            <Button
              label="Delete my account"
              variant="delete"
              onPress={() => void handleDelete()}
              disabled={!confirmed}
              busy={deleting}
              style={styles.deleteAction}
            />
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: surface.page },
  bar: {
    paddingTop: 64,
    paddingHorizontal: 20,
    paddingBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: border.field,
  },
  title: { color: text.primary, fontSize: 22, fontFamily: interFace('700'), fontWeight: '700' },
  close: { color: brand.accent, fontSize: 16, minHeight: 44, lineHeight: 44 },
  disabledText: { color: text.disabled },

  body: { padding: 20, gap: 24 },
  section: { gap: 4 },
  label: {
    color: text.muted,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  value: { color: text.primary, fontSize: 16 },


  legal: { gap: 4 },
  /*
    44pt minimum, because these are the two rows most likely to be tapped by
    someone holding the phone one-handed in a car park while deciding whether
    to trust the thing with a photograph of their driveway.
  */
  legalRow: { minHeight: 44, justifyContent: 'center' },
  legalText: { color: text.secondary, fontSize: 15 },

  danger: {
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: status.dangerWashBorder,
    backgroundColor: status.dangerWash,
    padding: 18,
    gap: 10,
  },
  dangerTitle: { color: status.dangerText, fontSize: 17, fontFamily: interFace('700'), fontWeight: '700' },

  /*
    E5's subscription warning. An amber panel rather than the surrounding red:
    the red states an irreversible consequence of the thing you came here to do,
    while this states a consequence that happens somewhere else and is still
    avoidable. Two different messages in one colour read as one message.

    Both text colours are fully opaque and chosen against the composited
    background this panel sits on — `mobile-text-contrast.test.ts` enforces the
    4.5:1 floor with opacity composited in, and a translucent body here is
    exactly the shape it catches.
  */
  notice: {
    borderRadius: radius.button,
    borderWidth: 1,
    borderColor: status.attentionWashBorder,
    backgroundColor: status.attentionWash,
    padding: 14,
    gap: 6,
  },
  noticeHeadline: { color: status.attention, fontSize: 14, fontFamily: interFace('700'), fontWeight: '700', lineHeight: 20 },
  noticeBody: { color: status.attention, fontSize: 13, lineHeight: 19 },
  dangerBody: { color: text.secondary, fontSize: 14, lineHeight: 20 },
  inventoryItem: { color: text.muted, fontSize: 13, lineHeight: 19 },

  error: { color: status.dangerText, fontSize: 13 },

  /** Keeps the 4pt lift the hand-rolled control had above the error line. */
  deleteAction: { marginTop: space.xs },
});
