/**
 * No back button in the app says `VehicleDetail`.
 *
 * @jest-environment node
 *
 * native-stack takes a pushed screen's back label from the **previous** screen's
 * `title`, and when that screen has none it falls back to `route.name`. Hiding a
 * header therefore does not take that screen out of the next screen's header —
 * it only removes the value the label would have used.
 *
 * `VehicleDetail` hid its header on 23 Aug so the hero pullback could pin a
 * photograph under the status bar, and from that commit every screen pushed
 * from it — recalls, service, the wishlist, the build, the profile, the scan —
 * carried `‹ VehicleDetail` back to the car. A class name, in caps-in-the-middle,
 * on the most-travelled back button in the app.
 *
 * Nothing failed. It typechecked, the header rendered, the gesture worked, and
 * the only symptom was two words of internal vocabulary shown to the owner.
 * That is the shape of defect this repository keeps paying for, so the rule is
 * mechanical rather than remembered: **every route declares a human title, and
 * no title is PascalCase.**
 *
 * ── Why a source scan ───────────────────────────────────────────────────────
 *
 * Same reasoning as `mobile-account-reachable.test.ts`: no React Native runtime
 * on this side of the workspace, so mounting the navigator is not available on
 * `npm test`. What regressed is declarative and on disk — whether a `Stack.Screen`
 * carries a `title` — and a weaker check that runs beats a stronger one that
 * does not exist.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const NAVIGATOR = join(
  __dirname,
  '..',
  '..',
  'apps',
  'mobile',
  'src',
  'navigation',
  'RootNavigator.tsx'
);

const OPENING_TAG = '<Stack.Screen';

interface Declared {
  name: string;
  /** The whole attribute blob, comments included — `title` is looked for in it. */
  attributes: string;
}

/**
 * Every `Stack.Screen` declared in a source, with its attributes.
 *
 * ⚠ Comments inside the attribute blob are stripped first. Three of these
 * screens carry a block comment explaining the option beside it, and one of
 * those comments contains the string `title:` while describing it — which would
 * satisfy the rule below without any option being set. A guard passing on its
 * own documentation is `.tap-target-44` again.
 */
function screensIn(source: string): Declared[] {
  const found: Declared[] = [];

  for (let at = source.indexOf(OPENING_TAG); at !== -1; at = source.indexOf(OPENING_TAG, at + 1)) {
    const attributes = attributeBlobAt(source, at + OPENING_TAG.length)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

    const name = /name="([^"]+)"/.exec(attributes)?.[1];
    if (name) found.push({ name, attributes });
  }

  return found;
}

/**
 * The opening tag's attributes, ending at the `>` that closes it.
 *
 * ⚠ **Not the first `>` in the text.** Two of these screens set options with an
 * arrow function — `options={({ route }) => ({ … })}` — and the fat arrow's own
 * `>` sits four characters into the attribute blob. A lazy `[\s\S]*?>` stops
 * there, hands back `name="VehicleDetail" options={({ route }` and reports the
 * screen as untitled: a **false failure on the two routes that were the whole
 * reason for the guard**, and the obvious way to quiet it is to change the
 * navigator until the regex is happy.
 *
 * So the depth is counted. The tag closes at the first `>` outside every brace
 * and paren, which is the only definition that survives an expression in an
 * attribute.
 */
function attributeBlobAt(source: string, from: number): string {
  let depth = 0;

  for (let at = from; at < source.length; at += 1) {
    const character = source[at];

    if (character === '{' || character === '(') depth += 1;
    else if (character === '}' || character === ')') depth -= 1;
    else if (character === '>' && depth === 0) return source.slice(from, at);
  }

  return source.slice(from);
}

/**
 * PascalCase, which is what a leaked route name looks like.
 *
 * A lower-case letter followed by an upper-case one, inside a single word:
 * `VehicleDetail`, `ServiceHistory`, `WishlistAdd`. It deliberately does **not**
 * fire on `Add a car` or `Scan an invoice`, and it does not fire on a single
 * capitalised word like `Health` — a route name that happens to also be the
 * product's word for the thing is not a leak.
 */
