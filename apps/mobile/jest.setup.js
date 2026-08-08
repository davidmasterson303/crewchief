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
