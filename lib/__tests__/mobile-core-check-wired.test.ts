/**
 * The on-device core probe is actually rendered, and stays out of release.
 *
 * @jest-environment node
 *
 * `checkSharedCore()` calls real `@crewchief/core` code with known inputs
 * inside the React Native runtime and asserts known outputs. It is the only
 * check that can catch core relying on something the phone's engine does not
 * have — and it spent from Phase 3.2 until 5 Aug **exported and imported by
 * nothing**, because `GarageScreen` replaced the `SignedInScreen` that used to
 * render it and nothing failed when its only caller disappeared.
 *
 * That is the failure this file pins. A probe that is not rendered is not a
 * probe, and nothing about deleting its last import is loud.
 *
 * ── What it catches that `portability.test.ts` cannot ───────────────────────
 *
 * That suite walks `packages/core/src` transitively for disqualifying imports
 * — `next/*`, `@supabase/*`, `node:*`, browser globals — and is better at that
 * job than the device probe is. But **a runtime capability is not an import**:
 *
 *   - `formatting-utils.ts` calls `Intl.NumberFormat` and `toLocaleString`.
 *     A Hermes built without Intl returns unseparated digits rather than
 *     throwing, so the garage would quietly read "94800 mi".
 *   - `consultant-context-kinds.ts` calls `Object.hasOwn` (ES2022, added
 *     5 Aug). Node has it, so Jest can never fail on it.
 *
 * Neither appears in any import list. The two suites are complementary: the
 * Node one proves core *may* load on the phone, the device one proves it
 * *works* there.
 *
 * ── Why a source scan ───────────────────────────────────────────────────────
 *
 * Same constraint as `mobile-api-only.test.ts`: the subject is React Native
 * source this runner cannot load, and the property — *is it wired in, is it
 * gated* — is structural.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MOBILE = join(__dirname, '..', '..', 'apps', 'mobile');

function read(...parts: string[]): string {
  return readFileSync(join(MOBILE, ...parts), 'utf8');
}

describe('checkSharedCore is wired into a screen', () => {
  it('is imported and called by the sign-in screen', () => {
    const screen = read('src', 'screens', 'SignInScreen.tsx');

    expect(screen).toMatch(/import \{ checkSharedCore \} from '\.\.\/core-check'/);
    expect(screen).toMatch(/checkSharedCore\(\)/);
  });

  it('renders the component that calls it', () => {
    // Importing it is not enough — the previous home imported it right up until
    // the screen was replaced. It has to appear in returned markup.
    const screen = read('src', 'screens', 'SignInScreen.tsx');
    expect(screen).toMatch(/<DevCoreCheck\s*\/>/);
  });

  it('lives on a screen that renders before a session exists', () => {
    /*
      Deliberate. Nothing core computes depends on being signed in, and gating
      the probe behind authentication would make it unrunnable exactly when a
      bundle is most broken — which is the state it exists to report.
    */
    const app = read('App.tsx');
    expect(app).toMatch(/<SignInScreen \/>/);
  });

  it('compiles out of a release build', () => {
    // Same rule as DevToken: a diagnostic must not become a product surface.
    const screen = read('src', 'screens', 'SignInScreen.tsx');
    const component = screen.slice(screen.indexOf('function DevCoreCheck('));

    expect(component.slice(0, component.indexOf('\n}'))).toMatch(
      /if \(!__DEV__\) return null;/
    );
  });
});

describe('the probe asserts outputs, not just absence of a throw', () => {
  it('checks a value, not merely that a call returned', () => {
    const probe = read('src', 'core-check.ts');

    /*
      The file's own rule: "a check that only asserted 'the import did not
      throw' would pass against a module that had been quietly stubbed." The
      mileage check is the one where that matters most — a Hermes without Intl
      returns a string either way, so the separator has to be the assertion.
    */
    expect(probe).toMatch(/formatted === '94,800'/);
  });

  it('covers the runtime features core actually depends on', () => {
    const probe = read('src', 'core-check.ts');

    // `Object.hasOwn` is reached through `isContextKind` in the advisor's
    // provenance row, where its absence would throw far from this file.
    expect(probe).toMatch(/Object\.hasOwn/);

    // Called, not sniffed with `typeof` alone — a polyfill that exists but
    // walks the prototype chain is the failure that matters.
    expect(probe).toMatch(/Object\.hasOwn\(\{\}, 'toString'\)/);
  });
});