const PASCAL_CASE = /\b[A-Z][a-z]+[A-Z]/;

function declaredTitle(attributes: string): string | null {
  return /title:\s*'([^']*)'/.exec(attributes)?.[1] ?? null;
}

/** Set through a helper or an expression rather than a literal — `title: fn(x)`. */
function computesTitle(attributes: string): boolean {
  return /title:\s*[^'\s]/.test(attributes);
}

const navigator = readFileSync(NAVIGATOR, 'utf8');

describe('RootNavigator — back labels are the product\'s words', () => {
  it('finds the routes it is meant to be checking', () => {
    const screens = screensIn(navigator);

    /*
      The anti-vacuous half. A walker that silently matches nothing reports a
      clean app forever, which is how a suite here once passed for weeks against
      an empty result — so this asserts the shape of what was read, not merely
      that reading did not throw.
    */
    /*
      ⚠ Lowered from 12 on 23 Aug, and that is the IA merge rather than a
      loosened guard: `Service` replaced two routes, `Plan` replaced two more,
      and `Health` absorbed the recalls screen. Ten flat destinations became
      five, which is the point of R13–R16.
    */
    expect(screens.length).toBeGreaterThanOrEqual(9);
    expect(screens.map((screen) => screen.name)).toEqual(
      expect.arrayContaining(['Garage', 'VehicleDetail', 'RecallDetail', 'InvoiceScan'])
    );
  });

  it('declares a title on every route, including the ones with no header', () => {
    /*
      ⚠ `headerShown: false` is not an exemption — it is the condition that
      caused this. A screen with no header of its own still supplies the label
      of every screen pushed from it.

      Collected rather than asserted one at a time, so a failure names every
      route that would leak instead of stopping at the first.
    */
    const untitled = screensIn(navigator)
      .filter(({ attributes }) => declaredTitle(attributes) === null && !computesTitle(attributes))
      .map(({ name }) => `${name} → back button would read "‹ ${name}"`);

    expect(untitled).toEqual([]);
  });

  it('never uses a route name as a label', () => {
    const leaks = screensIn(navigator)
      .map(({ name, attributes }) => ({ name, title: declaredTitle(attributes) }))
      .filter(({ title }) => title !== null && PASCAL_CASE.test(title))
      .map(({ name, title }) => `${name} → title "${title}"`);

    expect(leaks).toEqual([]);
  });

  it('can still detect a leak', () => {
    /*
      The other half of rule 5: prove the detector fires. Both failure modes —
      the missing title that falls back to the route name, and a title that is
      the route name written out — against a source shaped like the real one.
    */
    const leaky = `
      <Stack.Screen name="VehicleDetail" options={{ headerShown: false }}>
      </Stack.Screen>
      <Stack.Screen name="ServiceHistory" options={{ title: 'ServiceHistory' }}>
      </Stack.Screen>
    `;

    const screens = screensIn(leaky);
    expect(screens).toHaveLength(2);

    expect(declaredTitle(screens[0].attributes)).toBeNull();
    expect(computesTitle(screens[0].attributes)).toBe(false);
    expect(PASCAL_CASE.test(declaredTitle(screens[1].attributes) ?? '')).toBe(true);
  });

  it('is not satisfied by a comment that mentions a title', () => {
    const commented = `
      <Stack.Screen
        name="VehicleDetail"
        /* The title: is deliberately not set here, because reasons. */
        options={{ headerShown: false }}
      >
      </Stack.Screen>
    `;

    const [screen] = screensIn(commented);
    expect(screen.name).toBe('VehicleDetail');
    expect(declaredTitle(screen.attributes)).toBeNull();
    expect(computesTitle(screen.attributes)).toBe(false);
  });
});
