import { useCallback, useEffect, useState } from 'react';
import { useRefetchOnFocus } from '../navigation/useRefetchOnFocus';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import AlertBanner from '../components/AlertBanner';
import { adviceDisclosure } from '@crewchief/core/advice-disclosure';
import BuildGauge from '../components/BuildGauge';
import Button from '../components/Button';
import Card from '../components/Card';
import Chip from '../components/Chip';
import ProgressionLadder from '../components/ProgressionLadder';
import SectionHeader from '../components/SectionHeader';
import { Skeleton, SkeletonCard } from '../components/Skeleton';
import { apiRequest, ApiRequestError } from '../api/client';
import { buildPosition } from '@crewchief/core/build-progress';
import {
  nextRungs,
  progressionSummary,
  roleLabel,
  showsModifications,
  type ModCandidate,
  type ModRung,
} from '@crewchief/core/mod-progression';
import { wishlistItemIdentifier } from '@crewchief/core/wishlist-identifier';
import { declineMod, declinedMods, restoreMod } from '../onboarding/declined-mods';
import { TARGET_MIN, border, radius, space, surface, text, type } from '../theme';

/**
 * The build, on a screen of its own.
 *
 * ── What this replaces, and why moving it was the fix ───────────────────────
 *
 * A "Build" card on `VehicleDetailScreen`: a 104pt dial reading Stock, and
 * `<ProgressionLadder next={rungs[0].role} />` — the five-rung scale with a
 * marker on one of them. David's note on 23 Aug was exact:
 *
 *   *"the 'build' component has absolutely no utility, I don't know what it's
 *   there for. You can't tap in for details, you can't view a list and add
 *   things to a wishlist, you can't reject/decline from the plan. It's big and
 *   confusing right now."*
 *
 * ⚠ **Every one of those was already computed and thrown away.** `nextRungs`
 * returns `{ name, purpose, difficulty, role, rationale }` for each suggestion
 * — the part, what it does, how hard it is, and the sentence explaining why it
 * comes before the others. The card read `rungs[0].role` and discarded the rest,
 * so a screen carrying three named recommendations rendered the word
 * "Foundation" and nothing else. It was not a component missing a feature; it
 * was a component showing 1/5th of what it had been handed.
 *
 * The design system says the same thing from the other side —
 * `specs/progression-ladder.spec.html` draws exactly these rows, with the role,
 * the difficulty and the sentence: *"a ladder, not a catalogue"*.
 *
 * ── Why a route rather than a bigger card ───────────────────────────────────
 *
 * David's call, and it is the right one: three suggestions each needing a name,
 * two chips, a sentence of reasoning and two controls do not fit under a dial
 * on a screen whose job is to summarise a car. The vehicle screen keeps one row
 * naming the zone; everything that can be *done* about a build lives here.
 *
 * ── Cold start is the normal case ───────────────────────────────────────────
 *
 * `modification_tracking` is empty across the entire product — re-confirmed
 * against the live database on 23 Aug. So `completed` is `[]`, every car reads
 * Stock, and the dial sits at rest. That is the honest state, and the ladder is
 * built for it: with no history the first step genuinely is the first step.
 *
 * ⚠ A resting dial is **not** a bad reading, and nothing here may colour it as
 * one. `build-progress.ts` owns a separate ramp from the health band for
 * exactly this reason — a stock car is not a failing car.
 */

interface KnowledgeResponse {
  vehicle?: {
    year?: number | null;
    make?: string | null;
    model?: string | null;
    performance_mindedness?: string | null;
  };
  knowledge?: { common_mods?: unknown } | null;
}

interface WishlistResponse {
  wishlistItems?: Array<{ item_identifier?: string | null }> | null;
}

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'gone' }
  | {
      kind: 'loaded';
      name: string;
      /** `false` when the owner answered "not for me" in onboarding. */
      shows: boolean;
      /*
        The owner's own answer, carried rather than assumed. `nextRungs` reads
        it — `'stock'` returns nothing at all — and passing a literal here would
        be this screen holding a second opinion about a question the owner
        already answered.
      */
      mindedness: string | null;
      mods: ModCandidate[];
      /** Identifiers already on the wishlist, so a row can say "Added". */
      onWishlist: Set<string>;
    };

