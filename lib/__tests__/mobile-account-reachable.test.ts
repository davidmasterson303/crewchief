/**
 * Account deletion is reachable in every state the garage can be in.
 *
 * @jest-environment node
 *
 * App Store guideline **5.1.1(v)** requires account deletion to be initiated
 * from inside the app. `AccountScreen` is deliberately one tap from the garage
 * — `GarageScreen`'s own docblock says "buried would be any number of taps
 * greater than one", because the garage is the only screen a signed-in user
 * sees.
 *
 * **The rule that was broken:** loading and error `return`ed before the header,
 * so both drew a bare centred box with no "Account" on it. That put deletion
 * behind the API being up. A reviewer testing on a bad connection — or anyone
 * whose session had just expired, which is precisely when someone is most
 * likely to be leaving — got a screen with no way into their account at all.
 *
 * It typechecked, every test passed, and it was invisible until the screen was
 * actually rendered in a failing state. So the guard is static: an early return
 * added to this component in six months must fail here rather than in review.
 *
 * ── Why a source scan and not a render test ─────────────────────────────────
 *
 * Same reasoning as `mobile-api-only.test.ts`: no React Native runtime, no
 * jest-expo, no second toolchain, so it runs on every `npm test` from today
 * rather than from whenever a mobile runner is configured. It is a weaker check
 * than mounting the component, and a weaker check that runs beats a stronger
 * one that does not exist.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const GARAGE = join(__dirname, '..', '..', 'apps', 'mobile', 'src', 'screens', 'GarageScreen.tsx');

/**
 * The body of `GarageScreen` itself, without the helper components above it.
 *
 * `VehicleCard` and `DevToken` also contain `return (` and must not be held to
 * this rule — a vehicle card has no business rendering an account modal.
 */
function garageComponentBody(): string {
  const source = readFileSync(GARAGE, 'utf8');
  const start = source.indexOf('export function GarageScreen(');
  const end = source.indexOf('const styles = StyleSheet.create');

  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('GarageScreen — App Store 5.1.1(v)', () => {
  it('renders the account surface on every return path', () => {
    const body = garageComponentBody();

    /*
      Split on the returns themselves. Everything before the first one is setup
      and is not a rendered path; every chunk after one is something a user can
      actually be looking at, and each has to carry the account affordance.

      ⚠ The `(?!\))` is load-bearing and was added on 17 Aug after this test
      failed on a change that did nothing wrong. `\breturn \(` also matches a
      `useEffect` cleanup — `return () => { live = false; };` — so adding an
      effect with teardown invented a "render path" consisting of the rest of
      the setup block, which of course renders nothing at all.

      That is a false positive, and a false positive on a compliance test is
      worse than it sounds: the fix that suggests itself is to contort the
      component until the regex is happy, which leaves the rule enforcing a
      coding style instead of App Store 5.1.1(v). Excluding `return ()` is
      narrow — a JSX return never opens with `)` — so every real path is still
      caught.
    */
    const paths = body.split(/\breturn \((?!\))/).slice(1);

    // If this component is ever rewritten into a single return, this assertion
    // is what tells the next person to re-read the rule rather than assume the
    // test still covers three branches.
    expect(paths.length).toBeGreaterThanOrEqual(3);

    // `forEach` rather than `for…of paths.entries()`: the web tsconfig targets
    // below es2015 and iterating an IterableIterator there needs
    // --downlevelIteration, which Jest's transform does not require and
    // `tsc --noEmit` does.
    paths.forEach((path, index) => {
      expect({
        path: index,
        rendersAccount: /\{account\}|<AccountScreen/.test(path),
      }).toEqual({ path: index, rendersAccount: true });
    });
  });

  it('offers a way into the account, by an accessible name', () => {
    const body = garageComponentBody();

    // The label is what a screen reader announces and what a reviewer looks
    // for. A Pressable that opens the modal but announces nothing is reachable
    // by sight only.
    expect(body).toMatch(/accessibilityLabel="Account"/);
    expect(body).toMatch(/setAccountOpen\(true\)/);
  });

  it('keeps the token affordance out of release builds', () => {
    const source = readFileSync(GARAGE, 'utf8');

    /*
      Unrelated to 5.1.1(v) and guarded here because it is the same class of
      mistake and this is where a change to that screen gets read. `DevToken`
      renders a live bearer token — a password for the API until it expires —
      and it must compile out of a shipping build. Removing the `__DEV__` gate
      would print a credential on the main screen of the App Store binary.
    */
    const dev = source.slice(source.indexOf('function DevToken('));
    expect(dev.slice(0, dev.indexOf('\n}'))).toMatch(/if \(!__DEV__\) return null;/);
  });
});
