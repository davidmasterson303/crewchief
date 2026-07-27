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
        /headers\s*\.\s*get\(\s*['"]host['"]\s*\)/i.test(s.code) ||
        /headers\s*\.\s*get\(\s*['"]x-forwarded-host['"]\s*\)/i.test(s.code)
    );

    expect(offenders.map((o) => o.rel)).toEqual([]);
  });

  it('never forwards the caller credentials to another request', () => {
    const offenders = sources.filter(
      (s) =>
        /headers\s*\.\s*get\(\s*['"]cookie['"]\s*\)/i.test(s.code) ||
        /headers\s*\.\s*get\(\s*['"]authorization['"]\s*\)/i.test(s.code)
    );

    // If bearer-token support (Phase 2 task 2.1) needs to READ an Authorization
    // header, that belongs in lib/api-auth.ts and this list should name it
    // explicitly rather than the assertion being relaxed.
    expect(offenders.map((o) => o.rel)).toEqual([]);
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
