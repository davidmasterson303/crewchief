/**
 * One product, one version number.
 *
 * @jest-environment node
 *
 * ── Why this is worth a test ────────────────────────────────────────────────
 *
 * Three files carry it and nothing held them together. On 24 Aug they read
 * `0.1.0`, `0.1.0` and `0.1.0` while the product was days from an App Store
 * submission — **MOB-31**, "the display version is still 0.1.0". They are all
 * `1.0.0` now, and the failure mode from here is not that somebody forgets to
 * bump: it is that somebody bumps **one** of them.
 *
 * That matters more than it sounds. `/api/version` reports the web build's
 * number and the binary reports `app.json`'s, and the whole point of surfacing
 * either is a support conversation that starts *"which version are you on"*. Two
 * answers to that question is worse than none.
 *
 * ── ⚠ `apps/mobile/app.json` is the one Apple reads ─────────────────────────
 *
 * `expo.version` becomes `CFBundleShortVersionString` — the number on the App
 * Store listing. `apps/mobile/package.json` is npm's copy and is never
 * displayed; the root `package.json` is what `/api/version` serves. Different
 * audiences, same number, and this is the only place that says so.
 *
 * The **build** number is deliberately not here: `eas.json` sets
 * `appVersionSource: "remote"` with `autoIncrement` on the production profile,
 * so EAS owns it and a copy in the repo would be a second opinion that drifts.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');

const read = (...parts: string[]) => JSON.parse(readFileSync(join(ROOT, ...parts), 'utf8'));

const web = read('package.json').version as string;
const mobilePackage = read('apps', 'mobile', 'package.json').version as string;
const binary = read('apps', 'mobile', 'app.json').expo.version as string;

describe('the version', () => {
  it('is the same in all three places', () => {
    expect({ web, mobilePackage, binary }).toEqual({
      web,
      mobilePackage: web,
      binary: web,
    });
  });

  it('is a real semver, and not the scaffold default', () => {
    /*
      ⚠ `0.1.0` is what `create-next-app` and `create-expo-app` both write, and
      it survived to within days of a submission. A version nobody chose is a
      version nobody will remember to change.
    */
    expect(web).toMatch(/^\d+\.\d+\.\d+$/);
    expect(web).not.toBe('0.1.0');
  });

  it('reaches the deployed build', () => {
    /*
      The half that makes the number useful rather than decorative. `next.config.js`
      inlines it at build time — a route reading `package.json` at request time
      would need the file in the function bundle, which Netlify does not provide,
      and that is the exact mistake `/api/version` already made once with
      `COMMIT_REF`.
    */
    const config = readFileSync(join(ROOT, 'next.config.js'), 'utf8');
    const route = readFileSync(join(ROOT, 'app', 'api', 'version', 'route.ts'), 'utf8');

    expect(config).toMatch(/NEXT_PUBLIC_APP_VERSION: require\('\.\/package\.json'\)\.version/);
    expect(route).toMatch(/process\.env\.NEXT_PUBLIC_APP_VERSION/);
  });

  it('does not pin a build number, because EAS owns it', () => {
    // `appVersionSource: "remote"` plus `autoIncrement` on production. A copy in
    // app.json would be a second opinion that drifts from the one Apple sees.
    const eas = read('apps', 'mobile', 'eas.json');
    const app = read('apps', 'mobile', 'app.json');

    expect(eas.cli.appVersionSource).toBe('remote');
    expect(eas.build.production.autoIncrement).toBe(true);
    expect(app.expo.ios.buildNumber).toBeUndefined();
  });
});
