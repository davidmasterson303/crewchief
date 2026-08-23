import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import Card from '../components/Card';
import EmptyState from '../components/EmptyState';
import { apiRequest, ApiRequestError } from '../api/client';
import { Skeleton, SkeletonCard } from '../components/Skeleton';
import {
  describeRecord,
  describeRemoval,
  isRecollection,
  recordSourceLabel,
  totalRecorded,
  type ServiceRecord,
} from '@crewchief/core/service-record';
import { formatCurrency } from '@crewchief/core/formatting-utils';
import Icon from '../components/Icon';
import { FIELD_FONT_MIN, TARGET_MIN, border, radius, space, status, surface, text, type } from '../theme';
import { interFace } from '../theme/fonts';

/**
 * What has been done to this car, on the phone.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * The phone could **write** to the service record in three ways — scan an
 * invoice, complete a wishlist item, answer the onboarding history question —
 * and could not read it back anywhere. The only surface that showed any of it
 * was `ServiceMilestoneScreen`, which you reach by tapping a service-due
 * notification, and no notification has ever fired.
 *
 * So a person could file a job from the shop's car park and have no way to
 * confirm it landed. That is the loop this closes.
 *
 * ── Provenance is the point, not decoration ────────────────────────────────
 *
 * Four rows in one column, identical in weight, read as four equally solid
 * facts. One of them may be a recollection typed on a sign-up screen. The
 * schema went to the trouble of storing that difference —
 * `20260808150000` added `'owner-onboarding'` rather than reusing `'manual'`
 * specifically so it could be said — and a list is where it becomes visible or
 * is lost.
 *
 * ── The total is the number most likely to be misread ──────────────────────
 *
 * Rows without a cost are skipped rather than counted as zero, and the header
 * says how many rows the figure covers. "$1,820 across 6 of 9 services" is a
 * different claim from "$1,820", and only one of them is true.
 */

interface Props {
  vehicleId: string;
  onSignOut: () => void;
}

interface MaintenanceResponse {
  /**
   * The service record. **Not `lineItems`** — that key carries
   * `invoice_line_items`, which has a description and a price and no service
   * date, and reading it here was a live bug on `ServiceMilestoneScreen` until
   * 12 Aug 2026.
   */
  maintenanceLineItems?: ServiceRecord[] | null;
}

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'loaded'; records: ServiceRecord[] };

