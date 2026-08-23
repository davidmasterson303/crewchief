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

/**
 * The only two modules that may call `fetch`.
 *
 * `src/api/client.ts` is the API client itself — the rule's whole point is that
 * every CrewChief request goes through it and therefore carries a bearer token.
 *
 * ⚠ `src/api/vpic.ts` was added on 23 Aug and is a **genuine exception, not a
 * loosening**. NHTSA's vPIC is a public, unauthenticated US government API that
 * the add-a-car screen asks for model lists and VIN decodes. `apiRequest` is
 * structurally unusable for it: it prefixes `API_PREFIX`, resolves against
 * `API_BASE_URL`, and attaches a Supabase bearer token — none of which vPIC has
 * any use for, and the last of which would send a CrewChief credential to a
 * third party.
 *
 * The exception is kept safe by the case below it rather than by good
 * intentions: an exempt module that named a CrewChief path or host would be
 * exactly the hole this rule exists to close, and that is asserted separately.
 *
 * Going direct is also what keeps the feature a JS-only change. A proxy route
 * would be a new `/api/v1/*` endpoint, and per `CLAUDE.md` §8 a mobile build
 * depending on one has to wait for a `web-live` promote.
 */
const FETCH_OWNERS = ['src/api/client.ts', 'src/api/vpic.ts'];

/** The exempt module talks to this and nothing else. */
const THIRD_PARTY_HOSTS = [/vpic\.nhtsa\.dot\.gov/];

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
    /*
      `.from(` is how every table read and write starts in supabase-js. This
      is the VehicleCard rule.

      ⚠ `Array.from` is carved out, and the carve-out is as narrow as it can
      be. `Skeleton.tsx` builds its placeholder rows with `Array.from({ length
      })` — an ordinary idiom with nothing to do with Supabase — and tripped
      this on 14 Aug. The lookbehind excludes that receiver and nothing else:
      a client called `Array` does not exist, so `supabase.from`, `client.from`
      and every aliased form are still caught.

      Fixed here rather than in the component on purpose. A security guard that
      false-positives on normal JavaScript is one somebody eventually loosens
      properly, under deadline, in a way nobody reviews — the same reasoning
      `stripComments` above already encodes.
    */
    const offenders = files
      .filter((f) => /(?<!\bArray)\.from\s*\(/.test(f.code))
      .map((f) => f.rel);

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
      a forgotten header is a 401 that looks like a broken session.

      ⚠ Asserted as an **exact set**, not as "no unexpected offenders". That is
      what makes the list a ratchet in both directions: a new bare `fetch`
      anywhere fails, and so does deleting one from a module on the list, which
      is what stops the exemption quietly outliving the reason for it.
    */
    const callers = files
      .filter((f) => /\bfetch\s*\(/.test(f.code))
      .map((f) => f.rel);

    expect(callers.sort()).toEqual([...FETCH_OWNERS].sort());
  });

  it('keeps the third-party exception pointed at a third party', () => {
    /*
      ⚠ The case that makes `FETCH_OWNERS` safe to have more than one entry in.

      An exempt module is exempt because it talks to somebody who is not
      CrewChief. The moment one of them names `API_PREFIX`, an `/api/v1` path or
      the app's own base URL, it has become an unauthenticated second route into
      this product's data — which is the `VehicleCard` defect at the top of this
      file, arriving through the door the exception opened.

      Two halves, and the second is the one that actually holds:

        - the exempt module names none of ours, and
        - it mints **no URL of its own at all**. Every address it fetches comes
          from `@crewchief/core/vehicle-catalog`, whose complete set of hosts is
          asserted below. Checking the module for a third-party hostname would
          not do it — the hostname legitimately lives in the shared module, and
          a check that looked for it locally would have to be satisfied by
          writing one, which is the opposite of what this wants.
    */
    const exempt = files.filter(
      (f) => FETCH_OWNERS.includes(f.rel) && f.rel !== 'src/api/client.ts'
    );

    // Anti-vacuous: an empty set satisfies every assertion inside the loop.
    expect(exempt.length).toBe(FETCH_OWNERS.length - 1);

    for (const file of exempt) {
      expect(file.code).not.toMatch(/API_PREFIX|API_BASE_URL|\/api\/v1/);
      expect(file.code).not.toMatch(/https?:\/\//);
      expect(file.code).toMatch(/@crewchief\/core\/vehicle-catalog/);
    }

    /*
      And the catalogue those URLs come from reaches exactly one host. Written
      as an exact set rather than "contains vPIC", so adding a second third
      party is a decision somebody has to make here, in front of this comment.
    */
    const catalogue = stripComments(
      readFileSync(
        join(__dirname, '..', '..', 'packages', 'core', 'src', 'vehicle-catalog.ts'),
        'utf8'
      )
    );
    const hosts = catalogue.match(/https?:\/\/[^'"`\s/]+/g) ?? [];

    // It found addresses at all — a regex that matched nothing would agree
    // with any host in the file.
    expect(hosts.length).toBeGreaterThan(0);
    expect(Array.from(new Set(hosts))).toEqual(['https://vpic.nhtsa.dot.gov']);
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
