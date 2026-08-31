import { ScrollView, StyleSheet, Text, View } from 'react-native';

import Card from '../components/Card';
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
 * ── ⚠ What this screen deliberately does not offer ─────────────────────────
 *
 * The document itself. The file is behind a signed URL and nothing on this
 * client mints one, so a "view invoice" control could not work — the same
 * finding `6560f1b` recorded when it added this metadata to the history rows.
 * Naming what the invoice was is the honest half, and it is most of the value:
 * *was this the March visit or the other one* is the actual question.
 */
export function InvoiceDetailScreen({ visit }: { visit: ServiceVisit }) {
  const date = formatRecordDate(visit.date);

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
  totalLabel: { ...type.label, color: text.muted, flex: 1 },
  total: { ...type.value, ...TABULAR, color: text.primary },
});

export default InvoiceDetailScreen;