/** Three at a glance; the rest behind one tap. `nextRungs` defaults to 3. */
const FIRST_STEPS = 3;
const ALL_STEPS = 24;

function readMods(value: unknown): ModCandidate[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((row) => {
    const mod = row as { name?: unknown; purpose?: unknown; difficulty?: unknown };
    if (typeof mod?.name !== 'string' || !mod.name.trim()) return [];

    return [
      {
        name: mod.name.trim(),
        purpose: typeof mod.purpose === 'string' ? mod.purpose : undefined,
        difficulty: typeof mod.difficulty === 'string' ? mod.difficulty : undefined,
      },
    ];
  });
}

export function BuildScreen({
  vehicleId,
  title,
  onSignOut,
  onOpenWishlist,
}: {
  vehicleId: string;
  title?: string;
  onSignOut: () => void;
  onOpenWishlist: () => void;
}) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  const [declined, setDeclined] = useState<string[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [busyMod, setBusyMod] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setState({ kind: 'loading' });

      setActionError(null);

      try {
        /*
          The wishlist is fetched alongside the dossier, and a failure of the
          second does not fail the screen. Same shape as the recall screen: the
          suggestions are the content, "already added" is a label on them, and
          losing the label must not cost the list.
        */
        const [vehicleResult, wishlistResult] = await Promise.allSettled([
          apiRequest<KnowledgeResponse>(`/load-vehicle?vehicleId=${encodeURIComponent(vehicleId)}`),
          apiRequest<WishlistResponse>(`/wishlist?vehicleId=${encodeURIComponent(vehicleId)}`),
        ]);

        if (vehicleResult.status === 'rejected') throw vehicleResult.reason;

        const vehicle = vehicleResult.value.vehicle;
        const onWishlist = new Set(
          wishlistResult.status === 'fulfilled'
            ? (wishlistResult.value.wishlistItems ?? []).flatMap((item) =>
                typeof item?.item_identifier === 'string' ? [item.item_identifier] : []
              )
            : []
        );

        setState({
          kind: 'loaded',
          name:
            [vehicle?.year, vehicle?.make, vehicle?.model].filter(Boolean).join(' ') ||
            title ||
            'this car',
          shows: showsModifications(vehicle?.performance_mindedness),
          mindedness: vehicle?.performance_mindedness ?? null,
          mods: readMods(vehicleResult.value.knowledge?.common_mods),
          onWishlist,
        });

        setDeclined(await declinedMods(vehicleId));
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
        if (error instanceof ApiRequestError && error.status === 404) {
          setState({ kind: 'gone' });
          return;
        }
        setState({
          kind: 'error',
          message: error instanceof Error ? error.message : 'Could not load this build',
        });
      } finally {
        setRefreshing(false);
      }
    },
    [vehicleId, title, onSignOut]
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

  /**
   * Put a suggestion on the wishlist.
   *
   * ⚠ The identifier comes from `wishlistItemIdentifier` and nothing else.
   * `wishlist-identifier.ts` records what a fourth format costs: the table
   * dedupes on `(vehicle_id, item_identifier)`, so a locally-invented key
   * produces a duplicate row, an "Add" button that never turns into "Added",
   * and a delete that silently matches nothing.
   */
  const addToWishlist = useCallback(
    async (rung: ModRung) => {
      const identifier = wishlistItemIdentifier('modification', rung.name);

      setActionError(null);
      setBusyMod(rung.name);

      try {
        await apiRequest('/wishlist', {
          method: 'POST',
          body: {
            vehicleId,
            itemType: 'modification',
            itemName: rung.name,
            itemIdentifier: identifier,
            /*
              The rationale travels with the item, not just the part name. A
              wishlist row reading "Whiteline sway bars" six weeks later has
              lost the only thing that made it a recommendation rather than a
              shopping list — "worth doing before more power, not after".
            */
            description: rung.purpose || rung.rationale,
            category: roleLabel(rung.role),
            source: 'progression-ladder',
          },
        });

        setState((held) =>
          held.kind === 'loaded'
            ? { ...held, onWishlist: new Set([...held.onWishlist, identifier]) }
            : held
        );
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
          409 is the dedupe working, not a failure — the same reading
          `WishlistScreen` takes. The item is on the list, which is what the
          person wanted, so the row flips to "On the wishlist" rather than
          showing an error about a state they already have.
        */
        if (error instanceof ApiRequestError && error.status === 409) {
          setState((held) =>
            held.kind === 'loaded'
              ? { ...held, onWishlist: new Set([...held.onWishlist, identifier]) }
              : held
          );
          return;
        }
        setActionError(
          error instanceof Error ? error.message : 'That could not be added. Try again.'
        );
      } finally {
        setBusyMod(null);
      }
    },
    [vehicleId, onSignOut]
  );

  if (state.kind === 'loading') {
    return (
      <ScrollView contentContainerStyle={styles.body}>
        <Skeleton height={180} />
        <SkeletonCard lines={3} />
        <SkeletonCard lines={3} />
      </ScrollView>
    );
  }

  if (state.kind === 'gone') {
    return (
      <View style={styles.centre}>
        <Text style={styles.errorTitle}>This vehicle is no longer here</Text>
        <Text style={styles.errorBody}>It may have been removed from another device.</Text>
      </View>
    );
  }

  if (state.kind === 'error') {
    return (
      <View style={styles.centre}>
        <Text style={styles.errorTitle}>Could not load this build</Text>
        <Text style={styles.errorBody}>{state.message}</Text>
        <Button label="Try again" variant="outline" onPress={() => void load()} />
      </View>
    );
  }

  /*
    ⚠ `completed` is `[]` and that is not a placeholder — `modification_tracking`
    holds no rows anywhere in this product, verified against the live database
    rather than read off the migrations folder. Every car is Stock, the dial
    rests, and the ladder starts at the first rung. See the header.
  */
  const completed: string[] = [];
  const position = buildPosition([]);

  const available = state.mods.filter(
    (mod) => !declined.some((name) => name.trim().toLowerCase() === mod.name.trim().toLowerCase())
  );
  const rungs = state.shows
    ? nextRungs({
        mods: available,
        completed,
        mindedness: state.mindedness,
        limit: showAll ? ALL_STEPS : FIRST_STEPS,
      })
    : [];

  const more = state.shows && !showAll && available.length > rungs.length;

  return (
    <ScrollView
      contentContainerStyle={styles.body}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void load(true)}
          tintColor={text.muted}
        />
      }
    >
      {actionError && (
        <AlertBanner tone="critical" headline="That was not saved" body={actionError} />
      )}

      {/*
        The instrument, and it is a reading rather than a score.

        `position.label` is the zone in words — "Stock", "Lightly modified" —
        and it sits under the needle for the same reason the health band's
        verdict does: a number with no word beside it invites the reader to
        supply their own judgement, and the judgement for a stock car is
        *nothing is wrong*.

        ⚠ **The zone is drawn once, by the gauge (R42).** This card used to
        render `position.label` again directly under `BuildGauge`'s own caption,
        so the screen read `Stock` above `Stock` — which looks like a label row
        whose label has been filled in with its value. The gauge owns its
        readout; this card owns the sentence under it.
      */}
      <Card>
        <View style={styles.dial}>
          <BuildGauge position={position} />
        </View>
        <Text style={styles.summary}>{progressionSummary(rungs, completed)}</Text>
        {/*
          ── ⚠ UX-16 / D11 · the mods are generated and this screen never said ─

          The ladder's ordering is the product's own argument and is not
          generated — `ROLE_LADDER` is a constant. Everything placed *on* it is:
          the mod list, each rationale, and the details card behind every row
          come from a model.

          Under the summary rather than under the gauge, because it qualifies
          the suggestion rather than the position — the position is arithmetic
          over what the owner has actually recorded, and disclaiming that as
          AI-written would be false in the unhelpful direction.

          `ModificationsTab.tsx` renders the identical string on the web. That
          is the point: a disclosure present on one client and absent from the
          other is this codebase's most repeated defect applied to the sentence
          that limits liability.
        */}
        <Text style={styles.disclosure}>{adviceDisclosure('plan')}</Text>
      </Card>

      {state.shows ? (
        <>
          {/*
            The scale the parts are placed on, above the parts themselves.
            `ROLE_LADDER`'s order is the product's actual argument — control
            before more power is the one piece of sequencing advice with a
            consequence attached, and the one a shop will not volunteer while
            selling a tune.
          */}
          <Card>
            {/*
              §6 / R58. It was "The order things go in", which is charming and
              is a **sentence** in a slot built for a noun — the label row is
              12px, 600, uppercased, and every other one in the app names a
              thing. "ORDER OF WORK" says the same and fits the slot.
            */}
            <SectionHeader title="Order of work" />
            <ProgressionLadder next={rungs[0]?.role} />
          </Card>

          {/*
            ── ⚠ R46 · never interpolate a car into an uppercased label ──────

            This was `Next steps for ${state.name}`, and `SectionHeader`
            uppercases — so it rendered **`NEXT STEPS FOR 2015 BMW M235I`**.
            `M235i` is a model designation and the lower-case `i` is part of the
            name, not a typographic accident; uppercasing it produces a car that
            does not exist.

            The car is the screen's context and the nav already carries it, so
            the label does not need it at all. `lib/__tests__/mobile-section-labels.test.ts`
            keeps every label in this app a literal, which is the mechanical
            version of the rule.
          */}
          <SectionHeader title="Next steps" />

          {rungs.length === 0 ? (
            <Card>
              <Text style={styles.empty}>
                {state.mods.length === 0
                  ? /*
                      Nothing known, rather than nothing to do. The knowledge
                      base fills in a few seconds after a car is added, and a
                      screen that says "no suggestions" about a lookup that has
                      not run is the recall screen's 21 Aug defect in another
                      place.
                    */
                    'We have not worked out what suits this car yet. That fills in shortly after a car is added — pull down in a minute.'
                  : 'You have said no to everything we had. Anything you dismissed is below.'}
              </Text>
            </Card>
          ) : (
            rungs.map((rung) => {
              const identifier = wishlistItemIdentifier('modification', rung.name);
              const added = state.onWishlist.has(identifier);
              const working = busyMod === rung.name;

              return (
                <Card key={rung.name}>
                  <Text style={styles.rungName}>{rung.name}</Text>

                  <View style={styles.chips}>
                    {/*
                      ⚠ Neutral chips. The roles are positions on a ladder, not
                      severities — the wishlist spec makes the same point:
                      "semantic colour does semantic work only". An amber
                      "Durability" chip would read as a warning about the car.
                    */}
                    <Chip label={roleLabel(rung.role)} />
                    <Chip label={rung.difficulty} />
                  </View>

                  {/*
                    The reasoning, and it is the actual product. A recommendation
                    with no visible argument is a black box, and this product's
                    whole position is that it is not one.
                  */}
                  <Text style={styles.rationale}>{rung.rationale}</Text>
                  {rung.purpose ? <Text style={styles.purpose}>{rung.purpose}</Text> : null}

                  <View style={styles.actions}>
                    {added ? (
                      <Button
                        label="On the wishlist"
                        variant="outline"
                        onPress={onOpenWishlist}
                        style={styles.action}
                      />
                    ) : (
                      <Button
                        label="Add to wishlist"
                        variant="outline"
                        busy={working}
                        onPress={() => void addToWishlist(rung)}
                        style={styles.action}
                      />
                    )}
                    <Pressable
                      onPress={() =>
                        void declineMod(vehicleId, rung.name).then(setDeclined)
                      }
                      accessibilityRole="button"
                      accessibilityLabel={`Not interested in ${rung.name}`}
                      style={({ pressed }) => [styles.decline, pressed && styles.declinePressed]}
                    >
                      <Text style={styles.declineText}>Not for me</Text>
                    </Pressable>
                  </View>
                </Card>
              );
            })
          )}

          {more && (
            <Button
              label="Show everything we know about"
              variant="outline"
              onPress={() => setShowAll(true)}
            />
          )}

          {/*
            ── Dismissed, and reachable ────────────────────────────────────────

            ⚠ Listed rather than gone. A decline that vanishes without trace is
            a decision somebody cannot revisit, and the ladder has no ceiling by
            design — `tierCeiling` was removed for hard-coding a finish line
            nobody drew, and a permanent invisible dismissal would put one back
            a row at a time.
          */}
          {declined.length > 0 && (
            <Card>
              <SectionHeader title="You said no to these" />
              {declined.map((name) => (
                <View key={name} style={styles.declinedRow}>
                  <Text style={styles.declinedName} numberOfLines={1}>
                    {name}
                  </Text>
                  <Pressable
                    onPress={() => void restoreMod(vehicleId, name).then(setDeclined)}
                    accessibilityRole="button"
                    accessibilityLabel={`Put ${name} back in the list`}
                    style={({ pressed }) => [styles.decline, pressed && styles.declinePressed]}
                  >
                    <Text style={styles.declineText}>Put back</Text>
                  </Pressable>
                </View>
              ))}
              <Text style={styles.footnote}>
                Kept on this phone only. Signing in elsewhere shows them again.
              </Text>
            </Card>
          )}
        </>
      ) : (
        /*
          The one genuine off switch, and it is "not now" rather than "never".
          `showsModifications` reads the owner's own onboarding answer, and the
          way back has to be visible — an irreversible sixty-second answer is a
          trap, which is the same argument the register switch makes.
        */
        <Card>
          <SectionHeader title="Modifications are turned off" />
          <Text style={styles.empty}>
            You said modifications were not for you when you added this car. Nothing here is
            hidden permanently — turn them back on and we will start with the sensible first
            steps for {state.name}.
          </Text>
        </Card>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.xl, gap: space.lg, paddingBottom: space.h2 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxl, gap: space.sm },
  errorTitle: { ...type.title, color: text.primary },
  errorBody: { ...type.body, color: text.muted, textAlign: 'center' },

  dial: { alignItems: 'center' },
  summary: { ...type.body, color: text.secondary, textAlign: 'center' },

  rungName: { ...type.bodyStrong, color: text.primary },
  chips: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  rationale: { ...type.body, color: text.secondary },
  /* One step quieter than the rationale: the part's own description is context,
     the rationale is the recommendation. */
  purpose: { ...type.value, color: text.muted },

  actions: { flexDirection: 'row', gap: space.sm, alignItems: 'stretch' },
  action: { flex: 1 },
  decline: {
    minHeight: TARGET_MIN,
    paddingHorizontal: space.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.button,
    borderWidth: 1,
    borderColor: border.field,
  },
  declinePressed: { backgroundColor: surface.raised },
  declineText: { ...type.uiStrong, color: text.secondary },

  declinedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    paddingVertical: space.sm,
  },
  declinedName: { ...type.ui, color: text.muted, flex: 1 },

  empty: { ...type.body, color: text.secondary },
  footnote: { ...type.value, color: text.muted },
  /** Same quiet role as the footnote; a caveat must not compete with the list. */
  disclosure: { ...type.value, color: text.muted, marginTop: space.sm },
});
