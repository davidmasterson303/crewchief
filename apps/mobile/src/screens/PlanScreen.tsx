import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import Segmented from '../components/Segmented';
import { BuildScreen } from './BuildScreen';
import { WishlistScreen } from './WishlistScreen';
import { PAGE_BODY, space, surface } from '../theme';

export type PlanSegment = 'needs' | 'mods';

/**
 * Plan: what this car needs, and what you want to do to it.
 *
 * ── ⚠ R15 · one question, split across two hub rows ─────────────────────────
 *
 * `Wishlist` and `Build` both answer *"what should I do to this car next"*.
 * Both are ordered lists of jobs with chips, both have a suggestions source and
 * a user-added path, and the only difference is that one is **needs** and the
 * other is **wants**.
 *
 * Splitting them across two destinations made the owner classify a job before
 * they could look for it — and the review's example is exact: a **charge pipe**
 * on an M235i is genuinely both. It is a known failure point and it is the
 * first thing anyone modifies. Under two lists it is filed wrong half the time
 * and then cannot be found.
 *
 * ── What stays on which side ────────────────────────────────────────────────
 *
 * The **progression ladder stays on `Mods`**, because it is specific to mods:
 * "control before more power" is advice about modifying, not about maintenance.
 * The build dial goes with it and reports that segment.
 *
 * ⚠ `Mods` is shown only when the owner has not answered "stock" — the same
 * `showsModifications` gate the hub row had. A person who told us they are not
 * modifying the car should not be offered a segment about modifying it, and a
 * one-segment control is not a control.
 */
export function PlanScreen({
  vehicleId,
  title,
  showsMods,
  initialSegment = 'needs',
  onSignOut,
  onAdd,
}: {
  vehicleId: string;
  title?: string;
  /** `showsModifications(vehicle.performance_mindedness)`, decided by the hub. */
  showsMods: boolean;
  initialSegment?: PlanSegment;
  onSignOut: () => void;
  /** Opens the suggestions catalogue, which writes to `Needs`. */
  onAdd: () => void;
}) {
  const [segment, setSegment] = useState<PlanSegment>(showsMods ? initialSegment : 'needs');

  return (
    <View style={styles.screen}>
      {showsMods ? (
        <View style={styles.switcher}>
          <Segmented
            accessibilityLabel="Plan"
            value={segment}
            onChange={setSegment}
            options={[
              { value: 'needs', label: 'Needs' },
              { value: 'mods', label: 'Mods' },
            ]}
          />
        </View>
      ) : null}

      {segment === 'mods' && showsMods ? (
        <BuildScreen
          vehicleId={vehicleId}
          title={title}
          onSignOut={onSignOut}
          /*
            The build screen's own "add" led to the wishlist as a separate
            destination. Inside one screen it is a segment switch, which is the
            merge doing its job — the two lists are no longer places.
          */
          onOpenWishlist={() => setSegment('needs')}
        />
      ) : (
        <WishlistScreen vehicleId={vehicleId} onSignOut={onSignOut} onAdd={onAdd} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: surface.page },
  switcher: {
    paddingHorizontal: PAGE_BODY.paddingHorizontal,
    paddingTop: space.md,
    paddingBottom: space.sm,
  },
});
