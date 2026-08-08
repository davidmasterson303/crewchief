/**
 * A development password must never reach a release binary.
 *
 * @jest-environment node
 *
 * `apps/mobile/src/auth/dev-session.ts` lets a dev build sign itself in, so
 * that an automated retest is not blocked every time the session lapses and
 * nobody has to type a password into a form to unblock a check.
 *
 * **The danger is specific and it is not hypothetical.** `EXPO_PUBLIC_*`
 * variables are *inlined into the bundle at transform time* — the literal
 * string is substituted where it is referenced, before any runtime check runs.
 * A version of that module which read `process.env.EXPO_PUBLIC_DEV_PASSWORD`
 * outside a `__DEV__` branch would therefore compile a real password into the
 * App Store binary, and no amount of `if (!__DEV__) return` afterwards would
 * remove it.
 *
 * So the reads are wrapped at module scope, where the guard covers the
 * *inlining* rather than the use. This file asserts that structurally.
 *
 * ── Why this is not the whole check ─────────────────────────────────────────
 *
 * A source scan cannot prove what a minifier emits. The real proof is building
 * a production bundle and searching it — done on 5 Aug for the dev token panel,
 * which appears zero times in `dev=false&minify=true` output while control
 * strings survive. That measurement is a moment in time and this is the ratchet
 * that keeps the shape it depends on.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MOBILE = join(__dirname, '..', '..', 'apps', 'mobile');

function read(...parts: string[]): string {
  return readFileSync(join(MOBILE, ...parts), 'utf8');
}

describe('dev-session credentials', () => {
  const source = read('src', 'auth', 'dev-session.ts');

  it('reads every EXPO_PUBLIC value inside a __DEV__ guard', () => {
    /*
      The assertion that carries the whole risk. Each `process.env.EXPO_PUBLIC_`
      reference must sit on a line that also tests `__DEV__`, so the inlined
      literal lives in a branch the release build eliminates.
    */
    const reads = source
      .split('\n')
      .filter((line) => line.includes('process.env.EXPO_PUBLIC_'))
      .filter((line) => !line.trim().startsWith('*'));

    // Guards the guard: a rename that stopped matching would pass vacuously.
    expect(reads.length).toBeGreaterThan(0);

    for (const line of reads) {
      expect(line).toMatch(/__DEV__/);
    }
  });

  it('gates the capability check on __DEV__ as well', () => {
    // `hasDevCredentials` is what every caller branches on. If it could return
    // true in a release build, the rest of the module's care would not matter.
    const fn = source.slice(source.indexOf('export function hasDevCredentials'));
    expect(fn.slice(0, fn.indexOf('\n}'))).toMatch(/__DEV__/);
  });

  it('keeps the credentials out of version control', () => {
    // The values live in apps/mobile/.env and are written there by a script
    // that moves them clipboard → file, never through a transcript.
    const ignore = readFileSync(join(MOBILE, '..', '..', '.gitignore'), 'utf8');
    expect(ignore).toMatch(/^\.env\*$/m);
  });

  it('hard-codes no credential of its own', () => {
    /*
      An `@example.com` default or a placeholder password is how a real value
      eventually gets committed "temporarily". There is no default: absent
      configuration means the feature is simply off.
    */
    expect(source).not.toMatch(/@[a-z]+\.(com|co|dev)/i);
    expect(source).not.toMatch(/password\s*[:=]\s*['"][^'"]+['"]/i);
  });

  it('is reachable only from the signed-out screen', () => {
    // Anywhere else would mean a signed-in app could silently re-authenticate
    // as someone else. `SignInScreen` renders only when there is no session.
    const signIn = read('src', 'screens', 'SignInScreen.tsx');
    expect(signIn).toMatch(/signInWithDevCredentials/);

    for (const screen of ['GarageScreen', 'VehicleDetailScreen', 'AdvisorScreen', 'InvoiceScanScreen']) {
      expect(read('src', 'screens', `${screen}.tsx`)).not.toMatch(/dev-session|DevCredentials/);
    }
  });
});
