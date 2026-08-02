/**
 * That the keychain adapter is actually wired in.
 *
 * @jest-environment node
 *
 * `mobile-secure-storage.test.ts` proves the chunking adapter is correct. It
 * says nothing about whether anything uses it.
 *
 * That gap is the one worth closing here. Delete `storage: secureStorage` from
 * the client options and supabase-js falls back to its own default — plaintext
 * on the device — so the refresh token, the durable half of the credential,
 * stops being in the Keychain. **All sixteen secure-storage tests keep
 * passing**, because they exercise the module directly rather than checking
 * anything depends on it. So does every session test, because they mock this
 * client entirely.
 *
 * A component of this app could therefore be fully covered, fully green, and
 * storing credentials in the clear. This asserts the wiring itself.
 */

export {};

/*
  The real `secure-storage` is loaded below, on purpose — the identity check is
  the point of this file, and a stub would prove nothing. It imports
  `expo-secure-store`, which ships ESM that Jest will not transform out of
  node_modules, so the native module is stubbed. Its behaviour is not exercised
  here; `mobile-secure-storage.test.ts` does that.
*/
jest.mock(
  'expo-secure-store',
  () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn(), deleteItemAsync: jest.fn() }),
  { virtual: true }
);

const createClient = jest.fn(() => ({ auth: {} }));
jest.mock('@supabase/supabase-js', () => ({ createClient }), { virtual: true });

const expoConfig: { extra: Record<string, unknown> | undefined } = {
  extra: {
    supabaseUrl: 'https://project.supabase.co',
    supabasePublishableKey: 'pk_test',
  },
};

/*
  `__esModule: true` is load-bearing. The module under test does
  `import Constants from 'expo-constants'`, and without the flag Babel's interop
  hands it the whole mock object rather than `.default` — so `Constants.expoConfig`
  is undefined and the module throws "Missing Supabase config".

  That is worth spelling out because of how it presented: the four
  "throws when config is missing" cases below **passed** in that state. They were
  green for the wrong reason entirely — the module threw because the mock was
  malformed, not because the config was absent — and only the six positive
  assertions revealed it. A suite of nothing but negative cases would have shipped.
*/
jest.mock(
  'expo-constants',
  () => ({
    __esModule: true,
    default: {
      get expoConfig() {
        return expoConfig;
      },
    },
  }),
  { virtual: true }
);

/*
  Paths are written out at each call rather than held in constants.
  `tests-test-real-code.test.ts` scans for a literal `require('../…')` to prove a
  suite reaches shipped code and is not merely exercising its own mocks —
  `require(MODULE)` is invisible to it, and it was right to fail: from the
  outside, a suite that only ever requires a variable is indistinguishable from
  one that tests nothing.
*/
/** Import fresh — the module builds its client once, at import. */
function loadClient(): { options: Record<string, any>; url: string; key: string } {
  jest.resetModules();
  createClient.mockClear();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('../../apps/mobile/src/auth/supabase');
  const [url, key, options] = createClient.mock.calls[0] as unknown as [string, string, any];
  return { url, key, options };
}

beforeEach(() => {
  expoConfig.extra = {
    supabaseUrl: 'https://project.supabase.co',
    supabasePublishableKey: 'pk_test',
  };
});

describe('the session goes to the Keychain', () => {
  it('passes the chunking adapter as the auth storage', () => {
    /*
      The assertion this file exists for, and an identity check on purpose:
      `toBe`, not a shape match. A duck-typed object with the right three
      methods would satisfy a structural check while writing somewhere else
      entirely.
    */
    /*
      Order matters, and getting it wrong fails loudly rather than quietly.

      `loadClient` calls `jest.resetModules()`, so a `secureStorage` required
      *before* it comes from the previous registry generation and is a different
      object than the one the client imported — `toBe` then fails on two
      instances of the same correct module. Requiring it after puts both on the
      same generation.
    */
    const { options } = loadClient();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { secureStorage } = require('../../apps/mobile/src/auth/secure-storage');

    expect(options.auth.storage).toBe(secureStorage);
  });

  it('does not fall back to a default storage', () => {
    const { options } = loadClient();
    expect(options.auth.storage).toBeDefined();
    expect(options.auth.storage).not.toBeNull();
  });
});

describe('the options a native client needs', () => {
  it('persists the session across launches', () => {
    // Without this there is nothing to store and the Keychain adapter is
    // pointless — the user signs in again on every cold start.
    expect(loadClient().options.auth.persistSession).toBe(true);
  });

  it('refreshes tokens automatically', () => {
    /*
      Access tokens are short-lived. Without this the app works for an hour and
      then 401s with a session that still looks present, which reads as a server
      bug from the phone. Refresh while backgrounded is handled separately in
      session.ts, and is tested there.
    */
    expect(loadClient().options.auth.autoRefreshToken).toBe(true);
  });

  it('does not look for a session in the URL', () => {
    /*
      That option is for the browser's OAuth redirect flow. Left on in React
      Native the client reaches for `window.location`, which does not exist —
      and `false` here must be explicit, since the library default is true.
    */
    expect(loadClient().options.auth.detectSessionInUrl).toBe(false);
  });
});

describe('configuration comes from app.json', () => {
  it('uses the values under expo.extra', () => {
    const { url, key } = loadClient();
    expect(url).toBe('https://project.supabase.co');
    expect(key).toBe('pk_test');
  });

  it.each([
    ['supabaseUrl', { supabasePublishableKey: 'pk_test' }],
    ['supabasePublishableKey', { supabaseUrl: 'https://project.supabase.co' }],
    ['both', {}],
  ])('throws at import when %s is missing', (_label, extra) => {
    /*
      Thrown at import deliberately. A client built from undefined config fails
      later with an opaque network error, at which point the obvious suspect is
      the network rather than the config — so the failure has to happen where
      the cause is named.
    */
    expoConfig.extra = extra;
    jest.resetModules();

    expect(() => require('../../apps/mobile/src/auth/supabase')).toThrow(/Missing Supabase config/);
  });

  it('throws when extra is absent entirely', () => {
    // `Constants.expoConfig?.extra ?? {}` — the optional chain must not turn a
    // missing config into a client built from undefined.
    expoConfig.extra = undefined;
    jest.resetModules();

    expect(() => require('../../apps/mobile/src/auth/supabase')).toThrow(/Missing Supabase config/);
  });
});
