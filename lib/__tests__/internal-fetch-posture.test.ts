/**
 * No route may send a user's credentials to an address it derived from the
 * request.
 *
 * @jest-environment node
 *
 * A ratchet, in the shape of `auth-posture.test.ts`, and it exists because of
 * one concrete instance. `app/api/wishlist/complete/route.ts` recomputed
 * performance stats by POSTing to
 * `${request.nextUrl.origin}/api/performance-stats` with the caller's session
 * cookie attached, so the inner route could authorize the hop.
 *
 * `nextUrl.origin` is derived from the incoming request's host headers. That
 * made the destination of a request carrying a live session cookie a function
 * of a header the caller influences, and of whether the platform in front of
 * the app normalises it. It may have been safe on Netlify. The problem is
 * that its safety was a property of someone else's proxy configuration rather
 * than of this codebase — nothing here could assert it, and it could stop
 * being true without a line of this repo changing.
 *
 * The fix was to delete the hop: `lib/performance-stats.ts` is now called in
 * process with the client the caller already authorized. This suite stops it
 * coming back, and stops the same shape appearing anywhere else, because the
 * next author will have no reason to know any of the above.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');

function findSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '__tests__' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      findSourceFiles(full, acc);
    } else if (/\.tsx?$/.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

const SOURCE_DIRS = ['app', 'lib', 'components', 'hooks'];

/**
 * Modules permitted to read an `Authorization` header.
 *
 * Reading one to *authenticate the caller* is the legitimate case, and Phase 2
 * task 2.1 needs exactly one place to do it. Forwarding one onward is the case
 * this suite exists to prevent, and no entry here is licensed to do that.
 *
 * **This list may only ever shrink**, on the same terms as
 * `PENDING_AUTHORIZATION` in `auth-posture.test.ts`. Adding a route handler
 * here would mean a second implementation of caller identity, which is the
 * thing `lib/api-auth.ts` exists to prevent.
 */
const AUTHORIZATION_READERS = ['lib/api-auth.ts'];

/**
 * Matches a header read in either spelling: `request.headers.get('x')` on a
 * NextRequest, and `headers().get('x')` from `next/headers`.
 *
 * The second form was missed by the first version of this suite, and the miss
 * was only caught because the allowlist meta-test below asserts that each
 * allowlisted file actually trips the rule. A ratchet whose detector has a
 * hole is worse than no ratchet — it reports safety it is not checking.
 */
function headerRead(name: string): RegExp {
  return new RegExp(`(?:headers\\s*\\(\\s*\\)|headers)\\s*\\.\\s*get\\(\\s*['"]${name}['"]\\s*\\)`, 'i');
}

const sources = SOURCE_DIRS.flatMap((dir) => findSourceFiles(join(ROOT, dir))).map((path) => ({
  path,
  rel: path.slice(ROOT.length + 1),
  // Comments are stripped so the explanatory notes describing the old bug —
  // which necessarily quote it — do not trip the assertions.
  code: readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, ''),
}));

describe('the internal-fetch posture', () => {
  it('found source files to check', () => {
    // A broken walk would make every assertion below vacuously pass.
    expect(sources.length).toBeGreaterThan(50);
  });

  it('never builds a request URL from the incoming request host', () => {
    // nextUrl.origin, new URL(request.url).origin and the raw Host header are
    // all the same mistake wearing different spellings.
    const offenders = sources.filter(
      (s) =>
        /nextUrl\s*\.\s*origin/.test(s.code) ||
        /new URL\(\s*request\.url\s*\)\s*\.\s*origin/.test(s.code) ||
        headerRead('host').test(s.code) ||
        headerRead('x-forwarded-host').test(s.code)
    );

    expect(offenders.map((o) => o.rel)).toEqual([]);
  });

  it('never forwards the caller credentials to another request', () => {
    const offenders = sources.filter(
      (s) =>
        headerRead('cookie').test(s.code) ||
        (headerRead('authorization').test(s.code) && !AUTHORIZATION_READERS.includes(s.rel))
    );

    expect(offenders.map((o) => o.rel)).toEqual([]);
  });

  it('keeps the Authorization allowlist to modules that authenticate', () => {
    // The allowlist is the pressure valve, so it needs its own ratchet: an
    // entry that no longer reads the header must be deleted rather than left
    // to quietly re-permit a file that has become something else.
    //
    // This assertion has already paid for itself. The first version of the
    // detector above only matched `request.headers.get(...)`, so
    // `headers().get(...)` from next/headers — which is exactly what
    // lib/api-auth.ts uses — slipped straight through. The rule was reporting
    // a safety it was not checking, and this is what surfaced it.
    for (const rel of AUTHORIZATION_READERS) {
      const entry = sources.find((s) => s.rel === rel);
      expect(entry).toBeDefined();
      expect(entry!.code).toMatch(headerRead('authorization'));
    }
  });

  it('keeps the wishlist route calling the recompute in process', () => {
    const source = readFileSync(join(ROOT, 'app/api/wishlist/complete/route.ts'), 'utf8');

    expect(source).toContain("from '@/lib/performance-stats'");
    expect(source).toContain('recomputePerformanceStats');
    // The specific regression: any fetch at all in this route is suspicious,
    // since the only thing it ever called out to was itself.
    expect(source.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/\bfetch\s*\(/);
  });
});
