import { useContext, useEffect } from 'react';
import { NavigationContext } from '@react-navigation/native';

/**
 * Re-run a screen's load whenever it comes back into view.
 *
 * ── ⚠ MOB-09 · every write was invisible on the screen behind it ────────────
 *
 * Nothing in this app refetched on focus. Every screen loaded once on mount and
 * then kept whatever it had, so:
 *
 *   - Add something on the wishlist catalogue, go back — the list behind it is
 *     unchanged.
 *   - Mark a recall repaired, go back to the car — the banner still says it is
 *     open.
 *   - Confirm the odometer on `Service → Due`, go back — the hero still reads
 *     the old mileage.
 *   - Scan an invoice, go back — the service count has not moved.
 *
 * Each of those is a write that succeeded followed by a screen saying it did
 * not. `RootNavigator`'s own comment — *"the list behind this refetches on
 * focus, so adding does not pop back"* — described a behaviour the app did not
 * have.
 *
 * ── ⚠ Why this is not `useFocusEffect` ──────────────────────────────────────
 *
 * `useFocusEffect` calls `useNavigation`, which **throws** outside a navigator:
 * *"Couldn't find a navigation object."* Every screen suite in this app mounts
 * its screen directly — that is the whole point of the prop-injection seam
 * these components are built around — so adopting it would have meant wrapping
 * twenty-six suites in a `NavigationContainer` to test a refetch none of them
 * are about.
 *
 * Worse, it would make the failure mode "a screen crashes when rendered outside
 * a navigator", which is a thing this app should not do regardless.
 *
 * `NavigationContext` read directly returns `undefined` outside a navigator, so
 * the subscription is simply not made and the screen behaves exactly as it did
 * before. The hook order is unconditional either way.
 */
export function useRefetchOnFocus(
  reload: () => void,
  { enabled = true }: { enabled?: boolean } = {}
) {
  const navigation = useContext(NavigationContext);

  useEffect(() => {
    if (!enabled || !navigation) return;

    /*
      ⚠ `focus`, not `state`. `state` fires for every navigation anywhere in the
      tree, so a screen three deep would refetch each time something above it
      moved — which is the runaway version of this fix.

      The listener is added rather than the effect firing on mount: every caller
      already loads in its own mount effect, and doing it twice on open is a
      duplicated GET for nothing.
    */
    return navigation.addListener('focus', reload);
  }, [navigation, reload, enabled]);
}
