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

import { apiRequest, ApiRequestError } from '../api/client';
import { wishlistItemIdentifier, type WishlistItemType } from '@crewchief/core/wishlist-identifier';
import { formatCurrency } from '@crewchief/core/formatting-utils';

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

  if (state.kind === 'loading') {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color="rgba(255,255,255,0.6)" />
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
          tintColor="rgba(255,255,255,0.5)"
        />
      }
    >
      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="Something this car needs"
          placeholderTextColor="rgba(255,255,255,0.4)"
          accessibilityLabel="What to add to the wishlist"
          returnKeyType="done"
          onSubmitEditing={() => void add()}
        />

        <View style={styles.typeRow}>
          {TYPES.map((type) => (
            <Pressable
              key={type.value}
              accessibilityRole="button"
              accessibilityState={{ selected: draftType === type.value }}
              accessibilityLabel={`Add as ${type.label}`}
              style={[styles.typeChip, draftType === type.value && styles.typeChipOn]}
              onPress={() => setDraftType(type.value)}
            >
              <Text style={[styles.typeText, draftType === type.value && styles.typeTextOn]}>
                {type.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <Pressable
          style={[styles.addCta, (!draft.trim() || saving) && styles.addCtaOff]}
          accessibilityRole="button"
          accessibilityState={{ disabled: !draft.trim() || saving }}
          onPress={() => void add()}
        >
          <Text style={styles.addCtaText}>{saving ? 'Adding…' : 'Add to wishlist'}</Text>
        </Pressable>
      </View>

      {state.items.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.emptyTitle}>Nothing on the list yet</Text>
          <Text style={styles.emptyBody}>
            Add what this car needs as you think of it. The advisor uses this list when it
            works out what a job would cost.
          </Text>
        </View>
      ) : (
        state.items.map((item) => (
          <View key={item.id} style={styles.card}>
            <View style={styles.itemHead}>
              <Text style={styles.itemName}>{item.item_name}</Text>
              {estimate(item) && <Text style={styles.itemCost}>{estimate(item)}</Text>}
            </View>

            {item.description ? <Text style={styles.itemBody}>{item.description}</Text> : null}

            <View style={styles.itemFoot}>
              <Text style={styles.itemMeta}>{item.category ?? item.item_type ?? 'Item'}</Text>
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
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 20, gap: 14, paddingBottom: 40 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 10 },

  composer: { gap: 10 },
  input: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 12,
    paddingHorizontal: 14,
    /*
      16px, not 14. iOS Safari's zoom rule does not apply to a native
      `TextInput`, but RB0's floor — "16px any focusable input at ≤640" — was
      adopted as a system rule rather than a browser workaround, and a smaller
      field here would be the one place in the product that disagrees.
    */
    fontSize: 16,
    color: '#fff',
    minHeight: 48,
  },

  typeRow: { flexDirection: 'row', gap: 8 },
  typeChip: {
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
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
  typeChipOn: { backgroundColor: '#fff' },
  typeText: { color: 'rgba(255,255,255,0.7)', fontSize: 14, fontWeight: '600' },
  typeTextOn: { color: '#080808' },

  addCta: {
    backgroundColor: '#fff',
    borderRadius: 12,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  addCtaOff: { backgroundColor: '#8f8f8f' },
  addCtaText: { color: '#080808', fontSize: 16, fontWeight: '700', letterSpacing: -0.2 },

  card: { backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 14, padding: 16, gap: 8 },
  itemHead: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  itemName: { color: '#fff', fontSize: 15, fontWeight: '600', flexShrink: 1 },
  itemCost: { color: '#fff', fontSize: 15, fontWeight: '700' },
  itemBody: { color: 'rgba(255,255,255,0.7)', fontSize: 14, lineHeight: 20 },
  itemFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  itemMeta: { color: 'rgba(255,255,255,0.5)', fontSize: 12 },
  removeCta: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  removeText: { color: '#e0a468', fontSize: 14, fontWeight: '600' },

  emptyTitle: { color: '#fff', fontSize: 16, fontWeight: '600' },
  emptyBody: { color: 'rgba(255,255,255,0.7)', fontSize: 14, lineHeight: 20 },

  errorTitle: { color: '#fff', fontSize: 17, fontWeight: '600' },
  errorBody: { color: 'rgba(255,255,255,0.5)', fontSize: 14, textAlign: 'center' },
  button: {
    marginTop: 6,
    paddingHorizontal: 18,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.1)',
    minHeight: 44,
    justifyContent: 'center',
  },
  buttonText: { color: '#fff', fontSize: 14 },
});
