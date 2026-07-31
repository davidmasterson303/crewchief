/**
 * The mobile client reads data through the API, and only through the API.
 *
 * @jest-environment node
 *
 * Phase 3's first carried-in ratchet (`cc-tech-0004`): built on day one rather
 * than retrofitted, because the alternative is discovering the rule was broken
 * after a screen depends on breaking it.
 *
 * **The lesson it encodes cost a real fix on 30 Jul.** `VehicleCard` queried
 * Supabase directly from the browser and deleted vehicles client-side, with no
 * server-side ownership check. Authorization lives in `lib/api-auth.ts`; a
 * client that talks to tables directly is a second answer to "who may see
 * this", and the second answer is always the one that is wrong.
 *
 * ── Why this lives in the web suite ─────────────────────────────────────────
 *
 * It is a static scan of source text, so it needs no React Native runtime, no
 * jest-expo, and no second toolchain. Putting it here means it runs on every
 * `npm test` from the day the rule exists rather than from the day someone
 * configures a mobile runner. When the Expo app gets its own suite this can
 * move; until then, an unenforced rule would be worth nothing.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MOBILE_SRC = join(__dirname, '..', '..', 'apps', 'mobile');

/**
 * The one module allowed to hold a Supabase client.
 *
 * Authentication is the exception that has to exist: the server validates
 * bearer tokens against the Supabase auth server (`resolveCaller`), so the
 * token must be a genuine Supabase one, and there is no way to mint that
 * without talking to Supabase auth. Data access is a different question and
 * gets no exception.
 */
const SUPABASE_CLIENT_OWNERS = ['src/auth/supabase.ts'];

function sourceFiles(dir: string, acc: { rel: string; code: string }[] = [], root = dir) {
  if (!existsSync(dir)) return acc;

  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.expo' || entry.startsWith('.')) continue;

    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, acc, root);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      acc.push({
        rel: full.replace(root + '/', ''),
        code: readFileSync(full, 'utf8'),
      });
    }
  }
  return acc;
}

/** Comments describe the rule constantly; they must not trip it. */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('the mobile client', () => {
  const files = sourceFiles(MOBILE_SRC).map((f) => ({ ...f, code: stripComments(f.code) }));

  it('has sources to scan', () => {
    // A broken walk would make every assertion below vacuously pass — the
    // failure mode Phase 0's ratchet actually shipped with.
    expect(files.length).toBeGreaterThan(3);
  });

  it('never queries a Supabase table directly', () => {
    // `.from(` is how every table read and write starts in supabase-js. This
    // is the VehicleCard rule.
    const offenders = files.filter((f) => /\.from\s*\(/.test(f.code)).map((f) => f.rel);

    expect(offenders).toEqual([]);
  });

  it('never reaches Supabase storage directly', () => {
    // Signed URLs are minted server-side after an ownership check —
    // lib/vehicle-photo.ts. A client that signs its own would bypass the check
    // that the path belongs to the vehicle it claims.
    const offenders = files.filter((f) => /\.storage\b/.test(f.code)).map((f) => f.rel);

    expect(offenders).toEqual([]);
  });

  it('imports the Supabase SDK in the auth module and nowhere else', () => {
    const importers = files
      .filter((f) => /from '@supabase\/supabase-js'/.test(f.code))
      .map((f) => f.rel)
      // Type-only imports are harmless: a `Session` type carries no client.
      .filter((rel) => {
        const file = files.find((f) => f.rel === rel)!;
        return !/import type \{[^}]*\} from '@supabase\/supabase-js'/.test(file.code);
      });

    expect(importers.sort()).toEqual(SUPABASE_CLIENT_OWNERS.sort());
  });

  it('sends every API request through the shared client', () => {
    /*
      A bare `fetch(` in a screen is how the bearer header gets forgotten, and
      a forgotten header is a 401 that looks like a broken session. The one
      permitted `fetch` is inside the API client itself.
    */
    const offenders = files
      .filter((f) => f.rel !== 'src/api/client.ts')
      .filter((f) => /\bfetch\s*\(/.test(f.code))
      .map((f) => f.rel);

    expect(offenders).toEqual([]);
  });

  it('stores the session in the keychain, never in AsyncStorage', () => {
    // A refresh token is the durable credential. AsyncStorage is unencrypted
    // files in the app container, readable from a jailbroken device and from
    // an unencrypted backup.
    const offenders = files
      .filter((f) => /AsyncStorage/.test(f.code))
      .map((f) => f.rel);

    expect(offenders).toEqual([]);
  });
});
