/**
 * Cross-origin policy for `/api/v1`.
 *
 * @jest-environment node
 *
 * Phase 2 task 2.3. The assertions that matter are the ones about what is
 * *not* sent:
 *
 *   - `Access-Control-Allow-Origin` is never `*`. A wildcard publishes the API
 *     to every page on the internet.
 *   - Credentials are never allowed. Because the mobile client authenticates
 *     with a bearer token (task 2.1) it never needs cookies to cross origins,
 *     so refusing credentials costs nothing and means a mistaken allowlist
 *     entry cannot be escalated into riding a logged-in user's session.
 *   - Same-origin requests get no CORS headers at all. The web app and the
 *     anonymous demo are same-origin, so CORS must be invisible to them; if it
 *     is not, the middleware matcher is too wide, and §3 item 6 is what
 *     happens when middleware reaches further than intended.
 */

import { allowedOrigins, corsHeadersFor, isVersionedApiPath } from '@crewchief/core/cors';

const ORIGINS = ['https://crewchief-demo.davidmasterson.co', 'http://localhost:8081'];

describe('the allowlist comes from the environment', () => {
  it('parses a comma-separated list', () => {
    expect(allowedOrigins('https://a.example, https://b.example')).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
  });

  it('is empty when unset, which allows nothing', () => {
    // Failing closed: no configuration means no cross-origin access, rather
    // than a default that quietly permits something.
    //
    // Read through process.env rather than by passing `undefined`. The
    // parameter defaults to the env var, so an explicit `undefined` argument
    // triggers that default and reads whatever the developer happens to have
    // in .env — which is how this assertion first passed for the wrong reason
    // and then failed once CORS_ALLOWED_ORIGINS was set locally.
    const original = process.env.CORS_ALLOWED_ORIGINS;
    try {
      delete process.env.CORS_ALLOWED_ORIGINS;
      expect(allowedOrigins()).toEqual([]);

      process.env.CORS_ALLOWED_ORIGINS = '';
      expect(allowedOrigins()).toEqual([]);
    } finally {
      if (original === undefined) delete process.env.CORS_ALLOWED_ORIGINS;
      else process.env.CORS_ALLOWED_ORIGINS = original;
    }
  });

  it('reads the environment when no argument is given', () => {
    const original = process.env.CORS_ALLOWED_ORIGINS;
    try {
      process.env.CORS_ALLOWED_ORIGINS = 'https://from-env.example';
      expect(allowedOrigins()).toEqual(['https://from-env.example']);
    } finally {
      if (original === undefined) delete process.env.CORS_ALLOWED_ORIGINS;
      else process.env.CORS_ALLOWED_ORIGINS = original;
    }
  });

  it('ignores blank entries from a trailing comma', () => {
    expect(allowedOrigins('https://a.example,,')).toEqual(['https://a.example']);
  });
});

describe('which paths are in scope', () => {
  it('covers the versioned API', () => {
    expect(isVersionedApiPath('/api/v1/load-vehicle')).toBe(true);
    expect(isVersionedApiPath('/api/v1/wishlist/complete')).toBe(true);
  });

  it('excludes the release-tooling routes', () => {
    // /api/version and /api/health/ai are read by promote-demo.mjs and
    // verify-demo.mjs from outside a browser. CORS is meaningless for them,
    // and routing the deploy path through middleware would be cost with no
    // benefit.
    expect(isVersionedApiPath('/api/version')).toBe(false);
    expect(isVersionedApiPath('/api/health/ai')).toBe(false);
  });

  it('excludes pages', () => {
    expect(isVersionedApiPath('/demo')).toBe(false);
    expect(isVersionedApiPath('/dashboard/a1000000-0000-0000-0000-000000000001')).toBe(false);
  });
});

describe('an allowlisted origin', () => {
  const headers = corsHeadersFor(ORIGINS[0], ORIGINS)!;

  it('is echoed back exactly, never as a wildcard', () => {
    expect(headers['Access-Control-Allow-Origin']).toBe(ORIGINS[0]);
    expect(headers['Access-Control-Allow-Origin']).not.toBe('*');
  });

  it('is refused credentials', () => {
    expect(headers['Access-Control-Allow-Credentials']).toBe('false');
  });

  it('may send an Authorization header, which is the whole point', () => {
    expect(headers['Access-Control-Allow-Headers']).toMatch(/Authorization/i);
  });

  it('varies by origin so a cache cannot cross-serve', () => {
    expect(headers.Vary).toBe('Origin');
  });
});

describe('everything else gets no headers, which is the refusal', () => {
  it('refuses an origin that is not on the list', () => {
    expect(corsHeadersFor('https://evil.example', ORIGINS)).toBeNull();
  });

  it('refuses a lookalike origin', () => {
    // Substring matching would admit these; exact matching does not.
    expect(corsHeadersFor('https://crewchief-demo.davidmasterson.co.evil.example', ORIGINS)).toBeNull();
    expect(corsHeadersFor('http://crewchief-demo.davidmasterson.co', ORIGINS)).toBeNull();
  });

  it('sends nothing for a request with no Origin', () => {
    // Same-origin, or not a browser at all. The demo and the web app are both
    // same-origin, so CORS should never appear in their responses.
    expect(corsHeadersFor(null, ORIGINS)).toBeNull();
    expect(corsHeadersFor(undefined, ORIGINS)).toBeNull();
  });

  it('allows nothing when the allowlist is empty', () => {
    expect(corsHeadersFor('https://crewchief-demo.davidmasterson.co', [])).toBeNull();
  });

  it('never emits a wildcard for any input', () => {
    const inputs = [ORIGINS[0], ORIGINS[1], 'https://evil.example', '*', null];
    for (const input of inputs) {
      const result = corsHeadersFor(input, ORIGINS);
      if (result) expect(result['Access-Control-Allow-Origin']).not.toBe('*');
    }
  });
});
