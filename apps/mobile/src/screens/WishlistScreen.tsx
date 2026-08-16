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
import { apiRequest, ApiRequestError } from '../api/client';
import { wishlistItemIdentifier, type WishlistItemType } from '@crewchief/core/wishlist-identifier';
import { formatCurrency } from '@crewchief/core/formatting-utils';
import { completionPayload, type CompletionDraft } from '@crewchief/core/wishlist-completion';
import { MarkDoneSheet } from './MarkDoneSheet';
import { border, brand, radius, status, surface, text, type } from '../theme';

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
 * ── Why a manual add, and only a manual one ─────────────────────────────────
 *
 * The web adds items from three places — the dossier, the consultant, and a
 * manual dialog — because it has the surfaces that suggest them. The phone has
 * none of those yet, so a free-text add is the honest version: it is what "on
 * the go" means, and the suggestion-driven paths belong with the screens that
 * do the suggesting.
 *
 * The identifier comes from `@crewchief/core/wishlist-identifier`, which exists
 * because three call sites once built it three different ways and produced
 * duplicates, a lying "already added" state, and deletes that silently matched
 * nothing. A fourth spelling here would reintroduce all three.
 */

interface Props {
  vehicleId: string;
  onSignOut: () => void;
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

/** The three the route accepts. Anything else is a 400 from the server. */
const TYPES: Array<{ value: WishlistItemType; label: string }> = [
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'modification', label: 'Mod' },
  { value: 'issue', label: 'Issue' },
];

function estimate(item: WishlistItem): string | null {
  const total = (item.estimated_cost_parts ?? 0) + (item.estimated_cost_labor ?? 0);
  return total > 0 ? formatCurrency(total) : null;
}

