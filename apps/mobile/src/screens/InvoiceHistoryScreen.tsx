import { useCallback, useEffect, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import Button from '../components/Button';
import Card from '../components/Card';
import EmptyState from '../components/EmptyState';
import Icon from '../components/Icon';
import { SkeletonCard } from '../components/Skeleton';
import { apiRequest, ApiRequestError } from '../api/client';
import { useRefetchOnFocus } from '../navigation/useRefetchOnFocus';
import {
  formatRecordDate,
  scannedVisits,
  type ServiceRecord,
  type ServiceVisit,
} from '@wellkept/core/service-record';
import { formatCurrency } from '@wellkept/core/formatting-utils';
import {
  OPTICAL_CENTRE,
  TABULAR,
  TARGET_MIN,
  border,
  radius,
  space,
  surface,
  text,
  type,
} from '../theme';

/**
 * Every invoice this car has had scanned, newest first.
 *
 * ── Why this is a tab and what it is not ────────────────────────────────────
 *
 * David, 30 Aug: history becomes the fourth destination in the bar, and it
 * needs somewhere to start a new scan from. Both halves matter — a list of
 * invoices with no way to add one is a filing cabinet, and scanning was
 * previously reachable only by opening a car and finding it on the hub.
 *
 * ⚠ **This is the documents view, not the service history.** `Service →
 * History` lists every record — typed, imported, marked done from the wishlist
 * — and it stays exactly where it is. This lists only what came off a
 * photographed document, because that is what "invoice history" means and
 * because a list that mixed them would claim a document exists for something
 * nobody ever photographed. `scannedVisits` in core draws that line and has the
 * argument written on it.
 *
 * ── ⚠ No new endpoint, deliberately ────────────────────────────────────────
 *
 * A documents list looks like it needs a documents route. It does not: rows
 * sharing a `source_document_id` **are** the invoice, so the shop, the date,
 * the total and the line count all fall out of `/load-maintenance-data`, which
 * this screen already had. That is not a shortcut, it is what keeps this
 * shippable: a new `/api/v1/*` route would have to reach `web-live` before the
 * next mobile build or the app would ship calling a path that is not there —
 * §8, the most confusing shape a bug can take. This is JS, and JS is free.
 *
 * ── The count is the invoices, never the lines ─────────────────────────────
 *
 * A five-line invoice is **one** entry. The screen this replaces on the hub
 * drew five cards and repeated the same shop and total under each — R17, and
 * the reason `groupIntoVisits` exists at all.
 */

interface MaintenanceResponse {
  maintenanceLineItems?: ServiceRecord[] | null;
}

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'loaded'; visits: ServiceVisit[] };

