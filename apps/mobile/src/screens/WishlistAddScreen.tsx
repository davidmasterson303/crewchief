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
} from '@wellkept/core/wishlist-suggestions';
import { wishlistItemIdentifier, type WishlistItemType } from '@wellkept/core/wishlist-identifier';
import {
  FIELD_FONT_MIN,
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
        /*
          ── ⚠ MOB-08 · a server 401 is not "you are signed out" ─────────────

          This forced a sign-out on **any** 401 and then `return`ed without
          setting a state — which is only safe if `onSignOut()` unmounts the
          screen, and it does not when the network call was the thing that
          failed. Result: offline with an expired token, this screen shows
          skeletons **forever** — no error, no retry, nothing to pull.

          `isLocallySignedOut` is the distinction the client already goes to
          trouble to make, with a docblock recording that a real tester hit this
          three times out of three on 5 Aug — and exactly **one** screen
          consumed it. A `device` 401 is genuinely signed out; a `server` 401
          may be a token the server would accept a second later, and destroying
          a working session over one response is how a spurious failure becomes
          a forced re-login.

          Falls through to the error state either way, so there is always
          something on screen and something to press.
        */
      if (error instanceof ApiRequestError && error.isLocallySignedOut) {
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
        /*
          ── ⚠ MOB-08 · a server 401 is not "you are signed out" ─────────────

          This forced a sign-out on **any** 401 and then `return`ed without
          setting a state — which is only safe if `onSignOut()` unmounts the
          screen, and it does not when the network call was the thing that
          failed. Result: offline with an expired token, this screen shows
          skeletons **forever** — no error, no retry, nothing to pull.

          `isLocallySignedOut` is the distinction the client already goes to
          trouble to make, with a docblock recording that a real tester hit this
          three times out of three on 5 Aug — and exactly **one** screen
          consumed it. A `device` 401 is genuinely signed out; a `server` 401
          may be a token the server would accept a second later, and destroying
          a working session over one response is how a spurious failure becomes
          a forced re-login.

          Falls through to the error state either way, so there is always
          something on screen and something to press.
        */
        if (error instanceof ApiRequestError && error.isLocallySignedOut) {
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
  const typed = query.trim();

  const shown = useMemo(
    () => (state.kind === 'loaded' ? filterSuggestions(query, state.suggestions) : []),
    [state, query]
  );

  const exactMatch = shown.some(
    (suggestion) => suggestion.name.toLowerCase() === typed.toLowerCase()
  );

  /**
   * The list, in sections — R40.
   *
   * ⚠ **Only when nothing is typed.** A filtered set is a search result, not a
   * plan: splitting three matches under two headers is furniture, and the
   * matching count in the label is the useful thing there.
   *
   * A section is omitted when empty rather than rendered with nothing under it,
   * so a car with no urgent work shows one list rather than an empty promise.
   */
  const groups = useMemo(() => {
    if (typed) return [{ label: `${shown.length} matching`, rows: shown }];

    const urgent = shown.filter((suggestion) => suggestion.urgent);
    const rest = shown.filter((suggestion) => !suggestion.urgent);

    return [
      { label: 'Do first', rows: urgent },
      { label: urgent.length > 0 ? 'Everything else' : 'Suggested for this car', rows: rest },
    ].filter((group) => group.rows.length > 0);
  }, [shown, typed]);

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

  return (
    /*
      ── ⚠ The filter stays put ────────────────────────────────────────────────

      It scrolled away with the list, which is backwards for a control whose
      whole job is to shorten that list: by the time you have scrolled far
      enough to want it, it is off screen, and you scroll back up to reach the
      thing that would have saved you the scrolling.

      Outside the scroller rather than `stickyHeaderIndices`, deliberately.
      Sticky headers on a `ScrollView` with `keyboardShouldPersistTaps` behave
      inconsistently on Android when the keyboard resizes the frame, and this
      control is a text input — the one case where that matters most.
    */
    <View style={styles.screen}>
      {problem && <AlertBanner tone="critical" headline="That was not added" body={problem} />}

      {/* The filter. It is also the free-text field — see the header. */}
      <View style={[styles.search, styles.searchPinned]}>
        <Icon name="search" size={17} />
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          placeholder="Search suggestions"
          placeholderTextColor={text.muted}
          /*
            ⚠ **R38.** It read "Filter suggestions, or type something to add",
            which is the placeholder's two-jobs problem said out loud. Filtering
            an existing list and authoring a new item are different verbs with
            different results, and one name cannot signal which is about to
            happen.

            The field searches. Authoring is the block at the list's foot, which
            appears with its own lead sentence and its own button — a visible
            affordance rather than a hint inside a field.
          */
          accessibilityLabel="Search suggestions"
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

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
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

      {/*
        ── R40 · urgency is where the row sits, not a word on every row ───────

        `suggestionsFor` sorts urgent-first, so "Do first" appeared on every row
        of the first screenful and told the reader nothing they could not see
        from the order. The order still does the work; the section header names
        it once, and the chip goes back to saying what kind of thing the row is.

        Not split while filtering. A search result set is not a plan, and two
        headers over two matches is furniture.
      */}
      {groups.map(({ label, rows }) => (
        <ListGroup key={label} label={label}>
          {rows.map((suggestion, index) => {
            const added = state.onList.has(suggestion.identifier);
            const working = busy === suggestion.identifier;

            return (
              <View
                key={suggestion.identifier}
                style={[styles.row, index < rows.length - 1 && styles.divided]}
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

                {/*
                  ── R41 · two lines, and then the row stops ────────────────

                  The reason is research prose and runs to whatever length the
                  model wrote. Uncapped, the last row on screen ended mid-
                  sentence at the fold with no ellipsis, which reads as a
                  rendering fault rather than as more text below.

                  Two lines is enough to say what the part is and why it
                  matters; the whole of it is what "Learn more" is for.
                */}
                <Text style={styles.reason} numberOfLines={2}>
                  {suggestion.reason}
                </Text>
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
                      /*
                        ── R39 · one control per row ─────────────────────────

                        `Add` and `Learn more` were `outline` and `ghost`, which
                        read as two equal buttons repeated down the list — so no
                        row had a primary and the eye had nothing to land on.

                        `quiet` is a fill; `ghost` is not. That is an
                        unambiguous step rather than two borders of different
                        weights, and it costs nothing on the row that has
                        already been added, where the control is replaced by its
                        state.

                        ⚠ The card itself is deliberately **not** the affordance,
                        which is what the pattern would normally ask for. There
                        is no suggestion detail screen; the only thing a row
                        could navigate to is the advisor, and that spends a model
                        call. A whole-card tap target that costs money on a
                        mis-scroll is the wrong trade.
                      */
                      variant="quiet"
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
      ))}

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
            variant="primary"
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
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: surface.page },
  body: { padding: space.lg, gap: space.lg, paddingBottom: space.h2 },
  /* Pinned above the scroller, on the page's own surface so nothing shows through. */
  searchPinned: {
    marginHorizontal: space.lg,
    marginTop: space.lg,
    marginBottom: space.sm,
  },
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
  /* Figures — "Typically 60,000 – 100,000 miles", "Every 10,000 mi". R11. */
  note: { ...type.label, letterSpacing: 0, color: text.muted, ...TABULAR },

  actions: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xs },
  action: { flexShrink: 1 },
  addedRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: TARGET_MIN },
  addedText: { ...type.uiStrong, color: text.secondary },

  own: { gap: space.sm },
  ownLead: { ...type.value, color: text.muted, lineHeight: 19 },
  empty: { ...type.body, color: text.secondary },
});
