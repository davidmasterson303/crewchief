import { useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import AlertBanner, { type AlertTone } from '../components/AlertBanner';
import Button from '../components/Button';
import Well from '../components/Well';
import { API_BASE_URL } from '../config';
import { border, radius, space, surface, text, type } from '../theme';
import type { PurchaseResolution } from '@crewchief/core/purchase-flow';
import {
  FREE_FEATURES,
  FREE_FEATURE_COPY,
  PAID_FEATURES,
  PAID_FEATURE_COPY,
} from '@crewchief/core/paid-features';

/**
 * One thing somebody can buy.
 *
 * ⚠ **`displayPrice` is Apple's string, not ours.** StoreKit returns a price
 * already formatted for the storefront the customer is in — currency, symbol
 * placement, decimal separator and all. Formatting a number here would be
 * wrong for most of the world the moment it was written, and would disagree
 * with the confirmation sheet Apple puts on top of this screen a second later.
 *
 * The same goes for the absence of any "save 26%" arithmetic: the two prices
 * are set independently per storefront in App Store Connect, so a saving
 * computed on the device is a claim about numbers we do not control.
 */
export interface SubscriptionOption {
  productId: string;
  /** e.g. "£7.99" — rendered verbatim. */
  displayPrice: string;
  period: 'month' | 'year';
}

/**
 * Where somebody subscribes.
 *
 * Phase 6, E8. Presentational and orchestrating only: it renders what it is
 * given and calls back. Every decision about what a purchase *means* is in
 * `@crewchief/core/purchase-flow`, which is why this screen can be tested
 * without StoreKit, a sandbox account or a network.
 *
 * ── ⚠ It never decides that somebody is entitled ────────────────────────────
 *
 * The screen shows `resolution.message` and nothing else. It does not inspect
 * the store outcome, does not shortcut on a successful purchase, and has no
 * branch that unlocks anything — `grantsAccess` is the caller's business and
 * the caller gets it from the resolver. A screen that decided for itself would
 * be a second answer to "is this account paid", and the second answer is the
 * one that drifts.
 *
 * ── What Apple requires to be on this screen ────────────────────────────────
 *
 * Guideline 3.1.2: the subscription's length and price, what renewal means and
 * how to stop it, and functional links to the terms and the privacy policy.
 * Those are not decoration and they are not small print here — a reviewer
 * looks for them, and somebody spending money deserves to read them before
 * rather than after.
 *
 * The restore control is required for the same reason it is useful: a
 * reinstall, a second device, or a subscription bought before signing in all
 * end up needing it, and a customer who cannot find it buys twice.
 */
export default function PaywallScreen({
  visible,
  options,
  loadFailed = false,
  onPurchase,
  onRestore,
  onClose,
}: {
  visible: boolean;
  /** `null` while StoreKit is still answering. */
  options: SubscriptionOption[] | null;
  /** StoreKit could not return products at all. */
  loadFailed?: boolean;
  onPurchase: (productId: string) => Promise<PurchaseResolution>;
  onRestore: () => Promise<PurchaseResolution>;
  onClose: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [resolution, setResolution] = useState<PurchaseResolution | null>(null);

  const working = busyId !== null || restoring;

  async function run(action: () => Promise<PurchaseResolution>, begin: () => void, end: () => void) {
    if (working) return;
    begin();
    /*
      Clear the previous answer before starting. Leaving a stale "your
      subscription is active" on screen while a second attempt runs would be
      the most misleading thing this screen could do.
    */
    setResolution(null);
    try {
      setResolution(await action());
    } finally {
      end();
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent={false}>
      <View style={styles.root}>
        <View style={styles.bar}>
          <Text style={styles.barTitle}>CrewChief Plus</Text>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            disabled={working}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            {({ pressed }) => (
              <Text style={[styles.close, pressed && styles.closePressed, working && styles.closeOff]}>
                Close
              </Text>
            )}
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          {/*
            ── ⚠ IAP-06 is killed rather than corrected ────────────────────────

            This screen sold **an allowance**. The headline was "More room for
            the advisor" and the lede said the paid tier *"raises that allowance
            five times over"* — which was also wrong: 400,000 → 1,000,000 output
            tokens is **2.5×**, a misleading claim about what a subscription buys
            made inside the binary, which is Guideline 2.3.1 territory.

            Deriving the figure from `TIERS` fixed the arithmetic and left the
            deeper problem: *nobody can tell what they are buying*. A monthly
            token allowance is a unit the customer has never seen, cannot observe
            while using the app, and cannot relate to their own use.

            The pricing decision of 24 Aug replaces it with a feature gate, so
            there is **no multiple to state** and the sentence is deleted rather
            than repaired. `entitlementMultiple()` exists only to keep that copy
            honest and now has no caller.

            ⚠ The list is rendered from `paid-features.ts` rather than written
            here. The gate the server enforces and the promise this screen makes
            are then the same object — a hand-written list on a paywall is a
            second source of truth for what somebody just paid for, and the one
            that drifts is always the one the customer read.
          */}
          <Text style={styles.headline}>Three features, one subscription</Text>

          <View style={styles.features}>
            {PAID_FEATURES.map((feature) => (
              <View key={feature} style={styles.feature}>
                <Text style={styles.featureLabel}>{PAID_FEATURE_COPY[feature].label}</Text>
                <Text style={styles.featureBlurb}>{PAID_FEATURE_COPY[feature].blurb}</Text>
              </View>
            ))}
          </View>

          {/*
            ⚠ What stays free is on the paywall, not only in the marketing.

            Somebody deciding whether to pay needs to know what happens if they
            do not, and what happens when they stop. Everything below is stored
            or looked up rather than generated, so it costs no model call and
            needs no subscription — a lapsed subscriber keeps their service book,
            which is their own record and was never ours to hold.

            Recalls are on this list and that is not a pricing decision: they are
            federal safety notices, and a defect notice an owner cannot see
            because their card expired is not a version of this product that
            should exist.
          */}
          <Text style={styles.freeHeading}>Free, with or without Plus</Text>
          <Text style={styles.lede}>
            {FREE_FEATURES.map((feature) => FREE_FEATURE_COPY[feature].label).join(' · ')}
          </Text>

          {resolution?.message && (
            <View style={styles.banner}>
              <AlertBanner tone={toneFor(resolution)} headline={resolution.message} />
            </View>
          )}

          {loadFailed ? (
            <Well style={styles.notice}>
              <Text style={styles.noticeText}>
                We could not reach the App Store to load prices. Check your connection and try
                again.
              </Text>
            </Well>
          ) : options === null ? (
            /*
              A named waiting state rather than a bare spinner. Somebody on a
              slow connection should be told what is being waited for.
            */
            <Well style={styles.notice}>
              <Text style={styles.noticeText}>Loading prices from the App Store…</Text>
            </Well>
          ) : options.length === 0 ? (
            <Well style={styles.notice}>
              <Text style={styles.noticeText}>
                There is nothing available to buy on this Apple ID right now.
              </Text>
            </Well>
          ) : (
            <View style={styles.options}>
              {options.map((option) => (
                <Button
                  key={option.productId}
                  label={`${option.displayPrice} / ${option.period}`}
                  accessibilityLabel={`Subscribe, ${option.displayPrice} per ${option.period}`}
                  variant={option.period === 'year' ? 'primary' : 'outline'}
                  busy={busyId === option.productId}
                  disabled={working && busyId !== option.productId}
                  onPress={() => {
                    void run(
                      () => onPurchase(option.productId),
                      () => setBusyId(option.productId),
                      () => setBusyId(null)
                    );
                  }}
                />
              ))}
            </View>
          )}

          <Button
            label="Restore purchases"
            variant="ghost"
            busy={restoring}
            disabled={working && !restoring}
            onPress={() => {
              void run(onRestore, () => setRestoring(true), () => setRestoring(false));
            }}
          />

          {/*
            The terms, in the binary rather than only behind a link. Guideline
            3.1.2 asks for the length, the price basis and what renewal means,
            and a reviewer reads this block specifically.
          */}
          <View style={styles.terms}>
            <Text style={styles.termsText}>
              Payment is taken by Apple when you confirm. A subscription renews automatically for
              the same period unless you turn renewal off at least 24 hours before it ends. You can
              cancel any time in your Apple ID settings — deleting your CrewChief account does not
              stop the billing.
            </Text>
          </View>

          <View style={styles.legal}>
            <LegalLink label="Terms of Use" path="/terms" disabled={working} />
            <LegalLink label="Privacy Policy" path="/privacy" disabled={working} />
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

function LegalLink({
  label,
  path,
  disabled,
}: {
  label: string;
  path: string;
  disabled: boolean;
}) {
  return (
    <Pressable
      onPress={() => void Linking.openURL(`${API_BASE_URL}${path}`)}
      disabled={disabled}
      accessibilityRole="link"
      accessibilityLabel={`${label}, opens in your browser`}
      style={styles.legalRow}
    >
      {({ pressed }) => (
        <Text style={[styles.legalText, pressed && styles.legalTextPressed]}>{label}</Text>
      )}
    </Pressable>
  );
}

/**
 * Which banner a resolution earns.
 *
 * `waiting` is deliberately `attention` rather than `critical`. Those are the
 * cases where the money has already left and the entitlement is still on its
 * way — rendering them in the critical family would tell somebody a completed
 * payment had failed, which is the one thing that makes people buy twice.
 */
function toneFor(resolution: PurchaseResolution): AlertTone {
  if (resolution.status === 'entitled') return 'confirm';
  if (resolution.status === 'error') return 'critical';
  return 'attention';
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: surface.page },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    backgroundColor: surface.nav,
    borderBottomWidth: 1,
    borderBottomColor: border.panel,
  },
  barTitle: { ...type.title, color: text.primary },
  close: { ...type.ui, color: text.secondary },
  closePressed: { color: text.primary },
  closeOff: { color: text.disabled },

  body: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl },
  headline: { ...type.editorial, color: text.primary },
  lede: { ...type.body, color: text.secondary },
  /*
    The three paid features, as a list rather than a paragraph. A paywall's job
    is to be scannable — somebody deciding whether to spend money reads the
    labels and stops, and prose makes them read all of it to find out whether
    the thing they want is included.
  */
  features: { gap: space.md },
  feature: { gap: 2 },
  featureLabel: { ...type.uiStrong, color: text.primary },
  featureBlurb: { ...type.value, color: text.secondary },
  /** Same weight as a section label; what is free is not small print. */
  freeHeading: { ...type.uiStrong, color: text.primary, marginTop: space.sm },

  banner: { marginTop: space.xs },

  notice: { padding: space.lg },
  noticeText: { ...type.body, color: text.secondary },

  options: { gap: space.md },

  terms: {
    borderTopWidth: 1,
    borderTopColor: border.panel,
    paddingTop: space.lg,
  },
  termsText: { ...type.value, color: text.muted },

  legal: { flexDirection: 'row', gap: space.xl },
  legalRow: { paddingVertical: space.sm, minHeight: 44, justifyContent: 'center' },
  legalText: { ...type.ui, color: text.secondary },
  legalTextPressed: { color: text.primary },
});
