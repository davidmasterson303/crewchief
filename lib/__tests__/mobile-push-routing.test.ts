/**
 * A notification can open a screen. It must not open the internet.
 *
 * @jest-environment node
 *
 * Phase 5 routes a tapped push through the navigator's existing `linking`
 * config by reading `data.url` off the payload. That field is the one input in
 * the mobile client that **arrives over the network and is then acted on**, so
 * it is the one place an open redirect could exist: an `https://` value there
 * would send someone to an arbitrary website from a notification that looks
 * like it came from their own garage.
 *
 * `notificationUrl` is therefore an allowlist of one scheme, and this is what
 * holds it there.
 *
 * The cold-start reader is covered too, because it is the journey that gets
 * missed. An app opened *by* a notification tap has no `Linking` url — it was
 * not opened by a link — so a client that only listens for taps at runtime
 * routes perfectly while backgrounded and does nothing at all from cold.
 */

/* Module, not a global script — see the note in `mobile-session.test.ts`. */
export {};

const getLastNotificationResponseAsync = jest.fn();
const addNotificationResponseReceivedListener = jest.fn();

jest.mock(
  'expo-notifications',
  () => ({
    setNotificationHandler: jest.fn(),
    getPermissionsAsync: jest.fn(),
    requestPermissionsAsync: jest.fn(),
    getLastNotificationResponseAsync: () => getLastNotificationResponseAsync(),
    addNotificationResponseReceivedListener: (handler: unknown) =>
      addNotificationResponseReceivedListener(handler),
  }),
  { virtual: true }
);

/* eslint-disable @typescript-eslint/no-var-requires */
const {
  notificationUrl,
  initialNotificationUrl,
  subscribeToNotificationTaps,
} = require('../../apps/mobile/src/notifications/push');
/* eslint-enable @typescript-eslint/no-var-requires */

/** A notification carrying `data.url`, shaped as expo-notifications delivers it. */
function notification(data: unknown) {
  return { request: { content: { data } } };
}

beforeEach(() => jest.clearAllMocks());

describe('notificationUrl', () => {
  it('accepts an in-app link', () => {
    expect(notificationUrl(notification({ url: 'crewchief://vehicle/abc/advisor' }))).toBe(
      'crewchief://vehicle/abc/advisor'
    );
  });

  it.each([
    ['https://evil.example/phish', 'a website'],
    ['http://evil.example', 'an insecure website'],
    ['javascript:alert(1)', 'a script url'],
    ['file:///etc/passwd', 'a local file'],
    ['CREWCHIEF://vehicle/abc', 'a case-shifted scheme'],
    [' crewchief://vehicle/abc', 'a leading space that hides the scheme'],
    ['//crewchief://vehicle/abc', 'a protocol-relative prefix'],
  ])('refuses %s (%s)', (url) => {
    /*
      Each of these would otherwise be handed to the navigator's linking
      handler. The case-shifted and space-prefixed ones matter most: they are
      what a filter written with `includes('crewchief://')` would let through,
      and `startsWith` on the raw string is what makes them fail.
    */
    expect(notificationUrl(notification({ url }))).toBeNull();
  });

  /*
    Typed as `unknown[][]` rather than left to inference. `it.each` widens a
    heterogeneous table into a union of tuples, and a callback taking fewer
    parameters than the widest row fails `tsc --noEmit` while passing under
    Jest's transform — the same green-here-red-there shape this project keeps
    hitting.
  */
  const malformed: unknown[][] = [
    [undefined, 'no data at all'],
    [{}, 'data without a url'],
    [{ url: 42 }, 'a non-string url'],
    [{ url: null }, 'a null url'],
  ];

  it.each(malformed)('returns null for %s (%s)', (data) => {
    expect(notificationUrl(notification(data))).toBeNull();
  });

  it('survives a malformed notification rather than throwing', () => {
    // These arrive from the OS, not from us. A throw here happens inside a
    // navigation listener where nothing is going to catch it.
    expect(notificationUrl(null)).toBeNull();
    expect(notificationUrl(undefined)).toBeNull();
    expect(notificationUrl({} as never)).toBeNull();
  });
});

describe('initialNotificationUrl — the cold start', () => {
  it('reads the notification the app was opened by', async () => {
    getLastNotificationResponseAsync.mockResolvedValue({
      notification: notification({ url: 'crewchief://vehicle/xyz' }),
    });

    await expect(initialNotificationUrl()).resolves.toBe('crewchief://vehicle/xyz');
  });

  it('returns null when the app was opened normally', async () => {
    getLastNotificationResponseAsync.mockResolvedValue(null);
    await expect(initialNotificationUrl()).resolves.toBeNull();
  });

  it('applies the same scheme rule as a live tap', async () => {
    // The cold path is a second entry point for the same untrusted field, and
    // is exactly where a duplicated check would drift.
    getLastNotificationResponseAsync.mockResolvedValue({
      notification: notification({ url: 'https://evil.example' }),
    });

    await expect(initialNotificationUrl()).resolves.toBeNull();
  });

  it('does not take the app down if the OS call fails', async () => {
    getLastNotificationResponseAsync.mockRejectedValue(new Error('no notification centre'));
    await expect(initialNotificationUrl()).resolves.toBeNull();
  });
});

describe('subscribeToNotificationTaps', () => {
  it('forwards a valid url and unsubscribes cleanly', () => {
    const remove = jest.fn();
    let captured: ((response: unknown) => void) | undefined;
    addNotificationResponseReceivedListener.mockImplementation((handler: (r: unknown) => void) => {
      captured = handler;
      return { remove };
    });

    const handler = jest.fn();
    const unsubscribe = subscribeToNotificationTaps(handler);

    captured?.({ notification: notification({ url: 'crewchief://garage' }) });
    expect(handler).toHaveBeenCalledWith('crewchief://garage');

    // A url that fails the scheme rule must not reach the navigator at all.
    handler.mockClear();
    captured?.({ notification: notification({ url: 'https://evil.example' }) });
    expect(handler).not.toHaveBeenCalled();

    unsubscribe();
    expect(remove).toHaveBeenCalled();
  });
});
