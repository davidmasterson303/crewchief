/**
 * What every mobile screen test needs before it can mount anything.
 *
 * Kept deliberately small. A setup file that stubs half the app produces tests
 * that pass against the stubs — which is the failure `tests-test-real-code.test.ts`
 * exists to prevent in the web suite, and it would be easier to commit here
 * because React Native genuinely does need some mocking.
 *
 * The rule: mock what the **host platform** provides and Node does not. Never
 * mock CrewChief's own modules here — a test that needs `apiRequest` stubbed
 * should say so itself, where the reader can see it.
 */

/* eslint-env jest */

/**
 * ── An un-awaited RNTL call fails the test that made it ─────────────────────
 *
 * **RNTL 14's `render`, `fireEvent` and `userEvent` are all async.** Drop an
 * `await` and the damage is silent, permanent and lands somewhere else:
 *
 * Each of them wraps its work in `React.act`. `act` increments a module-scoped
 * `actScopeDepth`, parks the work on `ReactSharedInternals.actQueue`, and only
 * unwinds both when the thenable it returns is awaited. Two un-awaited calls
 * in the same tick overlap, and the pops then arrive out of order — the last
 * one restores the depth to a *non-zero* value. From that point on every
 * `act()` in the file captures `prevActScopeDepth !== 0`, takes the branch that
 * skips `flushActQueue`, and leaves its render work on a queue nobody drains.
 * `render()` returns a root that never committed and `toJSON()` is `null`.
 *
 * Nothing throws. `contrast.test.tsx` ran blind below one such call from 8 to
 * 15 August 2026, and because its assertions all read
 * `expect(belowFloor(...)).toEqual([])`, every test added there passed on an
 * empty audit. `await act(async () => {})` does not repair it — that call sees
 * the same non-zero depth. Only a fresh module registry clears it, which is
 * why moving a test to another file "fixed" it.
 *
 * So the leak is turned into a failure attributed to the test that caused it.
 * Two signals, because neither alone is complete: React's own warning names the
 * mistake, and the leaked queue catches a corruption React did not warn about
 * (`didWarnNoAwaitAct` is one-shot per registry).
 */
const ACT_LEAK = /overlapping act\(\) calls|without await|call was not awaited/;
const reactInternals =
  require('react').__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

let actWarnings = [];
const passThroughConsoleError = console.error;

console.error = (...args) => {
  if (typeof args[0] === 'string' && ACT_LEAK.test(args[0])) {
    actWarnings.push(args[0].trim());
  }
  passThroughConsoleError(...args);
};

beforeEach(() => {
  actWarnings = [];
});

afterEach(() => {
  const warnings = actWarnings;
  actWarnings = [];

  // Read before asserting: a throw here would leave it set for the next test,
  // which would then fail for a leak it did not cause.
  const leakedQueue = reactInternals?.actQueue ?? null;
  if (reactInternals) reactInternals.actQueue = null;

  if (warnings.length === 0 && leakedQueue === null) return;

  throw new Error(
    "React's act scope was left open by this test, which stops every later " +
      '`render` in this file from committing — they return a tree whose ' +
      '`toJSON()` is null, and an assertion on nothing passes.\n\n' +
      'Await every `render`, `fireEvent.*` and `userEvent.*` call. All three ' +
      'are async in RNTL 14.\n\n' +
      (warnings.length > 0
        ? `React reported:\n  ${warnings.join('\n  ')}`
        : 'React left work queued on `actQueue` without reporting it.')
  );
});

/*
  Native modules with no JS implementation off-device. Each one is required by
  a screen's import graph rather than by the test, so an unmocked one fails at
  collection with an error about the native side being missing — which reads
  as a broken test rather than a missing stub.
*/
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-image-picker', () => ({
  UIImagePickerPreferredAssetRepresentationMode: {
    Automatic: 'automatic',
    Compatible: 'compatible',
    Current: 'current',
  },
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true })),
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true })),
  launchCameraAsync: jest.fn(async () => ({ canceled: true })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true })),
}));

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true })),
  getLastNotificationResponseAsync: jest.fn(async () => null),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
}));

/*
  `expo-constants` carries the app.json `extra` block, which `auth/supabase.ts`
  reads at import and throws without. The values are the public ones already in
  app.json — they identify the project and grant nothing on their own — but
  they are written here rather than imported so a test never depends on which
  deployment the checked-in config happens to point at.
*/
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        apiBaseUrl: 'https://example.test',
        supabaseUrl: 'https://example.supabase.test',
        supabasePublishableKey: 'test-publishable-key',
      },
    },
  },
}));

/*
  The Supabase client opens timers and a websocket at import. Screens reach it
  only through `auth/session`, and none of them should be talking to it
  directly — `mobile-api-only.test.ts` enforces exactly that — so a stub here
  keeps a mounted screen from holding the event loop open after a test ends.
*/
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getSession: jest.fn(async () => ({ data: { session: null } })),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: jest.fn() } } }),
      startAutoRefresh: jest.fn(),
      stopAutoRefresh: jest.fn(),
      signInWithPassword: jest.fn(),
      signOut: jest.fn(),
    },
  }),
}));
