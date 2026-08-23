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

import Button from '../components/Button';
import Card from '../components/Card';
import Chip from '../components/Chip';
import EmptyState from '../components/EmptyState';
import { apiRequest, ApiRequestError } from '../api/client';
import { Skeleton, SkeletonCard } from '../components/Skeleton';
import { formatCurrency } from '@crewchief/core/formatting-utils';
import { completionPayload, type CompletionDraft } from '@crewchief/core/wishlist-completion';
import { MarkDoneSheet } from './MarkDoneSheet';
import { TABULAR, border, brand, radius, space, status, surface, text, type } from '../theme';
import { interFace } from '../theme/fonts';

/**
 * Phase 5.6 — the wishlist, on the phone.
 *
 * ── This widens the mobile surface, and that was a decision ─────────────────
 *
 * `cc-product-0001` says mobile is three flows — scan an invoice, ask the
 * advisor, glance at garage health — and that new features default to
 * `mobile: n/a`, with any widening argued explicitly and agreed by David. He
 * agreed on 7 Aug 2026: "people may want to add items to wishlist on the go."
 *
 * That entry's own open question, written 25 July, called this exact moment:
 * *"Push notifications land in the garage flow; whether that widens the surface
 * in practice is worth watching."* It does, and this is it. The KB entry needs
 * revising rather than quietly contradicting.
 *
 * ── Against the existing route, which had to be fixed first ─────────────────
 *
 * `GET /api/v1/wishlist` authenticated cookie-only until `922576f`, so this
 * screen could have added and deleted items and never listed them. The bug was
 * invisible from the web app and would have looked like an empty wishlist here.
 *
 * ── ⚠ 23 Aug: the free-text defence had expired ────────────────────────────
 *
 * This docblock used to say: *"The web adds items from three places — the
 * dossier, the consultant, and a manual dialog — because it has the surfaces
 * that suggest them. The phone has none of those yet, so a free-text add is the
 * honest version."*
 *
 * The phone had them. `vehicle_knowledge_base` is on the `load-vehicle`
 * payload this screen sits one route from, `BuildScreen` had been reading
 * `common_mods` out of it since the same morning, and `known_issues` and
 * `maintenance_schedule` map onto the other two wishlist types exactly.
 *
 * David's verdict was *"totally underbaked"*, and the shape of the fix was his
 * too: suggestions with Add and Learn more, filterable as you type.
 * `WishlistAddScreen` is that catalogue; this screen is the list it feeds.
 *
 * ── What this screen is now ────────────────────────────────────────────────
 *
 * The list, and only the list: a summary line, the rows, and the two things
 * you can do to a row. Adding moved off it entirely — the composer used to sit
 * above the first item and made this a data-entry form with a list underneath.
 *
 * The identifier still comes from `@crewchief/core/wishlist-identifier`, which
 * exists because three call sites once built it three different ways and
 * produced duplicates, a lying "already added" state, and deletes that silently
 * matched nothing. A fourth spelling anywhere reintroduces all three.
 */

interface Props {
  vehicleId: string;
  onSignOut: () => void;
  /**
   * Opens the suggestions catalogue.
   *
   * ⚠ A route, not a sheet on this screen, and the nav bar is where it is
   * offered from. `native-wishlist.spec.html`: *"Add is in the nav bar, not a
   * floating action button. A FAB covers the last row and belongs to a
   * different design language."*
   */
  onAdd: () => void;
}

interface WishlistItem {
  id: string;
  item_name: string;
  item_type?: string | null;
  description?: string | null;
  category?: string | null;
  estimated_cost_parts?: number | null;
  estimated_cost_labor?: number | null;
}

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'loaded'; items: WishlistItem[] };

function estimate(item: WishlistItem): string | null {
  const total = (item.estimated_cost_parts ?? 0) + (item.estimated_cost_labor ?? 0);
  return total > 0 ? formatCurrency(total) : null;
}

/**
 * ⚠ The list's total, summed from **the same array the rows render from**.
 *
 * Not a stored figure and not a second query. `native-wishlist.spec.html`
 * records this system shipping "Wishlist · 4 items" over three rows and says
 * why it matters: a count that disagrees with what is on screen is the fastest
 * way to lose a user's trust in every other number. Deriving both from one
 * array is the only version where they cannot disagree.
 *
 * Rows with no estimate contribute 0 and still count as a row — which is
 * honest: it is a real item nobody has costed, and the summary says
 * "estimated" for exactly that reason.
 */
