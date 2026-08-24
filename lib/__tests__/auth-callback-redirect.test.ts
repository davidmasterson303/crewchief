/**
 * The sign-in callback cannot be pointed at somebody else's site.
 *
 * @jest-environment node
 *
 * ── The defect, from the 24 Aug audit (SEC-04) ──────────────────────────────
 *
 *     const redirectTo = requestUrl.searchParams.get('redirect') || '/garage';
 *     const response = NextResponse.redirect(new URL(redirectTo, requestUrl.origin));
 *
 * A `URL` constructor uses its base only for **relative** inputs. So
 * `?redirect=https://evil.example` produced exactly that URL, and the response
 * carried the user there with a freshly-set session cookie on the way out.
 *
 * It matters more here than the shape usually does: `/auth/callback` lives on
 * `crewchief.davidmasterson.co`, the hostname Apple's reviewer opens and the
 * one the mobile app talks to. A phishing page reached from a link on that
 * domain inherits whatever trust the name carries. `/auth/callback` is also
 * absent from the middleware matcher, so nothing upstream saw it.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROUTE = readFileSync(
  join(__dirname, '..', '..', 'app', 'auth', 'callback', 'route.ts'),
  'utf8'
);

/**
 * The guard itself, lifted out of the route.
 *
 * ⚠ Re-declared rather than imported: the route is a Next.js request handler
 * that pulls in `@supabase/ssr` and `next/server` at module scope, and this
 * suite runs under the node environment with no request context. The source
 * scan below is what pins the two copies together — it fails if the route stops
 * routing its input through a function of this name.
 */
function safeRedirect(raw: string | null): string {
  if (!raw) return '/garage';
  if (!raw.startsWith('/')) return '/garage';
  if (raw.startsWith('//') || raw.startsWith('/\\')) return '/garage';

  return raw;
}

describe('safeRedirect', () => {
  it('keeps an ordinary in-app path', () => {
    expect(safeRedirect('/garage')).toBe('/garage');
    expect(safeRedirect('/dashboard/abc?tab=health')).toBe('/dashboard/abc?tab=health');
  });

  it('refuses an absolute URL — the finding', () => {
    expect(safeRedirect('https://evil.example')).toBe('/garage');
    expect(safeRedirect('http://evil.example/steal')).toBe('/garage');
  });

  it('refuses a protocol-relative URL', () => {
    /*
      ⚠ The case a naive `startsWith('/')` lets straight through. `//evil.example`
      begins with a slash and is not a path — the browser resolves it against the
      current scheme and leaves the origin entirely.
    */
    expect(safeRedirect('//evil.example')).toBe('/garage');
    expect(safeRedirect('//evil.example/path')).toBe('/garage');
  });

  it('refuses the backslash spelling of the same trick', () => {
    // Some browsers normalise `/\evil.example` to `//evil.example`.
    expect(safeRedirect('/\\evil.example')).toBe('/garage');
  });

  it('refuses a scheme that is not http at all', () => {
    expect(safeRedirect('javascript:alert(1)')).toBe('/garage');
    expect(safeRedirect('data:text/html,<script>')).toBe('/garage');
  });

  it('falls back for an absent or empty parameter', () => {
    expect(safeRedirect(null)).toBe('/garage');
    expect(safeRedirect('')).toBe('/garage');
  });
});

describe('the route uses it', () => {
  it('routes the parameter through the guard rather than reading it raw', () => {
    /*
      The pin between the copy above and the shipped one. If the route ever goes
      back to reading `searchParams.get('redirect')` straight into a `URL`, this
      is what fails.
    */
    expect(ROUTE).toMatch(/const redirectTo = safeRedirect\(/);
    expect(ROUTE).not.toMatch(/const redirectTo = requestUrl\.searchParams\.get/);
  });

  it('does not redirect on a failed code exchange', () => {
    /*
      ⚠ The second half of SEC-04. The redirect response is constructed *before*
      the exchange, because the Supabase client needs somewhere to write its
      cookies — and it was then returned unconditionally, so a bad, expired or
      replayed code produced a 302 to the requested destination with no session.
    */
    const exchangeAt = ROUTE.indexOf('exchangeCodeForSession');
    expect(exchangeAt).toBeGreaterThan(-1);

    const after = ROUTE.slice(exchangeAt);
    expect(after).toMatch(/if \(error\) \{/);
    expect(after).toMatch(/'\/login\?error=link_expired'/);
  });
});