export function WishlistScreen({ vehicleId, onSignOut }: Props) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  const [draft, setDraft] = useState('');
  const [draftType, setDraftType] = useState<WishlistItemType>('maintenance');
  const [saving, setSaving] = useState(false);
  /*
    The composer is closed by default. It used to sit permanently above the
    list, which made this a data-entry form with a list underneath rather than
    "your list" with a way to add to it — and it pushed the first real item
    below the fold on a phone.
  */
  const [composerOpen, setComposerOpen] = useState(false);
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

  const add = useCallback(async () => {
    const itemName = draft.trim();
    if (!itemName || saving) return;

    setSaving(true);
    try {
      await apiRequest('/wishlist', {
        method: 'POST',
        body: {
          vehicleId,
          itemType: draftType,
          itemName,
          itemIdentifier: wishlistItemIdentifier(draftType, itemName),
        },
      });
      setDraft('');
      await load(true);
    } catch (error) {
      const apiError = error as ApiRequestError;
      if (apiError.status === 401) {
        onSignOut();
        return;
      }
      /*
        409 is a normal path, not a failure. The route returns it when the
        identifier already exists — which is the dedupe working, and the honest
        message is that it is already on the list rather than that something
        broke.
      */
      Alert.alert(
        apiError.status === 409 ? 'Already on the list' : 'Could not add that',
        apiError.status === 409
          ? `"${itemName}" is already on this vehicle's wishlist.`
          : (apiError.message ?? 'Try again in a moment.')
      );
    } finally {
      setSaving(false);
    }
  }, [draft, draftType, saving, vehicleId, load, onSignOut]);

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
    return (
      <View style={styles.centre}>
        <ActivityIndicator color={text.secondary} />
      </View>
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
      {!composerOpen ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add something to the wishlist"
          style={styles.openComposer}
          onPress={() => setComposerOpen(true)}
        >
          <Text style={styles.openComposerText}>Add something</Text>
        </Pressable>
      ) : (
        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="Something this car needs"
            placeholderTextColor={text.muted}
            accessibilityLabel="What to add to the wishlist"
            returnKeyType="done"
            autoFocus
            onSubmitEditing={() => void add()}
          />

          {/*
            ── The type is a refinement, not a toll gate ──────────────────────

            These were three equal chips with `maintenance` preselected, shown
            before the text field had anything in it. That made a taxonomy
            decision the *first* thing the screen asked for, and the answer
            barely surfaced afterwards — nothing groups or filters by it, so the
            user classified an item for no visible return.

            Now they appear only once there is something to classify, and the
            label says what they are for. The default still stands on its own:
            most things a car needs are maintenance, and an unchanged default is
            a correct answer rather than an unanswered question.
          */}
          {draft.trim().length > 0 && (
            <View style={styles.typeBlock}>
              <Text style={styles.typeLabel}>File it as</Text>
              <View style={styles.typeRow}>
                {TYPES.map((type) => (
                  <Pressable
                    key={type.value}
                    accessibilityRole="button"
                    accessibilityState={{ selected: draftType === type.value }}
                    accessibilityLabel={`File as ${type.label}`}
                    style={[styles.typeChip, draftType === type.value && styles.typeChipOn]}
                    onPress={() => setDraftType(type.value)}
                  >
                    <Text style={[styles.typeText, draftType === type.value && styles.typeTextOn]}>
                      {type.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          <View style={styles.composerActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel adding"
              style={styles.composerCancel}
              onPress={() => {
                setComposerOpen(false);
                setDraft('');
              }}
            >
              <Text style={styles.composerCancelText}>Cancel</Text>
            </Pressable>

            <Button
              label="Add"
              variant="inverse"
              /*
                Named explicitly. The visible label shortened to "Add" when the
                composer gained a Cancel beside it, and "Add" alone is a poor
                accessible name — a screen reader user hears it with no object.
                The visible text can be terse because the surrounding form is
                visible; the accessible name cannot rely on that.
              */
              accessibilityLabel="Add to wishlist"
              disabled={!draft.trim()}
              busy={saving}
              onPress={() => void add()}
            />
          </View>
        </View>
      )}

      {state.items.length === 0 ? (
        <Card style={styles.cardGap}>
          <Text style={styles.emptyTitle}>Nothing on the list yet</Text>
          <Text style={styles.emptyBody}>
            Add what this car needs as you think of it. The advisor uses this list when it
            works out what a job would cost.
          </Text>
        </Card>
      ) : (
        state.items.map((item) => (
          <Card key={item.id} style={styles.cardGap}>
            <View style={styles.itemHead}>
              <Text style={styles.itemName}>{item.item_name}</Text>
              {estimate(item) && <Text style={styles.itemCost}>{estimate(item)}</Text>}
            </View>

            {item.description ? <Text style={styles.itemBody}>{item.description}</Text> : null}

            <View style={styles.itemFoot}>
              <Text style={styles.itemMeta}>{item.category ?? item.item_type ?? 'Item'}</Text>
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
          </Card>
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
  openComposerText: { color: text.secondary, fontSize: 15, fontWeight: '600' },

  composer: { gap: 10 },
  typeBlock: { gap: 8 },
  typeLabel: { color: text.muted, fontSize: 12, fontWeight: '600' },
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
  composerCancelText: { color: text.secondary, fontSize: 15, fontWeight: '600' },
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
  typeText: { color: text.secondary, fontSize: 14, fontWeight: '600' },
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
  itemName: { color: text.primary, fontSize: 15, fontWeight: '600', flexShrink: 1 },
  itemCost: { color: text.primary, fontSize: 15, fontWeight: '700' },
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
  doneText: { color: brand.accent, fontSize: 14, fontWeight: '700' },
  removeCta: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  removeText: { color: status.attention, fontSize: 14, fontWeight: '600' },

  emptyTitle: { color: text.primary, fontSize: 16, fontWeight: '600' },
  emptyBody: { color: text.secondary, fontSize: 14, lineHeight: 20 },

  errorTitle: { color: text.primary, fontSize: 17, fontWeight: '600' },
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
