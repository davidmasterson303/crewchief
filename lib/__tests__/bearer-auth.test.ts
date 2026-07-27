/**
 * Bearer tokens, on the same terms as cookie sessions.
 *
 * @jest-environment node
 *
 * Phase 2 task 2.1. The web app authenticates with cookies; a native client
 * has no cookie jar and sends `Authorization: Bearer <jwt>`. Both must resolve
 * to the same identity and the same level of access — bearer support is a
 * second way to present a credential, not a second security model.
 *
 * The assertions worth reading twice are the negative ones:
 *
 *   - A bearer token that does not verify is a 401. It does **not** fall back
 *     to a cookie that happens to be on the request. A caller who explicitly
 *     presented one identity must never be served as another.
 *   - Nothing about bearer support touches the anonymous demo path. The demo
 *     is recruiter-facing and §3 item 6 is what happens when auth changes
 *     reach it.
 */

import { parseBearerToken } from '@/lib/api-auth';

describe('parseBearerToken', () => {
  it('reads a well-formed header', () => {
    expect(parseBearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('accepts any case of the scheme, per RFC 6750', () => {
    expect(parseBearerToken('bearer abc')).toBe('abc');
    expect(parseBearerToken('BEARER abc')).toBe('abc');
  });

  it('tolerates surrounding and repeated whitespace', () => {
    expect(parseBearerToken('  Bearer   abc  ')).toBe('abc');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty', ''],
    ['scheme only', 'Bearer'],
    ['scheme and nothing', 'Bearer '],
    ['a different scheme', 'Basic abc'],
    ['a bare token', 'abc.def.ghi'],
    ['two tokens', 'Bearer abc def'],
  ])('returns null for %s', (_label, value) => {
    expect(parseBearerToken(value as string | null | undefined)).toBeNull();
  });

  it('does not repair a malformed header', () => {
    // A token this function had to guess at is a token we do not understand,
    // and guessing at credentials is how parsers become vulnerabilities.
    expect(parseBearerToken('Bearer: abc')).toBeNull();
    expect(parseBearerToken('Bearer\tabc')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolveCaller, exercised through the exported entry points
// ---------------------------------------------------------------------------

const getUserFromBearer = jest.fn();
const getUserFromCookie = jest.fn();
const bearerClientFor = jest.fn();

jest.mock('next/headers', () => ({
  headers: () => ({ get: (name: string) => mockHeaders[name.toLowerCase()] ?? null }),
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));

let mockHeaders: Record<string, string> = {};

jest.mock('@/lib/supabase', () => ({
  createBearerClient: (token: string) => {
    bearerClientFor(token);
    return {
      auth: { getUser: (t: string) => getUserFromBearer(t) },
      from: () => ({
        select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'v1' }, error: null }) }) }) }),
      }),
    };
  },
  createServerActionClient: () => ({
    auth: { getUser: () => getUserFromCookie() },
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'v1' }, error: null }) }) }) }),
    }),
  }),
  getServerClient: () => ({ __anon: true }),
  getServiceRoleClient: () => ({ __serviceRole: true }),
}));

const { requireSession, authorizeVehicleAccess } = require('@/lib/api-auth');
const { DEMO_VEHICLE_IDS } = require('@/lib/demo');

const OWNED_VEHICLE_ID = 'b2000000-0000-4000-8000-000000000001';

beforeEach(() => {
  mockHeaders = {};
  getUserFromBearer.mockReset();
  getUserFromCookie.mockReset();
  bearerClientFor.mockReset();
});

describe('requireSession accepts either credential', () => {
  it('resolves a cookie session when no bearer is present', async () => {
    getUserFromCookie.mockResolvedValue({ data: { user: { id: 'user-cookie' } }, error: null });

    await expect(requireSession()).resolves.toEqual({ ok: true, userId: 'user-cookie' });
    expect(bearerClientFor).not.toHaveBeenCalled();
  });

  it('resolves a bearer token when one is present', async () => {
    mockHeaders.authorization = 'Bearer good.token';
    getUserFromBearer.mockResolvedValue({ data: { user: { id: 'user-bearer' } }, error: null });

    await expect(requireSession()).resolves.toEqual({ ok: true, userId: 'user-bearer' });
    expect(bearerClientFor).toHaveBeenCalledWith('good.token');
    // The cookie path must not even be consulted.
    expect(getUserFromCookie).not.toHaveBeenCalled();
  });

  it('validates the token against the auth server rather than decoding it', async () => {
    mockHeaders.authorization = 'Bearer good.token';
    getUserFromBearer.mockResolvedValue({ data: { user: { id: 'u' } }, error: null });

    await requireSession();

    expect(getUserFromBearer).toHaveBeenCalledWith('good.token');
  });

  it('401s with no credential at all', async () => {
    getUserFromCookie.mockResolvedValue({ data: { user: null }, error: null });

    await expect(requireSession()).resolves.toMatchObject({ ok: false, status: 401 });
  });
});

