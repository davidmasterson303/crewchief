import { useCallback, useEffect, useState } from 'react';
import { useRefetchOnFocus } from '../navigation/useRefetchOnFocus';
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
  formatRecordDate,
  groupIntoVisits,
  isRecollection,
  recordSourceLabel,
  totalRecorded,
  type ServiceRecord,
  type ServiceVisit,
} from '@wellkept/core/service-record';
import { formatCurrency } from '@wellkept/core/formatting-utils';
import Icon from '../components/Icon';
import {
  FIELD_FONT_MIN,
  OPTICAL_CENTRE,
  PAGE_BODY,
  TABULAR,
  TARGET_MIN,
  border,
  radius,
  space,
  status,
  surface,
  text,
  type,
} from '../theme';
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
        /*
          ⚠ **MOB-08.** `isLocallySignedOut`, not any 401. A `device` 401 is
          genuinely signed out; a `server` 401 may be a token the server would
          accept a second later, and destroying a working session over one
          response is how a spurious failure becomes a forced re-login. The
          client's own docblock records a real tester hitting this three times out
          of three on 5 Aug — and one screen consumed the distinction.
        */
        if (apiError.isLocallySignedOut) {
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

  /*
    ── ⚠ MOB-09 · a write behind this screen used to be invisible ─────────────

    Nothing in this app refetched on focus. Every screen loaded once on mount
    and kept whatever it had — so adding to the wishlist, marking a recall
    repaired, confirming an odometer or scanning an invoice all succeeded and
    then returned to a screen that said they had not.

    `useRefetchOnFocus` carries the full argument, including why this runs on
    the first focus too rather than being clever about skipping it.
  */
  useRefetchOnFocus(load);

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
                  /*
                    ⚠ **MOB-08.** `isLocallySignedOut`, not any 401. A `device` 401 is
                    genuinely signed out; a `server` 401 may be a token the server would
                    accept a second later, and destroying a working session over one
                    response is how a spurious failure becomes a forced re-login. The
                    client's own docblock records a real tester hitting this three times out
                    of three on 5 Aug — and one screen consumed the distinction.
                  */
                  if (apiError.isLocallySignedOut) {
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
    ── ⚠ Grouped into visits, not listed as line items (R17) ─────────────────

    Rows sharing a `source_document_id` *are* one invoice — one afternoon, one
    shop, one total — and the screen used to draw a card per row and repeat that
    parent on every one of them. `groupIntoVisits` carries the argument and the
    grouping; this screen only renders it.

    Grouped from the **filtered** list, so a search narrows the lines inside a
    visit rather than hiding the visit. The totals in each visit header are
    computed over the lines actually shown, which is why they are recomputed
    here rather than taken from an unfiltered pass: a header reading $1,461 over
    two visible lines is the same misreading `totalRecorded` exists to prevent.
  */
  const visits = groupIntoVisits(shown);

  return (
    /*
      ── ⚠ The search is pinned, not scrolled ──────────────────────────────────

      Same fix as the wishlist's filter, for the same reason: a control whose
      job is to shorten a list must not scroll away with the list. By the time
      you have scrolled far enough to want it, it is off screen — so you scroll
      back up to reach the thing that would have saved you the scrolling.

      Outside the scroller rather than `stickyHeaderIndices`, because sticky
      headers on a `ScrollView` with `keyboardShouldPersistTaps` behave
      inconsistently on Android once the keyboard resizes the frame, and this is
      a text input.
    */
    <View style={styles.screen}>
      {state.records.length > 0 && (
        <View style={[styles.search, styles.searchPinned]}>
          <Icon name="search" size={17} />
          <TextInput
            style={styles.searchInput}
            value={filter}
            onChangeText={setFilter}
            placeholder="Search services"
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

      <ScrollView
        /* R37 / R57. Centred while there is nothing on file; top-aligned after. */
        contentContainerStyle={[styles.body, state.records.length === 0 && OPTICAL_CENTRE]}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={text.muted} />
        }
      >
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
          {/*
            ── R35 · a label above a value, not a word after a figure ────────

            It read `5 services   $1,461 recorded`, and "recorded" trailing a
            currency figure parses as a **unit** — the way "miles" does after a
            number. The word is doing real work (it names what the total covers,
            which is the misreading this line exists to prevent), so it moves
            above the figure into the slot the system already has for naming a
            value.
          */}
          <View style={styles.summary}>
            <Text style={styles.summaryCount}>
              {query
                ? `${shown.length} of ${state.records.length}`
                : `${state.records.length} ${state.records.length === 1 ? 'service' : 'services'}`}
            </Text>
            {counted > 0 && (
              <View style={styles.summaryTotal}>
                <Text style={styles.summaryScope}>
                  {counted === state.records.length
                    ? 'Recorded'
                    : `Recorded across ${counted} of ${state.records.length}`}
                </Text>
                <Text style={styles.summaryCost}>{formatCurrency(total)}</Text>
              </View>
            )}
          </View>

          {shown.length === 0 && (
            <Text style={styles.noMatch}>
              Nothing matches “{filter.trim()}”. Clear the search to see all{' '}
              {state.records.length}.
            </Text>
          )}

          {visits.map((visit) => (
            <Card key={visit.key} style={styles.card}>
              {/*
                ── R17 · the visit's own head, said once ────────────────────

                Shop, date and total. This is the parent that used to be
                repeated on every child row — five times, in caps, for a
                five-line invoice.
              */}
              <View style={styles.visitHead}>
                <View style={styles.visitIdentity}>
                  <Text style={styles.visitShop} numberOfLines={1}>
                    {visit.shop ?? 'Service record'}
                  </Text>
                  {formatRecordDate(visit.date) ? (
                    <Text style={styles.visitDate}>{formatRecordDate(visit.date)}</Text>
                  ) : null}
                </View>

                {visit.counted > 0 ? (
                  <Text style={styles.visitTotal}>{formatCurrency(visit.total)}</Text>
                ) : null}
              </View>

              {/*
                The line items, nested. The divider is between them rather than
                around each, because they are parts of one thing.
              */}
              {visit.records.map((record, index) => {
                const meta = describeRecord(record, { withShop: false });

                return (
                  <View
                    key={record.id ?? `${record.item_description}-${index}`}
                    style={[styles.line, index > 0 && styles.lineDivided]}
                  >
                    <View style={styles.head}>
                      <Text style={styles.name}>{record.item_description ?? 'Service'}</Text>
                      {typeof record.total_cost === 'number' && record.total_cost > 0 && (
                        <Text style={styles.cost}>{formatCurrency(record.total_cost)}</Text>
                      )}
                    </View>

                    {meta ? <Text style={styles.meta}>{meta}</Text> : null}

                    {record.id ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${record.item_description ?? 'this record'}`}
                        style={styles.removeCta}
                        onPress={() => remove(record)}
                      >
                        {/*
                          ── R9 · quiet, because destruction is not attention ─

                          It was `status.attention` — amber — which made the one
                          destructive control the loudest thing in every row, and
                          amber is the *attention* family rather than the
                          critical one. It reads at `text.muted` now, and the
                          only red in this flow is the confirm inside the alert
                          `remove` raises. Swipe-to-delete is the platform idiom
                          and is what this should become; it needs
                          `react-native-gesture-handler`, which is a native
                          module and therefore an EAS build (§9), so it waits for
                          one that is being spent anyway.
                        */}
                        <Text style={styles.removeText}>Remove</Text>
                      </Pressable>
                    ) : null}
                  </View>
                );
              })}

              {/*
                ── R17 · provenance once, on the parent, where it is true ────

                It used to sit on every child, so a five-line invoice said "read
                from a scan of 5 lines" five times. Here it describes the object
                it is attached to.
              */}
              <View style={styles.foot}>
                <Text
                  style={[
                    styles.provenance,
                    visit.records.some((record) => isRecollection(record.source)) &&
                      styles.recollection,
                  ]}
                >
                  {visitProvenance(visit)}
                </Text>
              </View>
            </Card>
          ))}

        </>
      )}
      </ScrollView>
    </View>
  );
}

/*
  Opaque colours, measured against `surface.page`. `mobile-text-contrast.test.ts`
  composites opacity into its 4.5:1 check, and this screen's quietest text is
  the provenance line — which is the one a reader most needs to be able to read.
*/
/**
 * What a visit was read from, in one line — R17 and the §6 copy pass.
 *
 * Every line item used to carry its own copy of this, so a five-line invoice
 * printed *"From a scan of 5 lines · BLACKMARKET MOTORSPORTS · $1,461 total"*
 * five times and the shop and the total twice within each. Attached to the
 * visit it describes, it is true once and says something.
 *
 * ⚠ Mixed sources inside one visit are possible — a scanned invoice the owner
 * later added a line to by hand — and the honest wording is the general one
 * rather than picking whichever source came first.
 */
function visitProvenance(visit: ServiceVisit): string {
  if (visit.scanned) {
    const lines = visit.records.length;
    return `Read from a ${lines}-line invoice you scanned`;
  }

  const sources = new Set(
    visit.records.map((record) => recordSourceLabel(record.source)).filter(Boolean)
  );

  if (sources.size === 1) return [...sources][0] as string;
  if (sources.size > 1) return 'Recorded from more than one source';

  return 'Recorded on this car';
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: surface.page },
  /* Pinned above the scroller, on the page's own surface so nothing shows through. */
  searchPinned: { marginHorizontal: space.lg, marginTop: space.lg, marginBottom: 0 },
  noMatch: { ...type.body, color: text.secondary, paddingVertical: space.md },
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
  body: { ...PAGE_BODY },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 10 },

  summary: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  summaryCount: { ...type.ui, color: text.secondary },
  summaryTotal: { alignItems: 'flex-end', gap: 2 },
  summaryCost: { ...type.bodyStrong, color: text.primary, ...TABULAR },
  summaryScope: { ...type.label, color: text.muted, textTransform: 'uppercase' },

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
  card: { gap: space.md },

  /* ── R17 · the visit's head ─────────────────────────────────────────────── */
  visitHead: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md },
  visitIdentity: { flexShrink: 1, gap: 2 },
  visitShop: { ...type.bodyStrong, color: text.primary },
  /* R11. A date is data. */
  visitDate: { ...type.value, color: text.muted, ...TABULAR },
  /* R11. The visit's total, and the biggest figure on the card. */
  visitTotal: { ...type.bodyStrong, color: text.primary, ...TABULAR },

  /* ── the line items, nested inside it ───────────────────────────────────── */
  line: { gap: 4 },
  /*
    Between lines, not around each: they are parts of one object. Inset to the
    card's own padding so the rule reads as a seam rather than a slice.
  */
  lineDivided: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: border.panel,
    paddingTop: space.md,
  },

  head: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md },
  name: { ...type.ui, color: text.primary, flexShrink: 1 },
  /* R11. A right-aligned price column that is not tabular reads as ragged. */
  cost: { ...type.uiStrong, color: text.primary, ...TABULAR },
  meta: { ...type.value, color: text.muted, ...TABULAR },

  /*
    Provenance and the remove control share a row, with the label given the
    flexible width. The label is the thing worth reading; the control is the
    thing worth finding, and neither should push the other off the card.
  */
  foot: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: border.panel,
    paddingTop: space.sm,
  },
  provenance: { ...type.label, letterSpacing: 0, color: text.muted, flexShrink: 1 },
  removeCta: { minHeight: TARGET_MIN, justifyContent: 'center', alignSelf: 'flex-start' },
  /* R9. Quiet. The destructive colour appears only in the confirm `remove` raises. */
  removeText: { ...type.label, letterSpacing: 0, color: text.muted },
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
