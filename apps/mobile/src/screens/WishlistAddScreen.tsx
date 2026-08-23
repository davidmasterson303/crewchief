import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import AlertBanner from '../components/AlertBanner';
import Button from '../components/Button';
import Chip from '../components/Chip';
import Icon from '../components/Icon';
import ListGroup from '../components/ListGroup';
import { SkeletonCard } from '../components/Skeleton';
import { apiRequest, ApiRequestError } from '../api/client';
import {
  filterSuggestions,
  learnMoreQuestion,
  suggestionsFor,
  type WishlistSuggestion,
} from '@crewchief/core/wishlist-suggestions';
import { wishlistItemIdentifier, type WishlistItemType } from '@crewchief/core/wishlist-identifier';
import {
  FIELD_FONT_MIN,
  TARGET_MIN,
  border,
  radius,
  space,
  surface,
  text,
  type,
} from '../theme';

/**
 * Adding to the wishlist — suggestions first, free text last.
 *
 * ── What this replaces ──────────────────────────────────────────────────────
 *
 * A text box on `WishlistScreen` and three "file it as" chips. David, 23 Aug:
 * *"wishlist is totally underbaked… it can't just be free entry, we need some
 * combo of list of suggestions with CTAs to Add or Learn More, and list should
 * be filterable with type ahead; dynamic filtering as user types."*
 *
 * The old screen's own docblock defended free-text-only on the grounds that
 * *"the phone has none of those [suggestion] surfaces yet."* It had them: the
 * knowledge base is on the `load-vehicle` payload the wishlist screen was one
 * route away from, and `BuildScreen` was already reading `common_mods` out of
 * it. `wishlist-suggestions.ts` carries the mapping.
 *
 * ── Why a route rather than a sheet on the wishlist ─────────────────────────
 *
 * `native-wishlist.spec.html` puts **Add in the nav bar** and says why a
 * floating button is wrong — *"a FAB covers the last row and belongs to a
 * different design language."* A nav-bar `+` implies a destination, and the
 * content earns one: a filter field, a scrolling catalogue and two controls per
 * row do not belong stacked on top of the list they are adding to.
 *
 * ── Free text survives, at the bottom ───────────────────────────────────────
 *
 * ⚠ The suggestions are an accelerator, never a gate. `known_issues` is what
 * research found, not what an owner knows about their own car — the noise their
 * gearbox makes is not in any catalogue. So whatever is typed into the filter
 * can always be added as itself, and that control is **the filter's own text**
 * rather than a second field, so there is nothing to retype.
 *
 * Same argument `Suggest` makes on the add-a-car screen, and the same one §10
 * makes generally: a list that refuses what is not in it asserts a completeness
 * it does not have.
 */

interface Props {
  vehicleId: string;
  title?: string;
  onSignOut: () => void;
  /** Pushes the advisor with the question already in hand. */
  onAskAdvisor: (vehicleId: string, ask: string) => void;
  /** Called after a successful add so the list behind this can refetch. */
  onAdded: () => void;
}

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | {
      kind: 'loaded';
      name: string;
      suggestions: WishlistSuggestion[];
      /** Identifiers already on the list — a suggestion says so rather than duplicating. */
      onList: Set<string>;
    };

/** What a hand-typed item is filed as when nothing else says otherwise. */
const DEFAULT_TYPE: WishlistItemType = 'maintenance';