describe('a bearer token never falls back to a cookie', () => {
  it('401s on a rejected bearer even with a valid cookie present', async () => {
    // The case that matters. Falling back would serve a caller who explicitly
    // presented one identity as a different one, and would hide a broken
    // native client behind whatever browser session shared the request.
    mockHeaders.authorization = 'Bearer expired.token';
    getUserFromBearer.mockResolvedValue({ data: { user: null }, error: { message: 'expired' } });
    getUserFromCookie.mockResolvedValue({ data: { user: { id: 'user-cookie' } }, error: null });

    await expect(requireSession()).resolves.toMatchObject({ ok: false, status: 401 });
    expect(getUserFromCookie).not.toHaveBeenCalled();
  });

  it('401s on a rejected bearer in authorizeVehicleAccess too', async () => {
    mockHeaders.authorization = 'Bearer expired.token';
    getUserFromBearer.mockResolvedValue({ data: { user: null }, error: { message: 'expired' } });
    getUserFromCookie.mockResolvedValue({ data: { user: { id: 'user-cookie' } }, error: null });

    const result = await authorizeVehicleAccess(OWNED_VEHICLE_ID, { intent: 'read' });

    expect(result).toMatchObject({ ok: false, status: 401 });
    expect(getUserFromCookie).not.toHaveBeenCalled();
  });

  it('treats a malformed Authorization header as no bearer at all', async () => {
    // Not a rejected token — never a token. This one legitimately falls
    // through to the cookie, because nothing was presented.
    mockHeaders.authorization = 'Basic abc';
    getUserFromCookie.mockResolvedValue({ data: { user: { id: 'user-cookie' } }, error: null });

    await expect(requireSession()).resolves.toEqual({ ok: true, userId: 'user-cookie' });
    expect(bearerClientFor).not.toHaveBeenCalled();
  });
});

describe('bearer support reaches the same access decision as a cookie', () => {
  it('grants a service-role client only after ownership is proven', async () => {
    mockHeaders.authorization = 'Bearer good.token';
    getUserFromBearer.mockResolvedValue({ data: { user: { id: 'user-bearer' } }, error: null });

    const result = await authorizeVehicleAccess(OWNED_VEHICLE_ID, { intent: 'read' });

    expect(result).toMatchObject({ ok: true, isDemo: false, userId: 'user-bearer' });
    expect((result as { client: { __serviceRole?: boolean } }).client.__serviceRole).toBe(true);
  });

  it('rejects a malformed vehicle id before looking at any credential', async () => {
    mockHeaders.authorization = 'Bearer good.token';

    const result = await authorizeVehicleAccess('not-a-uuid', { intent: 'read' });

    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(getUserFromBearer).not.toHaveBeenCalled();
  });
});

describe('the anonymous demo path is untouched', () => {
  it('serves a demo vehicle with no credential of any kind', async () => {
    const result = await authorizeVehicleAccess(DEMO_VEHICLE_IDS[0], { intent: 'read' });

    expect(result).toMatchObject({ ok: true, isDemo: true, userId: null });
    expect(getUserFromCookie).not.toHaveBeenCalled();
    expect(getUserFromBearer).not.toHaveBeenCalled();
  });

  it('still serves a demo vehicle when a junk bearer is attached', async () => {
    // An anonymous visitor should not be able to lock themselves out of the
    // public demo by sending a stale token.
    mockHeaders.authorization = 'Bearer nonsense';

    const result = await authorizeVehicleAccess(DEMO_VEHICLE_IDS[0], { intent: 'read' });

    expect(result).toMatchObject({ ok: true, isDemo: true, userId: null });
    expect(getUserFromBearer).not.toHaveBeenCalled();
  });

  it('still refuses to write to a demo vehicle, bearer or not', async () => {
    mockHeaders.authorization = 'Bearer good.token';
    getUserFromBearer.mockResolvedValue({ data: { user: { id: 'user-bearer' } }, error: null });

    const result = await authorizeVehicleAccess(DEMO_VEHICLE_IDS[0], { intent: 'write' });

    expect(result).toMatchObject({ ok: false, status: 403 });
  });
});
