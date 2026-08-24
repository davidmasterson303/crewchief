/**
 * Account deletion is reachable from everywhere, by construction.
 *
 * @jest-environment node
 *
 * App Store guideline **5.1.1(v)** requires account deletion to be initiated
 * from inside the reviewed app and to be genuinely available.
 *
 * ── What this used to check, and why it stopped being the right question ────
 *
 * Until 23 Aug the account was a modal owned by `GarageScreen`, and this file
 * checked that **every return path of that component** rendered it. It had to:
 * loading and error `return`ed before the header, so both drew a bare centred
 * box with no way into the account at all — putting deletion behind the API
 * being up, for exactly the person most likely to be leaving.
 *
 * That guarantee was held together by vigilance. **R13 replaced it with a
 * structure**: the account is a tab, the bar is a sibling of the navigator
 * rather than a child of any screen, and no early return inside a screen can
 * take it away.
 *
 * ── So what is checked here now ─────────────────────────────────────────────
 *
 * Three structural facts, all of which a refactor could quietly undo:
 *
 *   1. The navigator registers an `Account` route.
 *   2. `TabBar` is rendered **outside** `Stack.Navigator`, not inside a screen.
 *   3. The bar offers `Account` as one of its destinations.
 *
 * `apps/mobile/src/navigation/__tests__/TabBar.test.tsx` covers the control
 * itself — that it is named, that it announces its selected state, and that it
 * is reachable from its own position. This file covers the wiring that keeps it
 * where a screen cannot swallow it.
 *
 * ── Why a source scan ───────────────────────────────────────────────────────
 *
 * Same reasoning as `mobile-api-only.test.ts`: no React Native runtime, no
 * jest-expo, no second toolchain, so it runs on every `npm test` from the repo
 * root rather than from whenever a mobile runner is configured. It is a weaker
 * check than mounting the navigator, and a weaker check that runs beats a
 * stronger one that does not exist.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MOBILE_SCREENS = join(__dirname, '..', '..', 'apps', 'mobile', 'src', 'screens');
const GARAGE = join(MOBILE_SCREENS, 'GarageScreen.tsx');
const ACCOUNT = join(MOBILE_SCREENS, 'AccountScreen.tsx');

const NAVIGATION = join(__dirname, '..', '..', 'apps', 'mobile', 'src', 'navigation');
const NAVIGATOR = join(NAVIGATION, 'RootNavigator.tsx');
const TAB_BAR = join(NAVIGATION, 'TabBar.tsx');

const navigator = readFileSync(NAVIGATOR, 'utf8');
const tabBar = readFileSync(TAB_BAR, 'utf8');

describe('App Store 5.1.1(v) — the account is a destination', () => {
  it('registers an Account route', () => {
    expect(navigator).toMatch(/<Stack\.Screen name="Account"/);
    expect(navigator).toMatch(/Account: undefined;/);
  });

  it('renders the bar outside the navigator, where no screen can swallow it', () => {
    /*
      ⚠ **The whole structural claim, in one assertion.** The five cases this
      file used to carry existed because the account lived *inside* a screen and
      an early return could take it away. What replaces them is position: if
      `<TabBar` ever moves inside `<Stack.Navigator>`, it becomes a screen's
      child again and the old failure mode comes back with it.
    */
    const navigatorClose = navigator.indexOf('</Stack.Navigator>');
    const barAt = navigator.indexOf('<TabBar');

    expect(navigatorClose).toBeGreaterThan(-1);
    expect(barAt).toBeGreaterThan(navigatorClose);
  });

  it('offers Account on the bar', () => {
    // The route existing is not the same as there being a way to reach it.
    expect(tabBar).toMatch(/name: 'Account'/);
  });

  it('can still detect the bar being moved inside', () => {
    /*
      Rule 5's other half, against a source shaped like the real one. Without
      it, the ordering assertion above passes on any file that happens not to
      contain `<TabBar` at all.
    */
    const moved = `
      <Stack.Navigator>
        <TabBar current="Garage" />
      </Stack.Navigator>
    `;

    expect(moved.indexOf('<TabBar')).toBeLessThan(moved.indexOf('</Stack.Navigator>'));
  });
});

describe('the dev token', () => {
  it('keeps the token affordance out of release builds', () => {
    const source = readFileSync(ACCOUNT, 'utf8');

    /*
      Unrelated to 5.1.1(v) and guarded beside it because it is the same class
      of mistake, and this is where a change to the account surface gets read.
      `DevToken` renders a live bearer token — a password for the API until it
      expires — and it must compile out of a shipping build. Removing the
      `__DEV__` gate would print a credential in the App Store binary.

      ⚠ It moved here from `GarageScreen` on 23 Aug: the gate was never missing,
      but the block sat at the foot of the **home screen**, which is the first
      thing a user and a reviewer see. `keeps it off the garage` below is the
      half of this that the move added.
    */
    const start = source.indexOf('function DevToken(');
    expect(start).toBeGreaterThan(-1);

    const dev = source.slice(start);
    expect(dev.slice(0, dev.indexOf('\n}'))).toMatch(/if \(!__DEV__\) return null;/);
  });

  it('keeps the token affordance off the garage', () => {
    /*
      The token block is a dev affordance, and where a dev affordance lives is
      still a decision about that screen. On the garage it was the last element
      of the product's front page in every capture taken for review.

      Asserted as absence, which is a weak shape of test — so it is paired with
      the presence check above. Both have to hold: gone from here, and gated
      there.
    */
    expect(readFileSync(GARAGE, 'utf8')).not.toMatch(/DevToken/);
  });
});
