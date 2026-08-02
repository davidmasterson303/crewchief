/**
 * The only way the phone talks to CrewChief.
 *
 * @jest-environment node
 *
 * `apps/mobile/src/api/client.ts` is the single chokepoint for every mobile
 * request — `mobile-api-only.test.ts` exists to keep it that way, statically.
 * This tests what it actually does.
 *
 * Same placement argument as `mobile-secure-storage.test.ts`: no React and no
 * React Native reach this file once `../auth/session` is mocked, so it runs in
 * the web suite rather than waiting on jest-expo. `../config` is mocked too, so
 * URL assertions do not depend on which deployment the app happens to point at.
 */

/* Module, not a global script — see the note in `mobile-session.test.ts`. */
export {};

jest.mock(
  '../../apps/mobile/src/config',
  () => ({ API_BASE_URL: 'https://example.test', API_PREFIX: '/api/v1' }),
  { virtual: true }
);

const getAccessToken = jest.fn<Promise<string | null>, []>();
jest.mock(
  '../../apps/mobile/src/auth/session',
  () => ({ getAccessToken: () => getAccessToken() }),
  { virtual: true }
);

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { apiRequest, ApiRequestError } = require('../../apps/mobile/src/api/client');

const fetchMock = jest.fn();
global.fetch = fetchMock as unknown as typeof fetch;

/** A `Response`-alike with only the members the client touches. */
function reply(
  status: number,
  body: unknown,
  { unparseable = false }: { unparseable?: boolean } = {}
) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (unparseable) throw new SyntaxError('Unexpected token < in JSON');
      return body;
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  getAccessToken.mockResolvedValue('tok-123');
  fetchMock.mockResolvedValue(reply(200, { ok: true }));
});

describe('the signed-out short circuit', () => {
  it('throws 401 without sending a request', async () => {
    /*
      The behaviour the comment argues for: failing locally rather than
      round-tripping to read back a 401 we already know is coming. Asserting
      `fetch` was not called is the whole point — the thrown error alone would
      pass either way.
    */
    getAccessToken.mockResolvedValue(null);

    await expect(apiRequest('/vehicles')).rejects.toThrow('Not signed in');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does send the request when the endpoint allows anonymous callers', async () => {
    getAccessToken.mockResolvedValue(null);

    await apiRequest('/load-vehicle', { allowAnonymous: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    // No token, so no Authorization header at all — not an empty bearer.
    expect(init.headers.Authorization).toBeUndefined();
  });

  it('reports 401 as unauthorized so callers can route to sign-in', async () => {
    getAccessToken.mockResolvedValue(null);

    await expect(apiRequest('/vehicles')).rejects.toMatchObject({ isUnauthorized: true });
  });
});

describe('the request it builds', () => {
  it('joins base, prefix and path', async () => {
    await apiRequest('/vehicles');
    expect(fetchMock.mock.calls[0][0]).toBe('https://example.test/api/v1/vehicles');
  });

  it('sends the bearer token', async () => {
    await apiRequest('/vehicles');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer tok-123');
  });

  it('fetches the token per request rather than once', async () => {
    /*
      Load-bearing: `getAccessToken` returns the live session and refreshes an
      expired one, so a screen left open overnight must not reuse the token it
      mounted with. If this were hoisted to module scope the second call would
      carry a stale token and 401 — the exact symptom the session module's
      AppState refresher exists to prevent.
    */
    getAccessToken.mockResolvedValueOnce('first').mockResolvedValueOnce('second');

    await apiRequest('/vehicles');
    await apiRequest('/vehicles');

    expect(getAccessToken).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer first');
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer second');
  });

  it('defaults to GET with no body and no Content-Type', async () => {
    await apiRequest('/vehicles');
    const [, init] = fetchMock.mock.calls[0];

    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    expect(init.headers['Content-Type']).toBeUndefined();
  });

  it('serialises a body and declares its type', async () => {
    await apiRequest('/consultant', { method: 'POST', body: { vehicleId: 'v1' } });
    const [, init] = fetchMock.mock.calls[0];

    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.body).toBe('{"vehicleId":"v1"}');
  });

  it('treats an explicit null body as a body', async () => {
    // `body === undefined` is the test in the source, so `null` serialises.
    // Pinned because loosening it to `!body` would silently drop `0`, `''`
    // and `false` payloads too.
    await apiRequest('/thing', { method: 'POST', body: null });
    expect(fetchMock.mock.calls[0][1].body).toBe('null');
  });
});

describe('failures a phone actually hits', () => {
  it('separates an unreachable network from an HTTP error', async () => {
    /*
      Status 0 and a "check your connection" message. A phone loses
      connectivity constantly, and that instruction is actionable where
      "something went wrong" is not.
    */
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));

    await expect(apiRequest('/vehicles')).rejects.toMatchObject({
      status: 0,
      message: 'Could not reach CrewChief. Check your connection.',
    });
  });

  it('surfaces the server’s own message on an HTTP error', async () => {
    // Those messages are written to be shown, and are careful not to leak
    // whether a resource exists.
    fetchMock.mockResolvedValue(reply(404, { error: 'Vehicle not found' }));

    await expect(apiRequest('/load-vehicle')).rejects.toMatchObject({
      status: 404,
      message: 'Vehicle not found',
    });
  });

  it('falls back to the status when the error body is not a string', async () => {
    fetchMock.mockResolvedValue(reply(500, { error: { nested: true } }));

    await expect(apiRequest('/vehicles')).rejects.toMatchObject({
      status: 500,
      message: 'Request failed (500)',
    });
  });

  it('reports the status, not a parse error, when a proxy returns HTML', async () => {
    /*
      The cold-start symptom recorded against /api/version: a 502 from an edge
      proxy arrives as HTML, and `response.json()` throwing on it would surface
      "Unexpected token <" instead of the 502 that actually matters.
    */
    fetchMock.mockResolvedValue(reply(502, null, { unparseable: true }));

    await expect(apiRequest('/vehicles')).rejects.toMatchObject({
      status: 502,
      message: 'Request failed (502)',
    });
  });

  it('does not throw when a successful response has no JSON body', async () => {
    // A 204, or a 200 with an empty body. `readJson` returns null and the
    // caller gets null rather than an exception from the parser.
    fetchMock.mockResolvedValue(reply(200, null, { unparseable: true }));

    await expect(apiRequest('/thing')).resolves.toBeNull();
  });

  it('is an ApiRequestError, named, in every failure path', async () => {
    // Callers branch on `instanceof` and on `.name`; SignedInScreen reads
    // `.status` off it directly.
    fetchMock.mockRejectedValue(new TypeError('down'));

    const error = await apiRequest('/vehicles').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect((error as Error).name).toBe('ApiRequestError');
  });

  it('marks only 401 as unauthorized', async () => {
    for (const [status, expected] of [[401, true], [403, false], [500, false]] as const) {
      fetchMock.mockResolvedValue(reply(status, { error: 'no' }));
      await expect(apiRequest('/vehicles')).rejects.toMatchObject({
        isUnauthorized: expected,
      });
    }
  });
});