export function WishlistAddScreen({ vehicleId, title, onSignOut, onAskAdvisor, onAdded }: Props) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState({ kind: 'loading' });

    try {
      /*
        Both, together. The knowledge base is the catalogue and the wishlist is
        what has already been taken from it — a suggestion that is already on
        the list must say so rather than offering to add it twice, which is the
        "lying already-added state" `wishlist-identifier.ts` was written about.
      */
      const [vehicleResult, wishlistResult] = await Promise.allSettled([
        apiRequest<{ vehicle?: { year?: number; make?: string; model?: string }; knowledge?: unknown }>(
          `/load-vehicle?vehicleId=${encodeURIComponent(vehicleId)}`
        ),
        apiRequest<{ wishlistItems?: Array<{ item_identifier?: string | null }> }>(
          `/wishlist?vehicleId=${encodeURIComponent(vehicleId)}`
        ),
      ]);

      if (vehicleResult.status === 'rejected') throw vehicleResult.reason;

      const vehicle = vehicleResult.value.vehicle;

      setState({
        kind: 'loaded',
        name:
          [vehicle?.year, vehicle?.make, vehicle?.model].filter(Boolean).join(' ') ||
          title ||
          'this car',
        suggestions: suggestionsFor(vehicleResult.value.knowledge),
        onList: new Set(
          wishlistResult.status === 'fulfilled'
            ? (wishlistResult.value.wishlistItems ?? []).flatMap((item) =>
                typeof item?.item_identifier === 'string' ? [item.item_identifier] : []
              )
            : []
        ),
      });
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) {
        onSignOut();
        return;
      }
      setState({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Could not load suggestions',
      });
    }
  }, [vehicleId, title, onSignOut]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Put something on the list.
   *
   * ⚠ The identifier always comes from `wishlistItemIdentifier`. The table
   * dedupes on `(vehicle_id, item_identifier)`, and a locally-built key
   * produces a duplicate row, an "Add" that never becomes "Added", and a delete
   * that silently matches nothing — all three have happened.
   */
  const add = useCallback(
    async (name: string, itemType: WishlistItemType, description?: string) => {
      const identifier = wishlistItemIdentifier(itemType, name);

      setProblem(null);
      setBusy(identifier);

      try {
        await apiRequest('/wishlist', {
          method: 'POST',
          body: {
            vehicleId,
            itemType,
            itemName: name,
            itemIdentifier: identifier,
            /*
              The reason travels with the item. Six weeks later a row reading
              "Charge pipe" has lost the only thing that made it a
              recommendation rather than a shopping list.
            */
            description: description ?? '',
            source: 'suggestions',
          },
        });

        setState((held) =>
          held.kind === 'loaded'
            ? { ...held, onList: new Set([...held.onList, identifier]) }
            : held
        );
        onAdded();
      } catch (error) {
        if (error instanceof ApiRequestError && error.status === 401) {
          onSignOut();
          return;
        }
        /*
          409 is the dedupe working, not a failure — the item is on the list,
          which is what was wanted. The row flips rather than showing an error
          about a state the person already has.
        */
        if (error instanceof ApiRequestError && error.status === 409) {
          setState((held) =>
            held.kind === 'loaded'
              ? { ...held, onList: new Set([...held.onList, identifier]) }
              : held
          );
          onAdded();
          return;
        }
        setProblem(error instanceof Error ? error.message : 'That could not be added.');
      } finally {
        setBusy(null);
      }
    },
    [vehicleId, onSignOut, onAdded]
  );

  /*
    ── The typeahead ────────────────────────────────────────────────────────

    Recomputed on every keystroke and deliberately not debounced: this filters
    an in-memory array of a dozen or so items, so there is nothing to wait for.
    A debounce here would be latency added on purpose. `AddVehicleScreen`
    debounces because its list comes over a network; this one does not.
  */
  const shown = useMemo(
    () => (state.kind === 'loaded' ? filterSuggestions(query, state.suggestions) : []),
    [state, query]
  );

  if (state.kind === 'loading') {
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
        <Text style={styles.errorTitle}>Could not load suggestions</Text>
        <Text style={styles.errorBody}>{state.message}</Text>
        <Button label="Try again" variant="outline" onPress={() => void load()} />
      </View>
    );
  }

  const typed = query.trim();
  const exactMatch = shown.some((s) => s.name.toLowerCase() === typed.toLowerCase());

  return (
    <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      {problem && <AlertBanner tone="critical" headline="That was not added" body={problem} />}

      {/* The filter. It is also the free-text field — see the header. */}
      <View style={styles.search}>
        <Icon name="search" size={17} />
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          placeholder="Filter, or type something of your own"
          placeholderTextColor={text.muted}
          accessibilityLabel="Filter suggestions, or type something to add"
          autoCorrect={false}
          returnKeyType="search"
        />
        {typed.length > 0 && (
          <Pressable
            onPress={() => setQuery('')}
            accessibilityRole="button"
            accessibilityLabel="Clear the filter"
            style={styles.clear}
          >
            <Icon name="x" size={16} />
          </Pressable>
        )}
      </View>

      {state.suggestions.length === 0 ? (
        /*
          Nothing known, rather than nothing to suggest. The knowledge base
          fills in seconds after a car is added, and saying "no suggestions"
          about a lookup that has not run is the recall screen's 21 Aug defect
          in another place.
        */
        <Text style={styles.empty}>
          We have not worked out what {state.name} needs yet. That fills in shortly after a car is
          added — pull back and open this again in a minute. You can still type anything in above
          and add it.
        </Text>
      ) : null}

      {shown.length > 0 && (
        <ListGroup label={typed ? `${shown.length} matching` : 'Suggested for this car'}>
          {shown.map((suggestion, index) => {
            const added = state.onList.has(suggestion.identifier);
            const working = busy === suggestion.identifier;

            return (
              <View
                key={suggestion.identifier}
                style={[styles.row, index < shown.length - 1 && styles.divided]}
              >
                <View style={styles.rowHead}>
                  <Text style={styles.name}>{suggestion.name}</Text>
                  {/*
                    ⚠ Coloured only when the research said so. The spec:
                    "priority chips are neutral unless the item is genuinely
                    urgent." A list where half the chips are amber has taught
                    its reader that amber means nothing.
                  */}
                  <Chip label={suggestion.chip} tone={suggestion.urgent ? 'attention' : 'neutral'} />
                </View>

                <Text style={styles.reason}>{suggestion.reason}</Text>
                {suggestion.note ? <Text style={styles.note}>{suggestion.note}</Text> : null}

                <View style={styles.actions}>
                  {added ? (
                    <View style={styles.addedRow}>
                      <Icon name="circle-check" size={16} color={text.secondary} />
                      <Text style={styles.addedText}>On the list</Text>
                    </View>
                  ) : (
                    <Button
                      label="Add"
                      variant="outline"
                      size="small"
                      busy={working}
                      accessibilityLabel={`Add ${suggestion.name} to the wishlist`}
                      onPress={() =>
                        void add(suggestion.name, suggestion.type, suggestion.reason)
                      }
                      style={styles.action}
                    />
                  )}
                  <Button
                    label="Learn more"
                    variant="ghost"
                    size="small"
                    accessibilityLabel={`Ask the advisor about ${suggestion.name}`}
                    onPress={() =>
                      onAskAdvisor(vehicleId, learnMoreQuestion(suggestion, state.name))
                    }
                    style={styles.action}
                  />
                </View>
              </View>
            );
          })}
        </ListGroup>
      )}

      {/*
        ── The free-text fallback ──────────────────────────────────────────────

        Offered only once something is typed, and suppressed when it exactly
        names a suggestion already on screen — two controls that do the same
        thing, one of which loses the reason and the type, is a worse list than
        one control.
      */}
      {typed.length > 0 && !exactMatch && (
        <View style={styles.own}>
          <Text style={styles.ownLead}>
            Not in the list? Add it as your own — it files as something to look at, and you can
            ask the advisor about it any time.
          </Text>
          <Button
            label={`Add “${typed}”`}
            variant="inverse"
            busy={busy === wishlistItemIdentifier(DEFAULT_TYPE, typed)}
            accessibilityLabel={`Add ${typed} to the wishlist`}
            onPress={() => void add(typed, DEFAULT_TYPE)}
          />
        </View>
      )}

      {shown.length === 0 && state.suggestions.length > 0 && typed.length > 0 && (
        <Text style={styles.empty}>
          Nothing we know about matches “{typed}”. That does not mean it is not worth doing — add
          it above.
        </Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.lg, gap: space.lg, paddingBottom: space.h2 },
  centre: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.h1,
    gap: space.sm,
  },
  errorTitle: { ...type.title, color: text.primary },
  errorBody: { ...type.body, color: text.muted, textAlign: 'center' },

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
  },
  /** Pinned at the field floor: under 16px iOS zooms on focus and never back. */
  input: { flex: 1, color: text.primary, fontSize: FIELD_FONT_MIN, paddingVertical: space.sm },
  clear: { minHeight: TARGET_MIN, justifyContent: 'center', paddingLeft: space.xs },

  row: { padding: space.md, gap: space.xs },
  divided: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: border.panel },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  name: { ...type.bodyStrong, color: text.primary, flexShrink: 1 },
  reason: { ...type.value, color: text.secondary, lineHeight: 19 },
  note: { ...type.label, letterSpacing: 0, color: text.muted },

  actions: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xs },
  action: { flexShrink: 1 },
  addedRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: TARGET_MIN },
  addedText: { ...type.uiStrong, color: text.secondary },

  own: { gap: space.sm },
  ownLead: { ...type.value, color: text.muted, lineHeight: 19 },
  empty: { ...type.body, color: text.secondary },
});
