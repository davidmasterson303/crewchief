/**
 * A write behind a screen is visible when you come back to it.
 *
 * @jest-environment node
 *
 * ── ⚠ MOB-09 ───────────────────────────────────────────────────────────────
 *
 * Nothing in the app refetched on focus. Every screen loaded once on mount and
 * kept whatever it had, so **every write was invisible on the screen behind
 * it**: adding to the wishlist, marking a recall repaired, confirming an
 * odometer, scanning an invoice — each succeeded and then returned to a screen
 * that said it had not.
 *
 * `RootNavigator`'s own comment described a behaviour the app did not have:
 * *"the list behind this refetches on focus, so adding does not pop back."*
 *
 * ── Why a source scan ───────────────────────────────────────────────────────
 *
 * The behaviour needs a real navigator and a real focus event, and these
 * screens are deliberately mounted directly in their own suites — the
 * prop-injection seam exists so they can be. What regressed is structural: a
 * screen that loads on mount and does not subscribe to focus. That is on disk.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SCREENS = join(__dirname, '..', '..', 'apps', 'mobile', 'src', 'screens');

/**
 * Screens whose content can be changed from somewhere else in the app.
 *
 * ⚠ Not every screen: `SignInScreen`, `PaywallScreen` and `AddVehicleScreen`
 * have nothing behind them to go stale, and subscribing them to focus would be
 * a request per navigation for no reason. This list is the set where a **write
 * elsewhere changes what is rendered here**.
 */
const MUST_REFETCH = [
  'VehicleDetailScreen',
  'WishlistScreen',
  'ServiceHistoryScreen',
  'RecallDetailScreen',
  'HealthScreen',
  'BuildScreen',
];

describe('screens whose data can change while they are backgrounded', () => {
  it.each(MUST_REFETCH)('%s refetches when it comes back into view', (screen) => {
    const source = readFileSync(join(SCREENS, `${screen}.tsx`), 'utf8');

    expect(source).toMatch(/useRefetchOnFocus\(/);
  });

  it('each one still loads on mount, so the hook is an addition not a swap', () => {
    /*
      The anti-vacuous half. A screen that dropped its mount effect and relied
      on focus alone would pass the check above and would render empty on a cold
      open — the focus listener is added *after* the first focus has already
      happened.
    */
    for (const screen of MUST_REFETCH) {
      const source = readFileSync(join(SCREENS, `${screen}.tsx`), 'utf8');

      expect([screen, /useEffect\(\(\) => \{\s*void load\(\);/.test(source)]).toEqual([
        screen,
        true,
      ]);
    }
  });

  it('the hook does not crash a screen rendered outside a navigator', () => {
    /*
      ⚠ `useFocusEffect` calls `useNavigation`, which **throws** outside a
      navigator. Every screen suite here mounts its screen directly — that is
      what the prop-injection seam is for — so the obvious implementation would
      have meant wrapping twenty-six suites in a `NavigationContainer` to test a
      refetch none of them are about.

      Reading `NavigationContext` returns `undefined` instead, and the
      subscription is simply not made.
    */
    const hook = readFileSync(
      join(__dirname, '..', '..', 'apps', 'mobile', 'src', 'navigation', 'useRefetchOnFocus.ts'),
      'utf8'
    );

    expect(hook).toMatch(/useContext\(NavigationContext\)/);
    expect(hook).toMatch(/if \(!enabled \|\| !navigation\) return;/);

    /*
      ⚠ Asserted against the **code**, not the whole file: the docblock above
      names `useFocusEffect` twice while explaining why it is not used, and a
      naive `not.toMatch` over the source is satisfied by its own documentation
      — which is `.tap-target-44` matching a comment six hundred lines above the
      rule.
    */
    const code = hook
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('*') && !line.trimStart().startsWith('/*'))
      .join('\n');

    expect(code).not.toMatch(/useFocusEffect/);
  });
});
