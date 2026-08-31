import { useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';

import Button from '../components/Button';
import Card from '../components/Card';
import { invoiceUrl } from '../api/documents';
import {
  describeRecord,
  formatRecordDate,
  type ServiceVisit,
} from '@wellkept/core/service-record';
import { formatCurrency } from '@wellkept/core/formatting-utils';
import { TABULAR, border, space, surface, text, type } from '../theme';

/**
 * One invoice, and the service records it produced.
 *
 * ── Why a pushed screen rather than an expanding row ────────────────────────
 *
 * The design system's rule for the vehicle screen — *"a hub, not tabs"* —
 * applies here for the same reason it did there: a real route gets the
 * platform's back gesture, can be deep-linked later, and does not make a list
 * row change height under a thumb that is already moving. An invoice is a thing
 * somebody opens, reads and leaves.
 *
 * ── ⚠ It takes the visit, not an id ────────────────────────────────────────
 *
 * The list already holds every line — `groupIntoVisits` put them there — so
 * refetching by document id would be a second request for data on the device,
 * and a chance for the two screens to disagree about one invoice.
 *
 * The cost is stated rather than hidden: this screen cannot be opened cold, so
 * it is not a deep-link target. That is the correct trade today, and the moment
 * a notification needs to open an invoice is the moment it earns an id and a
 * fetch.
 *
 * ── ⚠ The document, which two notes in this app said was impossible ────────
 *
 * *"The file is behind a signed URL and nothing on this client mints one, so a
 * 'view invoice' control could not work."* True when written, twice. What was
 * missing was a route, not a capability — `/api/v1/document-url` mints one with
 * the web action's authorization, and `Linking.openURL` hands it to whatever
 * the phone uses for a PDF, which is also how it gets saved.
 *
 * ⛔ **It 404s until `web-live` is promoted**, because the route is new and that
 * hostname has been frozen since 23 Aug. The failure says so rather than
 * reading as a missing file — see `invoiceUrl`.
 *
 * ⚠ The control appears only for a **scanned** visit. A record typed by hand or
 * marked done from the wishlist has no document, and a button offering to open
 * one would be promising a file that was never taken.
 */
export function InvoiceDetailScreen({
  visit,
  vehicleId,
}: {
  visit: ServiceVisit;
  /*
    ⚠ Passed in rather than read off a record. `ServiceRecord` has no
    `vehicle_id` — the payload is already scoped to one car — and inventing the
    field to carry it here would have put a second, unvalidated copy of the
    authorization key on the client. The route checks it against the document
    anyway; SEC-01 is what happens when only one of two ids is checked.
  */
  vehicleId: string;
}) {
  const date = formatRecordDate(visit.date);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  const documentId = visit.records.find((record) => record.source_document_id)?.source_document_id;

  const open = async () => {
    if (!documentId) return;
    setOpening(true);
    setOpenError(null);

    const result = await invoiceUrl(vehicleId, documentId);

    if ('url' in result) {
      /*
        `openURL` rather than an in-app viewer. A PDF viewer is a native module
        and therefore an EAS build (§9); handing the signed link to the system
        opens it in Safari or Files, where saving and sharing are already built
        and better than anything worth writing here.
      */
      const supported = await Linking.canOpenURL(result.url);
      if (supported) await Linking.openURL(result.url);
      else setOpenError('This device could not open that link.');
    } else {
      setOpenError(result.error);
    }

    setOpening(false);
  };

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.head}>
        <Text style={styles.shop}>{visit.shop ?? 'Scanned invoice'}</Text>
        <Text style={styles.meta}>
          {[date, `${visit.records.length} ${visit.records.length === 1 ? 'line' : 'lines'}`]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>

      <Card style={styles.card}>
        {visit.records.map((record, index) => {
          /*
            `withShop: false` — the shop is the heading above, and R34 is the
            record of what repeating it costs: `BLACKMARKET MOTORSPORTS` printed
            once per line, six times on one invoice.
          */
          const line = describeRecord(record, { withShop: false });
          const cost = record.total_cost;
          const hasCost = typeof cost === 'number' && Number.isFinite(cost) && cost > 0;

          return (
            <View
              key={record.id ?? `line-${index}`}
              style={[styles.line, index > 0 && styles.lineDivided]}
            >
              <View style={styles.lineText}>
                <Text style={styles.description}>
                  {record.item_description ?? 'Service'}
                </Text>
                {line.length > 0 && <Text style={styles.meta}>{line}</Text>}
              </View>

              {/*
                ⚠ A line with no price shows none. Extraction reads what is on
                the page, and a labour line folded into a parts line genuinely
                has no separate figure — printing $0 beside it would be a
                confident lie about a real bill, which is the FN-05 shape.
              */}
              {hasCost && <Text style={styles.cost}>{formatCurrency(cost as number)}</Text>}
            </View>
          );
        })}
      </Card>

      {visit.scanned && documentId && (
        <View style={styles.docBlock}>
          <Button
            label={opening ? 'Opening…' : 'Open the original invoice'}
            onPress={() => void open()}
            busy={opening}
            variant="outline"
            accessibilityLabel="Open the original invoice document"
          />
          {/*
            The error is shown here rather than raised as an alert. It is about
            this control, it is not urgent, and an alert would take a tap to
            dismiss before somebody could read the invoice's lines — which are
            the thing they came for and which still work.
          */}
          {openError ? <Text style={styles.openError}>{openError}</Text> : null}
        </View>
      )}

      {/*
        The total says what it is the total *of*. `counted` is how many lines
        carried a price, so an invoice where two of five did says so rather than
        presenting a partial sum as the bill.
      */}
      {visit.counted > 0 && (
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>
            {visit.counted === visit.records.length
              ? 'Total'
              : `Recorded across ${visit.counted} of ${visit.records.length}`}
          </Text>
          <Text style={styles.total}>{formatCurrency(visit.total)}</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: space.lg, gap: space.md, backgroundColor: surface.page, flexGrow: 1 },
  head: { gap: 2 },
  shop: { ...type.title, color: text.primary },
  meta: { ...type.label, color: text.muted },
  card: { padding: 0 },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md },
  lineDivided: { borderTopWidth: 1, borderTopColor: border.panel },
  lineText: { flex: 1, minWidth: 0, gap: 2 },
  description: { ...type.body, color: text.primary },
  cost: { ...type.body, ...TABULAR, color: text.primary },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space.sm,
    paddingHorizontal: space.xs,
  },
  docBlock: { gap: space.sm },
  openError: { ...type.label, color: text.muted },
  totalLabel: { ...type.label, color: text.muted, flex: 1 },
  total: { ...type.value, ...TABULAR, color: text.primary },
});

export default InvoiceDetailScreen;