export function InvoiceHistoryScreen({
  vehicleId,
  title,
  onOpenInvoice,
  onScan,
  onSignOut,
}: {
  vehicleId: string;
  title?: string;
  /** Push the records this invoice produced. */
  onOpenInvoice: (visit: ServiceVisit) => void;
  /** Start a new scan for this car. */
  onScan: () => void;
  onSignOut: () => void;
}) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setState({ kind: 'loading' });

      try {
        const body = await apiRequest<MaintenanceResponse>(
          `/load-maintenance-data?vehicleId=${encodeURIComponent(vehicleId)}`
        );
        const records = Array.isArray(body.maintenanceLineItems)
          ? body.maintenanceLineItems
          : [];
        setState({ kind: 'loaded', visits: scannedVisits(records) });
      } catch (error) {
        const apiError = error as ApiRequestError;
        /*
          ⚠ MOB-08. `isLocallySignedOut`, not any 401 — a device 401 is genuinely
          signed out, a server one may be a token the server would accept a
          second later, and destroying a working session over one response is
          how a spurious failure becomes a forced re-login.
        */
        if (apiError.isLocallySignedOut) {
          onSignOut();
          return;
        }
        /*
          An error, never an empty list. "No invoices yet" and "we could not
          load your invoices" look identical as a blank screen and mean opposite
          things — and this screen's empty state invites a scan, so showing it
          after a failed load would ask somebody to re-photograph an invoice
          they already have.
        */
        setState({
          kind: 'error',
          message: apiError.message ?? 'Could not load your invoices',
        });
      } finally {
        setRefreshing(false);
      }
    },
    [vehicleId, onSignOut]
  );

  useEffect(() => {
    void load();
  }, [load]);

  /* A scan started here returns here, and the new invoice has to be on the list
     when it does. Without this the screen would show the count it had when it
     was mounted — the MOB-05 failure, on the one screen whose whole job is to
     reflect a write that just happened. */
  useRefetchOnFocus(load);

  if (state.kind === 'loading') {
    return (
      <View style={styles.page}>
        <SkeletonCard />
        <SkeletonCard />
      </View>
    );
  }

  if (state.kind === 'error') {
    return (
      <View style={[styles.page, OPTICAL_CENTRE]}>
        <EmptyState
          headline="Could not load your invoices"
          body={state.message}
          actionLabel="Try again"
          onAction={() => void load()}
        />
      </View>
    );
  }

  const { visits } = state;

  return (
    <View style={styles.frame}>
      <ScrollView
        contentContainerStyle={[styles.page, visits.length === 0 && OPTICAL_CENTRE]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={text.muted} />
        }
      >
        {visits.length === 0 ? (
          /*
            The first thing most owners will see here, so it says what a scan
            does rather than that the list is empty. The action is the same one
            pinned below — offered twice on purpose, because an empty screen's
            centre is where the eye is and the pinned bar is where the thumb is.
          */
          <EmptyState
            headline="No invoices yet"
            body="Photograph a service invoice and its line items are read into this car’s record — what was done, by whom, and what it cost."
            actionLabel="Scan an invoice"
            onAction={onScan}
          />
        ) : (
          <>
            <Text style={styles.summary}>
              {visits.length} {visits.length === 1 ? 'invoice' : 'invoices'} for{' '}
              {title ?? 'this car'}
            </Text>

            {visits.map((visit) => (
              <Pressable
                key={visit.key}
                onPress={() => onOpenInvoice(visit)}
                accessibilityRole="button"
                accessibilityLabel={`${visit.shop ?? 'Invoice'}, ${
                  visit.records.length
                } ${visit.records.length === 1 ? 'line' : 'lines'}${
                  visit.total > 0 ? `, ${formatCurrency(visit.total)}` : ''
                }`}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              >
                <Card style={styles.card}>
                  <View style={styles.rowTop}>
                    <View style={styles.rowText}>
                      {/*
                        The shop is the heading because it is how somebody looks
                        for an invoice — "the March visit to Bavarian" — and it
                        is omitted rather than filled when extraction did not
                        read one. The route defaults `shop_name` to 'Unknown',
                        and printing that reads as a fact about the shop.
                      */}
                      <Text style={styles.shop} numberOfLines={1}>
                        {visit.shop ?? 'Scanned invoice'}
                      </Text>
                      <Text style={styles.meta}>
                        {[
                          formatRecordDate(visit.date),
                          `${visit.records.length} ${
                            visit.records.length === 1 ? 'line' : 'lines'
                          }`,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </Text>
                    </View>

                    {/*
                      ⚠ A total is shown only when a line actually carried one.
                      `counted` is how many did, and a $0 invoice is not a free
                      service — it is an extraction that read no price. The same
                      rule `totalRecorded` was written for.
                    */}
                    {visit.counted > 0 && (
                      <Text style={styles.total}>{formatCurrency(visit.total)}</Text>
                    )}
                    <Icon name="chevron-right" size={18} color={text.muted} />
                  </View>
                </Card>
              </Pressable>
            ))}
          </>
        )}
      </ScrollView>

      {/*
        ── The CTA, pinned rather than in the scroller ────────────────────────

        David asked for a way to scan a new invoice from this page. It is pinned
        above the tab bar so it is reachable without scrolling to the bottom of
        a long list — the same argument the wishlist filter got: a control whose
        job is to act on the list should not scroll away with it.

        Hidden while the list is empty, because the empty state already offers
        it and two identical buttons on one screenful is a screen that cannot
        decide what it wants.
      */}
      {visits.length > 0 && (
        <View style={styles.cta}>
          <Button label="Scan an invoice" onPress={onScan} accessibilityLabel="Scan a new invoice" />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, backgroundColor: surface.page },
  page: { padding: space.lg, gap: space.md, flexGrow: 1 },
  summary: { ...type.label, color: text.muted },
  row: { borderRadius: radius.card },
  /*
    A fill swap, never a fade. `mobile-pressed-states` caught `opacity: 0.7`
    here and was right to: fading a row dims the label along with the surface,
    so the feedback for touching a thing is that it becomes harder to read. The
    rule is the app's, and `Suggest`'s rows are the pattern.
  */
  rowPressed: { backgroundColor: surface.well },
  card: { padding: space.md },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: TARGET_MIN - 8 },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  shop: { ...type.body, color: text.primary },
  meta: { ...type.label, color: text.muted },
  total: { ...type.body, ...TABULAR, color: text.primary },
  cta: {
    padding: space.lg,
    paddingBottom: space.md,
    borderTopWidth: 1,
    borderTopColor: border.panel,
    backgroundColor: surface.page,
  },
});

export default InvoiceHistoryScreen;