export function ServiceHistoryScreen({ vehicleId, onSignOut }: Props) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState('');

  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setState({ kind: 'loading' });

      try {
        const body = await apiRequest<MaintenanceResponse>(
          `/load-maintenance-data?vehicleId=${encodeURIComponent(vehicleId)}`
        );
        setState({
          kind: 'loaded',
          records: Array.isArray(body.maintenanceLineItems) ? body.maintenanceLineItems : [],
        });
      } catch (error) {
        const apiError = error as ApiRequestError;
        if (apiError.status === 401) {
          onSignOut();
          return;
        }
        /*
          An error is shown rather than an empty list. "No service history" and
          "we could not load the service history" look identical as a blank
          screen and mean opposite things — and the route was changed in
          `load-maintenance-data` for this exact reason, so throwing it away
          here would undo that.
        */
        setState({
          kind: 'error',
          message: apiError.message ?? 'Could not load the service history',
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

  const remove = useCallback(
    (record: ServiceRecord) => {
      if (!record.id) return;

      /*
        Confirmed, and the confirmation says what is actually lost rather than
        asking "are you sure?" — a question the person has no way to answer from
        the row in front of them. `describeRemoval` supplies the three facts
        that are invisible on the card: the invoice survives, a combined row
        takes its parts with it, and due dates are computed from these records.
      */
      Alert.alert(
        'Remove this record?',
        `“${record.item_description ?? 'This service'}” will be removed. ${describeRemoval(record)}`,
        [
          { text: 'Keep', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: () => {
              void (async () => {
                try {
                  await apiRequest('/delete-maintenance-item', {
                    method: 'POST',
                    body: { itemId: record.id, itemType: 'maintenance_line_item' },
                  });
                  await load(true);
                } catch (error) {
                  const apiError = error as ApiRequestError;
                  if (apiError.status === 401) {
                    onSignOut();
                    return;
                  }
                  /*
                    A 404 is its own message. The route returns one when the
                    delete matched no rows — the bug it is named for — and
                    "already gone" is a different thing to tell somebody than
                    "that failed".
                  */
                  Alert.alert(
                    apiError.status === 404 ? 'Already removed' : 'Could not remove that',
                    apiError.status === 404
                      ? 'That record is no longer here. Pull to refresh.'
                      : (apiError.message ?? 'Try again in a moment.')
                  );
                }
              })();
            },
          },
        ]
      );
    },
    [load, onSignOut]
  );

  if (state.kind === 'loading') {
    /*
      A summary line then records — the shape this screen actually resolves
      into, rather than three identical cards.
    */
    return (
      <ScrollView contentContainerStyle={styles.body}>
        <Skeleton width="45%" height={18} />
        <SkeletonCard lines={2} />
        <SkeletonCard lines={2} />
      </ScrollView>
    );
  }

  if (state.kind === 'error') {
    return (
      <View style={styles.centre}>
        <Text style={styles.errorTitle}>Could not load the service history</Text>
        <Text style={styles.errorBody}>{state.message}</Text>
        <Pressable
          style={styles.retry}
          onPress={() => void load()}
          accessibilityRole="button"
          accessibilityLabel="Try again"
        >
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  const { total, counted } = totalRecorded(state.records);

  /*
    ── ⚠ Filtered here, not on the server ────────────────────────────────────

    A service history is tens of rows, already on the device, and the whole
    list is in memory the moment the screen loads. A round trip per keystroke
    would be latency bought for nothing — the same argument the wishlist's
    catalogue makes, and the opposite of the add-a-car screen's model list,
    which genuinely lives at NHTSA.

    It matches the shop and the date as well as the description, because "what
    did that garage do" and "what happened in March" are the two questions
    somebody actually opens this screen with.
  */
  const query = filter.trim().toLowerCase();
  const shown = query
    ? state.records.filter((record) =>
        [record.item_description, record.shop_name, record.service_date]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(query)
      )
    : state.records;

  /*
    ── What each scanned invoice actually was ────────────────────────────────

    Every row that came off a scan carries `source_document_id`, and the rows
    sharing one *are* that invoice — so the shop, the date, the line count and
    the total are all derivable from what is already on the payload. No route,
    no join, no second request.

    ⚠ This is metadata **about the invoice**, not a link to it. The document is
    a stored file behind a signed URL and nothing in this app mints one, so a
    "view invoice" control could not work. Saying what the invoice was is the
    honest half, and it is most of the value: "was this the £600 visit in March
    or the other one" is the question people actually have.

    Reduced from the whole list rather than the filtered one, so a search does
    not make an invoice look smaller than it is.
  */
  const invoices = new Map<
    string,
    { items: number; total: number; shop: string | null; date: string | null }
  >();
  for (const record of state.records) {
    const id = record.source_document_id;
    if (!id) continue;

    const held = invoices.get(id) ?? { items: 0, total: 0, shop: null, date: null };
    invoices.set(id, {
      items: held.items + 1,
      total: held.total + (typeof record.total_cost === 'number' ? record.total_cost : 0),
      /*
        First non-empty wins. Every line off one invoice should carry the same
        shop and date; taking the first rather than the last means a row with a
        blank field cannot erase what a sibling knew.
      */
      shop: held.shop ?? record.shop_name ?? null,
      date: held.date ?? record.service_date ?? null,
    });
  }

  return (
    <ScrollView
      contentContainerStyle={styles.body}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={text.muted} />
      }
    >
      {state.records.length > 0 && (
        <View style={styles.search}>
          <Icon name="search" size={17} />
          <TextInput
            style={styles.searchInput}
            value={filter}
            onChangeText={setFilter}
            placeholder="Search by job, shop or date"
            placeholderTextColor={text.muted}
            accessibilityLabel="Search this service history"
            autoCorrect={false}
            returnKeyType="search"
          />
          {filter.length > 0 && (
            <Pressable
              onPress={() => setFilter('')}
              accessibilityRole="button"
              accessibilityLabel="Clear the search"
              style={styles.searchClear}
            >
              <Icon name="x" size={16} />
            </Pressable>
          )}
        </View>
      )}

      {state.records.length === 0 ? (
        /*
          No action: this screen has no navigation callbacks — only a vehicle
          id and a sign-out — so an "action" here could not go anywhere. The
          body names both routes in instead, which is the honest version of a
          next step on a screen that cannot offer one.
        */
        <EmptyState
          headline="Nothing recorded yet"
          body="Scan an invoice, or mark something done on the wishlist, and it will appear here."
        />
      ) : (
        <>
          <View style={styles.summary}>
            <Text style={styles.summaryCount}>
              {query
                ? `${shown.length} of ${state.records.length}`
                : `${state.records.length} ${state.records.length === 1 ? 'service' : 'services'}`}
            </Text>
            {counted > 0 && (
              <Text style={styles.summaryCost}>
                {formatCurrency(total)}
                {/*
                  Named coverage, always. A total over some of the rows read as
                  a total over all of them is the misreading this line exists to
                  prevent, and it is only avoidable by saying so.
                */}
                <Text style={styles.summaryScope}>
                  {counted === state.records.length
                    ? ' recorded'
                    : ` across ${counted} of ${state.records.length}`}
                </Text>
              </Text>
            )}
          </View>

          {shown.length === 0 && (
            <Text style={styles.noMatch}>
              Nothing matches “{filter.trim()}”. Clear the search to see all{' '}
              {state.records.length}.
            </Text>
          )}

          {shown.map((record, index) => {
            const provenance = recordSourceLabel(record.source);
            const meta = describeRecord(record);

            /* The scan this row came off, summarised. See `invoices` above. */
            const invoice = record.source_document_id
              ? (invoices.get(record.source_document_id) ?? null)
              : null;

            return (
              <Card key={record.id ?? `${record.item_description}-${index}`} style={styles.cardGap}>
                <View style={styles.head}>
                  <Text style={styles.name}>{record.item_description ?? 'Service'}</Text>
                  {typeof record.total_cost === 'number' && record.total_cost > 0 && (
                    <Text style={styles.cost}>{formatCurrency(record.total_cost)}</Text>
                  )}
                </View>

                {meta ? <Text style={styles.meta}>{meta}</Text> : null}

                {/*
                  What that scan was. Only when it covered more than this row —
                  a one-line invoice adds nothing the row does not already say.
                */}
                {invoice && invoice.items > 1 ? (
                  <Text style={styles.fromInvoice}>
                    {[
                      `From a scan of ${invoice.items} lines`,
                      invoice.shop,
                      invoice.total > 0 ? `${formatCurrency(invoice.total)} total` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                ) : null}

                <View style={styles.foot}>
                  {provenance ? (
                    <Text
                      style={[
                        styles.provenance,
                        isRecollection(record.source) && styles.recollection,
                      ]}
                    >
                      {provenance}
                    </Text>
                  ) : (
                    <View />
                  )}

                  {record.id ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${record.item_description ?? 'this record'}`}
                      style={styles.removeCta}
                      onPress={() => remove(record)}
                    >
                      <Text style={styles.removeText}>Remove</Text>
                    </Pressable>
                  ) : null}
                </View>
              </Card>
            );
          })}
        </>
      )}
    </ScrollView>
  );
}

/*
  Opaque colours, measured against `surface.page`. `mobile-text-contrast.test.ts`
  composites opacity into its 4.5:1 check, and this screen's quietest text is
  the provenance line — which is the one a reader most needs to be able to read.
*/
const styles = StyleSheet.create({
  noMatch: { ...type.body, color: text.secondary, paddingVertical: space.md },
  /* Pinned nothing — it scrolls with the list, which is short. See the filter's note. */
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: TARGET_MIN,
    paddingHorizontal: space.md,
    borderRadius: radius.well,
    borderWidth: 1,
    borderColor: border.field,
    backgroundColor: surface.well,
    marginBottom: space.sm,
  },
  /** Pinned at the field floor: under 16px iOS zooms on focus and never back. */
  searchInput: { flex: 1, color: text.primary, fontSize: FIELD_FONT_MIN, paddingVertical: space.sm },
  searchClear: { minHeight: TARGET_MIN, justifyContent: 'center', paddingLeft: space.xs },
  /** How many other rows came off the same scanned invoice. */
  fromInvoice: { ...type.label, letterSpacing: 0, color: text.muted },
  body: { padding: 20, gap: 12, paddingBottom: 40 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 10 },

  summary: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  summaryCount: { color: text.secondary, fontSize: 15, fontFamily: interFace('600'), fontWeight: '600' },
  summaryCost: { color: text.primary, fontSize: 15, fontFamily: interFace('700'), fontWeight: '700' },
  summaryScope: { color: text.muted, fontSize: 13, fontFamily: interFace('500'), fontWeight: '500' },

  /**
   * The card, on the ladder rather than beside it.
   *
   * ⚠ This was a **private copy** — `surface.raised` with no border, where the
   * `Card` primitive is `surface.card` with `border.panel`. `raised` is the
   * ladder's step for bars, tab strips and chips; a card painted on it sits one
   * step off from every other card in the app, which is precisely the "twelve
   * slightly different containers" the primitive set was built to end.
   *
   * The gap is kept as it was. Padding and gaps across this app want a pass
   * with a designer's eye rather than a find-and-replace — see the note in
   * `mobile-radius-scale.test.ts` on why that rule was scoped to radius.
   */
  cardGap: { gap: 6 },
  head: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  name: { color: text.primary, fontSize: 15, fontFamily: interFace('600'), fontWeight: '600', flexShrink: 1 },
  cost: { color: text.primary, fontSize: 15, fontFamily: interFace('700'), fontWeight: '700' },
  meta: { color: text.muted, fontSize: 13, lineHeight: 19 },

  /*
    Provenance and the remove control share a row, with the label given the
    flexible width. The label is the thing worth reading; the control is the
    thing worth finding, and neither should push the other off the card.
  */
  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  provenance: { color: text.muted, fontSize: 12, lineHeight: 17, flexShrink: 1 },
  removeCta: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  removeText: { color: status.attention, fontSize: 13, fontFamily: interFace('600'), fontWeight: '600' },
  /*
    A recollection is tinted rather than merely worded differently. The label
    already says "what you told us at sign-up"; the colour is what survives
    someone skimming, and skimming is what a list invites.
  */
  recollection: { color: status.attention },


  errorTitle: { color: text.primary, fontSize: 17, fontFamily: interFace('600'), fontWeight: '600' },
  errorBody: { color: text.muted, fontSize: 14, textAlign: 'center' },
  retry: {
    marginTop: 6,
    paddingHorizontal: 18,
    borderRadius: radius.button,
    borderWidth: 1,
    borderColor: border.field,
    minHeight: 44,
    justifyContent: 'center',
  },
  retryText: { color: text.secondary, fontSize: 14, fontFamily: interFace('600'), fontWeight: '600' },
});
