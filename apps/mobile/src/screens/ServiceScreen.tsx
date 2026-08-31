import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import Segmented from '../components/Segmented';
import { ServiceHistoryScreen } from './ServiceHistoryScreen';
import type { ServiceVisit } from '@wellkept/core/service-record';
import { ServiceMilestoneScreen } from './ServiceMilestoneScreen';
import { PAGE_BODY, space, surface } from '../theme';

export type ServiceSegment = 'due' | 'history';

/**
 * Service: what is due, and what has been done.
 *
 * ── ⚠ R14 · two hub rows were one question ──────────────────────────────────
 *
 * `Service due` and `Service history` were siblings on the vehicle hub, and the
 * v8.3 review's finding was that neither survives the question "which of these
 * do I open". They are the same subject seen from two ends: what this car has
 * had done, and what it needs next — and the second is computed **from** the
 * first, so a person comparing them was navigating between two screens to hold
 * one thought.
 *
 * `Service due` was also the review's example of a screen that should not
 * exist: one question, one field, one button, and 70% of the display empty
 * under it. §5's general rule came out of it — *no screen exists whose only
 * content is one question.*
 *
 * ── Why a container rather than a rewrite ───────────────────────────────────
 *
 * Both halves keep their own component, their own fetch and their own tests.
 * The merge is a **navigation** change — one destination instead of two — and
 * rewriting two working screens to make one route out of them would have
 * spent the risk on the part that was not broken.
 *
 * ⚠ The inactive segment is **unmounted**, not hidden. Each half loads on
 * mount, and keeping both alive would fire two requests for a screen the owner
 * has only asked one question of. Switching back re-fetches, which is also
 * the honest behaviour after marking something done on the other side.
 */
export function ServiceScreen({
  vehicleId,
  onScan,
  onOpenVisit,
  initialSegment = 'due',
  onSignOut,
}: {
  vehicleId: string;
  /**
   * Which side to open on.
   *
   * The hub's "Service" row opens `due` — what is coming is what a person
   * checks. A deep link from a notification about a filed invoice opens
   * `history`, because that is what it is about.
   */
  initialSegment?: ServiceSegment;
  onSignOut: () => void;
  /*
    ── 30 Aug · threaded through rather than reached for ─────────────────────

    The history segment gained two things it cannot do itself: start a scan, and
    open the visit behind a line. Both are navigation, and this screen is
    rendered by the navigator — so they arrive as callbacks for the same reason
    every other route transition in this tree does. A screen that imported
    `useNavigation` would also stop mounting in its own suite, which is what the
    prop-injection seam exists to prevent.
  */
  onScan: () => void;
  onOpenVisit: (visit: ServiceVisit) => void;
}) {
  const [segment, setSegment] = useState<ServiceSegment>(initialSegment);

  return (
    <View style={styles.screen}>
      <View style={styles.switcher}>
        <Segmented
          accessibilityLabel="Service"
          value={segment}
          onChange={setSegment}
          options={[
            { value: 'due', label: 'Due' },
            { value: 'history', label: 'History' },
          ]}
        />
      </View>

      {segment === 'due' ? (
        <ServiceMilestoneScreen vehicleId={vehicleId} onSignOut={onSignOut} />
      ) : (
        <ServiceHistoryScreen
          vehicleId={vehicleId}
          onScan={onScan}
          onOpenVisit={onOpenVisit}
          onSignOut={onSignOut}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: surface.page },
  /*
    Pinned above the content, on the page's own surface. Same rule as the
    history screen's search field: a control whose job is to change what is
    below it must not scroll away with what is below it.
  */
  switcher: {
    paddingHorizontal: PAGE_BODY.paddingHorizontal,
    paddingTop: space.md,
    paddingBottom: space.sm,
  },
});