function listTotal(items: readonly WishlistItem[]): number {
  return items.reduce(
    (sum, item) => sum + (item.estimated_cost_parts ?? 0) + (item.estimated_cost_labor ?? 0),
    0
  );
}

/**
 * The row's chip.
 *
 * `category` when the item came from somewhere that assigned one — the
 * progression ladder writes a role there — falling back to the item type in
 * plain words. Never "Item": a chip that says nothing is a chip that should
 * not be drawn, and every row has at least a type.
 */
const TYPE_WORD: Record<string, string> = {
  issue: 'Known issue',
  maintenance: 'Service',
  modification: 'Modification',
};

function chipFor(item: WishlistItem): string {
  return item.category?.trim() || TYPE_WORD[item.item_type ?? ''] || 'Service';
}

/**
 * Whether a row may wear colour.
 *
 * ⚠ Only an **issue** can, and only because that is the one type where the
 * research made a severity judgement. A service and a modification are things
 * you plan; an issue is a thing that is wrong. Colouring more than that is how
 * a list teaches its reader to ignore the colour — the spec's own point.
 */
function isUrgent(item: WishlistItem): boolean {
  return item.item_type === 'issue';
}

export function WishlistScreen({ vehicleId, onSignOut, onAdd }: Props) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  const [doneItem, setDoneItem] = useState<WishlistItem | null>(null);
  const [completing, setCompleting] = useState(false);

  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setState({ kind: 'loading' });

      try {
        const body = await apiRequest<{ wishlistItems?: WishlistItem[] }>(
          `/wishlist?vehicleId=${encodeURIComponent(vehicleId)}`
        );
        setState({ kind: 'loaded', items: body.wishlistItems ?? [] });
      } catch (error) {
        const apiError = error as ApiRequestError;
        if (apiError.status === 401) {
          onSignOut();
          return;
        }
        setState({ kind: 'error', message: apiError.message ?? 'Could not load the wishlist' });
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
    (item: WishlistItem) => {
      /*
        Confirmed, because there is no undo. The web has the same delete behind
        a dialog; a swipe-to-delete with no restore on a small screen is how
        someone loses a list they built over a month.
      */
      Alert.alert('Remove from wishlist?', `"${item.item_name}" will be removed.`, [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await apiRequest(`/wishlist?itemId=${encodeURIComponent(item.id)}`, {
                  method: 'DELETE',
                });
                await load(true);
              } catch (error) {
                const apiError = error as ApiRequestError;
                if (apiError.status === 401) {
                  onSignOut();
                  return;
                }
                Alert.alert('Could not remove that', apiError.message ?? 'Try again in a moment.');
              }
            })();
          },
        },
      ]);
    },
    [load, onSignOut]
  );

  const complete = useCallback(
    async (draft: CompletionDraft) => {
      const item = doneItem;
      if (!item || completing) return;

      setCompleting(true);
      try {
        await apiRequest('/wishlist/complete', {
          method: 'POST',
          body: completionPayload(item.id, draft),
        });
        setDoneItem(null);
        await load(true);
      } catch (error) {
        const apiError = error as ApiRequestError;
        if (apiError.status === 401) {
          onSignOut();
          return;
        }
        /*
          The sheet stays open on failure. Closing it would discard what the
          person typed and leave them unsure whether the history row was
          written — and this is the one action here with no undo.
        */
        Alert.alert('Could not mark that done', apiError.message ?? 'Try again in a moment.');
      } finally {
        setCompleting(false);
      }
    },
    [doneItem, completing, load, onSignOut]
  );

  if (state.kind === 'loading') {
    // Three cards, because that is what a wishlist resolves into.
    return (
      <ScrollView contentContainerStyle={styles.body}>
        <SkeletonCard lines={2} />
        <SkeletonCard lines={2} />
        <SkeletonCard lines={2} />
      </ScrollView>
    );
  }

  if (state.kind === 'error') {
    return (
      <View style={styles.centre}>
        <Text style={styles.errorTitle}>Could not load the wishlist</Text>
        <Text style={styles.errorBody}>{state.message}</Text>
        <Pressable style={styles.button} onPress={() => void load()} accessibilityRole="button">
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.body}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void load(true)}
          tintColor={text.muted}
        />
      }
    >
      {/*
        ── The summary line ────────────────────────────────────────────────────

        ⚠ **The count and the total come from the same array**, and that is a
        rule with a history. `native-wishlist.spec.html`: *"the total sums to
        $4,980 and the four rows are all four rows. Stated because this system
        has shipped 'Wishlist · 4 items' over three rows before; a count that
        disagrees with what is on screen is the fastest way to lose a user's
        trust in every other number."*

        `estimated` is said out loud rather than implied by a currency symbol.
        Some rows carry no price at all — nobody has costed them — so the total
        is a floor, and calling it an estimate is the honest framing §10 asks
        for.
      */}
      {state.items.length > 0 && (
        <View style={styles.summary}>
          <Text style={styles.summaryLabel}>
            {state.items.length} {state.items.length === 1 ? 'ITEM' : 'ITEMS'} · ESTIMATED
          </Text>
          <Text style={styles.summaryTotal}>{formatCurrency(listTotal(state.items))}</Text>
        </View>
      )}

      {state.items.length === 0 ? (
        /*
          No action, and deliberately: the "Add something" control sits directly
          above this. A second control with the same job would be two ways to do
          one thing on a screen with nothing on it — which reads as indecision
          rather than helpfulness.
        */
        /*
          ⚠ No action here, and that is the fix rather than an omission.

          It carried a "See suggestions" button while the nav bar's + does the
          same thing two inches above it — David's "redundant CTA". The spec is
          explicit that Add lives in the nav bar, so the button is the one that
          goes, and the copy names the control that stays.
        */
        <EmptyState
          headline="Nothing on the list yet"
          body="Tap + above to see what we already know this car needs — its known issues, its schedule, and the usual modifications. You can add anything of your own too."
        />
      ) : (
        state.items.map((item, index) => (
          /*
            ⚠ A divided row, not a `Card` each. The spec is explicit: *"rows get
            whitespace and a hairline divider, never zebra striping"* — and a
            stack of bordered cards is the same mistake in the other direction,
            six boxes where the eye wants one list. The last row draws no rule.
          */
          <View
            key={item.id}
            style={[styles.item, index < state.items.length - 1 && styles.itemDivided]}
          >
            <View style={styles.itemHead}>
              <Text style={styles.itemName}>{item.item_name}</Text>
              {estimate(item) && <Text style={styles.itemCost}>{estimate(item)}</Text>}
            </View>

            {item.description ? <Text style={styles.itemBody}>{item.description}</Text> : null}

            <View style={styles.itemFoot}>
              {/*
                Neutral unless the row earned otherwise. The spec: *"semantic
                colour does semantic work only — 'Control' and 'Durability' are
                roles from the progression ladder, not severities."*
              */}
              <Chip label={chipFor(item)} tone={isUrgent(item) ? 'attention' : 'neutral'} />
              <View style={styles.itemActions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Mark ${item.item_name} done`}
                  style={styles.doneCta}
                  onPress={() => setDoneItem(item)}
                >
                  <Text style={styles.doneText}>Done</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${item.item_name} from the wishlist`}
                  style={styles.removeCta}
                  onPress={() => remove(item)}
                >
                  <Text style={styles.removeText}>Remove</Text>
                </Pressable>
              </View>
            </View>
          </View>
        ))
      )}

      <MarkDoneSheet
        visible={doneItem !== null}
        itemName={doneItem?.item_name ?? ''}
        today={new Date().toISOString().slice(0, 10)}
        saving={completing}
        onCancel={() => setDoneItem(null)}
        onConfirm={(draft) => void complete(draft)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  /*
    ── The summary line ─────────────────────────────────────────────────────

    Label left in the uppercase label role, total right at the editorial size in
    tabular figures. It is the one big number on the screen and it earns that:
    the list exists so somebody can see what this car is going to cost.
  */
  summary: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space.md,
    paddingBottom: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: border.panel,
  },
  summaryLabel: { ...type.label, color: text.muted },
  summaryTotal: {
    ...type.editorial,
    fontSize: 26,
    lineHeight: 32,
    color: text.primary,
    ...TABULAR,
  },

  /* Rows in one list, divided by a hairline. Never cards, never striped. */
  item: { paddingVertical: space.md, gap: space.xs },
  itemDivided: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: border.panel },

  body: { padding: 20, gap: 14, paddingBottom: 40 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 10 },

  /*
    The closed state. A single control that says what it does, so the screen
    opens as a list rather than as a form — the first item is now above the
    fold on a phone, which it was not.
  */
  openComposer: {
    minHeight: 48,
    borderRadius: radius.button,
    borderWidth: 1,
    borderColor: border.field,
    alignItems: 'center',
    justifyContent: 'center',
  },
  openComposerText: { color: text.secondary, fontSize: 15, fontFamily: interFace('600'), fontWeight: '600' },

  composer: { gap: 10 },
  typeBlock: { gap: 8 },
  typeLabel: { color: text.muted, fontSize: 12, fontFamily: interFace('600'), fontWeight: '600' },
  composerActions: { flexDirection: 'row', gap: 10 },
  composerCancel: {
    minHeight: 48,
    paddingHorizontal: 18,
    borderRadius: radius.button,
    borderWidth: 1,
    borderColor: border.field,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerCancelText: { color: text.secondary, fontSize: 15, fontFamily: interFace('600'), fontWeight: '600' },
  input: {
    backgroundColor: surface.raised,
    borderRadius: radius.button,
    paddingHorizontal: 14,
    /*
      16px, not 14. iOS Safari's zoom rule does not apply to a native
      `TextInput`, but RB0's floor — "16px any focusable input at ≤640" — was
      adopted as a system rule rather than a browser workaround, and a smaller
      field here would be the one place in the product that disagrees.
    */
    fontSize: 16,
    color: text.primary,
    minHeight: 48,
  },

  typeRow: { flexDirection: 'row', gap: 8 },
  typeChip: {
    paddingHorizontal: 14,
    borderRadius: radius.button,
    backgroundColor: surface.raised,
    /*
      Grown for real rather than given a 44px `::after`-style hit area. These
      wrap in a row with an 8px gap, and R9 recorded what happens when a padded
      hit area overhangs into a gap from both sides: two rows of chips get
      overlapping targets and the tap goes to whichever painted last. A control
      that answers the wrong tap is worse than one slightly too small.
    */
    minHeight: 44,
    justifyContent: 'center',
  },
  typeChipOn: { backgroundColor: surface.inverse },
  typeText: { color: text.secondary, fontSize: 14, fontFamily: interFace('600'), fontWeight: '600' },
  typeTextOn: { color: text.onInverse },

  /*
    An explicit fill, **not `opacity`**, and that is a testability decision as
    much as a design one.

    `opacity` on the parent is the obvious way to grey a button out, and the
    contrast audit cannot see it: `auditText` derives each text's surface from
    the style tree, and a parent alpha never reaches the comparison. Verified —
    dropping the old `opacity: 0.55` to `0.12` left all 39 mobile tests green
    while making the label genuinely unreadable. A guard that cannot fail on
    the thing it is named after is worse than no guard.

    A real colour is measured. #8f8f8f against the near-black label reads about
    6.2:1, and taking it darker turns the suite red, which is the whole point.
  */

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
  cardGap: { gap: 8 },
  itemHead: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  itemName: { color: text.primary, fontSize: 15, fontFamily: interFace('600'), fontWeight: '600', flexShrink: 1 },
  itemCost: { color: text.primary, fontSize: 15, fontFamily: interFace('700'), fontWeight: '700' },
  itemBody: { color: text.secondary, fontSize: 14, lineHeight: 20 },
  itemFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  itemMeta: { color: text.muted, fontSize: 12 },
  itemActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  /*
    Done is the primary action on a row and Remove is not, so they do not look
    alike. Remove deletes; Done writes the job into the car's service history
    and is the reason to keep a list at all.
  */
  doneCta: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: radius.button,
    borderWidth: 1,
    borderColor: brand.primary,
    justifyContent: 'center',
  },
  doneText: { color: brand.accent, fontSize: 14, fontFamily: interFace('700'), fontWeight: '700' },
  removeCta: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  removeText: { color: status.attention, fontSize: 14, fontFamily: interFace('600'), fontWeight: '600' },


  errorTitle: { color: text.primary, fontSize: 17, fontFamily: interFace('600'), fontWeight: '600' },
  errorBody: { color: text.muted, fontSize: 14, textAlign: 'center' },
  button: {
    marginTop: 6,
    paddingHorizontal: 18,
    borderRadius: radius.button,
    backgroundColor: surface.raised,
    minHeight: 44,
    justifyContent: 'center',
  },
  buttonText: { color: text.primary, fontSize: 14 },
});
