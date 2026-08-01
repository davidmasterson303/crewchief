/**
 * Session lifetime, and the sign-in screen's refusal to answer questions.
 *
 * @jest-environment node
 *
 * `apps/mobile/src/auth/session.ts` is the last untested module in the mobile
 * auth stack. Two of its behaviours are not conveniences:
 *
 *   - `signIn` collapses every credential failure into one message, so the
 *     screen cannot be used to discover which email addresses have accounts.
 *   - `startSessionAutoRefresh` drives Supabase's refresher off AppState,
 *     because a timer in a backgrounded React Native app does not fire. An app
 *     left overnight otherwise wakes with an expired token and a refresh that
 *     never ran, and the first request 401s.
 *
 * This one mocks `react-native` as well as `./supabase`. That mock is a stub of
 * AppState and nothing more — a component test still needs jest-expo, and this
 * is deliberately not one.
 */

/*
  Marks this file a module rather than a global script.

  Without it, every `const` here lands in the global scope that all
  `@jest-environment node` test files share, and `getAccessToken` collides with
  the mock of the same name in `mobile-api-client.test.ts`. Jest runs each file
  in its own context and stays green; only `tsc` sees the clash — which is why
  it appeared as a typecheck error against passing tests.
*/
export {};

type AppStateHandler = (state: string) => void;

const appState = {
  currentState: 'active',
  handlers: [] as AppStateHandler[],
  remove: jest.fn(),
};

jest.mock(
  'react-native',
  () => ({
    AppState: {
      get currentState() {
        return appState.currentState;
      },
      addEventListener: (_event: string, handler: AppStateHandler) => {
        appState.handlers.push(handler);
        return { remove: appState.remove };
      },
    },
  }),
  { virtual: true }
);

const auth = {
  signInWithPassword: jest.fn(),
  signOut: jest.fn(),
  getSession: jest.fn(),
  onAuthStateChange: jest.fn(),
  startAutoRefresh: jest.fn(),
  stopAutoRefresh: jest.fn(),
  resend: jest.fn(),
};

jest.mock('../../apps/mobile/src/auth/supabase', () => ({ supabase: { auth } }), {
  virtual: true,
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  signIn,
  signOut,
  getAccessToken,
  onSessionChange,
  startSessionAutoRefresh,
  resendConfirmation,
} = require('../../apps/mobile/src/auth/session');

beforeEach(() => {
  jest.clearAllMocks();
  appState.currentState = 'active';
  appState.handlers = [];
  auth.signInWithPassword.mockResolvedValue({ error: null });
  auth.getSession.mockResolvedValue({ data: { session: null } });
  auth.onAuthStateChange.mockReturnValue({
    data: { subscription: { unsubscribe: jest.fn() } },
  });
  auth.resend.mockResolvedValue({ error: null });
});

describe('resendConfirmation stays silent about who exists', () => {
  /*
    `signIn` collapses "Email not confirmed" into the generic message, which is
    correct and — with confirmation disabled on this project — currently free.
    Flip that toggle and an unconfirmed user has no way forward.

    The tempting fix is a resend button shown for that case. It would move the
    oracle rather than close it: a button appearing only for
    registered-but-unconfirmed addresses announces exactly which those are. So
    the capability is unconditional, and these pin that it cannot start
    reporting.
  */
  it('resolves identically whether or not the address exists', async () => {
    auth.resend.mockResolvedValue({ error: null });
    await expect(resendConfirmation('real@example.com')).resolves.toBeUndefined();

    auth.resend.mockResolvedValue({ error: { message: 'User not found' } });
    await expect(resendConfirmation('nobody@example.com')).resolves.toBeUndefined();
  });

  it('swallows a rejected call rather than surfacing it', async () => {
    // Including a network failure. Nothing here is actionable by the user, and
    // anything returned is something a caller could render.
    auth.resend.mockRejectedValue(new Error('Network request failed'));
    await expect(resendConfirmation('a@b.co')).resolves.toBeUndefined();
  });

  it('returns nothing at all, so there is no result to branch on', async () => {
    /*
      The shape is the guard. A boolean or a status here would be rendered
      conditionally by some caller eventually, and that conditional is the leak
      coming back.
    */
    auth.resend.mockResolvedValue({ error: null });
    expect(await resendConfirmation('a@b.co')).toBeUndefined();
  });

  it('asks for a signup confirmation, with the email trimmed', async () => {
    await resendConfirmation('  someone@example.com  ');
    expect(auth.resend).toHaveBeenCalledWith({
      type: 'signup',
      email: 'someone@example.com',
    });
  });
});

describe('signIn exposes no confirmation state', () => {
  it('reports nothing beyond ok and error, even for an unconfirmed account', async () => {
    /*
      The regression this blocks: adding `needsConfirmation` so the screen can
      show the resend button only when it is relevant. That flag exists solely
      to be rendered conditionally, and the conditional is the oracle.
    */
    auth.signInWithPassword.mockResolvedValue({ error: { message: 'Email not confirmed' } });

    const result = await signIn('a@b.co', 'pw');

    expect(Object.keys(result).sort()).toEqual(['error', 'ok']);
    expect(result.error).toBe('That email and password did not match.');
  });
});

describe('signIn does not become an account-existence oracle', () => {
  /*
    Supabase distinguishes "no such user" from "wrong password" in some
    configurations. Relaying that turns the sign-in screen into a way to test
    whether an address has an account — the same reason `lib/api-auth.ts` makes
    "not found" and "not yours" indistinguishable.

    Every one of these must produce the identical string.
  */
  const CREDENTIAL_FAILURES = [
    'Invalid login credentials',
    'User not found',
    'Email not confirmed',
    'Invalid password',
  ];

  it.each(CREDENTIAL_FAILURES)('says the same thing for "%s"', async (message) => {
    auth.signInWithPassword.mockResolvedValue({ error: { message } });

    const result = await signIn('someone@example.com', 'pw');

    expect(result.ok).toBe(false);
    expect(result.error).toBe('That email and password did not match.');
  });

  it('returns one distinct message across all of them, not several', async () => {
    // Asserting each in turn would still pass if two happened to differ from a
    // fifth case added later. This pins the property itself: one message.
    const messages = new Set<string>();
    for (const message of CREDENTIAL_FAILURES) {
      auth.signInWithPassword.mockResolvedValue({ error: { message } });
      messages.add((await signIn('a@b.co', 'pw')).error!);
    }
    expect(messages.size).toBe(1);
  });

  it('never echoes the provider’s wording back to the screen', async () => {
    auth.signInWithPassword.mockResolvedValue({ error: { message: 'User not found' } });
    const result = await signIn('a@b.co', 'pw');
    expect(result.error).not.toMatch(/not found/i);
  });
});

describe('signIn distinguishes the one failure the user can act on', () => {
  it.each(['Network request failed', 'fetch failed', 'Request timeout'])(
    'treats "%s" as connectivity',
    async (message) => {
      /*
        Telling someone "check your details" when the Wi-Fi is off is actively
        misleading — they will retype a correct password until they give up.
      */
      auth.signInWithPassword.mockResolvedValue({ error: { message } });

      const result = await signIn('a@b.co', 'pw');

      expect(result.error).toBe(
        'Could not reach CrewChief. Check your connection and try again.'
      );
    }
  );

  it('does not mistake a credential failure for a network one', async () => {
    // The matcher is a regex over the provider's message; this is the
    // false-positive direction.
    auth.signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } });
    const result = await signIn('a@b.co', 'pw');
    expect(result.error).toBe('That email and password did not match.');
  });
});

describe('signIn input handling', () => {
  it('trims the email', async () => {
    // Keyboards on iOS append a space after autocomplete often enough that
    // this is the difference between signing in and not.
    await signIn('  someone@example.com  ', 'pw');
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'someone@example.com',
      password: 'pw',
    });
  });

  it('does not trim the password', async () => {
    // A leading or trailing space is a legitimate character in a password, and
    // silently stripping it locks the user out of an account they can reach
    // from the web.
    await signIn('a@b.co', '  spaced  ');
    expect(auth.signInWithPassword.mock.calls[0][0].password).toBe('  spaced  ');
  });

  it('reports success without an error field', async () => {
    await expect(signIn('a@b.co', 'pw')).resolves.toEqual({ ok: true });
  });
});

describe('getAccessToken reads the live session', () => {
  it('returns the token when there is a session', async () => {
    auth.getSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } });
    await expect(getAccessToken()).resolves.toBe('tok');
  });

  it('returns null rather than undefined when signed out', async () => {
    // `apiRequest` branches on `!token`; undefined would work by accident and
    // the declared return type says null.
    auth.getSession.mockResolvedValue({ data: { session: null } });
    await expect(getAccessToken()).resolves.toBeNull();
  });

  it('asks Supabase every time instead of caching', async () => {
    /*
      `getSession()` returns the live session and refreshes an expired one. A
      cached copy here would defeat that for every API call in the app, which
      is the whole reason the client fetches the token per request.
    */
    await getAccessToken();
    await getAccessToken();
    expect(auth.getSession).toHaveBeenCalledTimes(2);
  });
});

describe('startSessionAutoRefresh', () => {
  it('acts on the state the app is already in', () => {
    /*
      AppState does not fire for the current state, so a listener alone would
      leave the refresher stopped until the app was next backgrounded — the
      exact window this function exists to close.
    */
    appState.currentState = 'active';
    startSessionAutoRefresh();
    expect(auth.startAutoRefresh).toHaveBeenCalledTimes(1);
  });

  it('starts refreshing when the app returns to the foreground', () => {
    appState.currentState = 'background';
    startSessionAutoRefresh();
    expect(auth.stopAutoRefresh).toHaveBeenCalledTimes(1);
    expect(auth.startAutoRefresh).not.toHaveBeenCalled();

    appState.handlers.forEach((h) => h('active'));
    expect(auth.startAutoRefresh).toHaveBeenCalledTimes(1);
  });

  it.each(['background', 'inactive'])('stops refreshing on %s', (state) => {
    startSessionAutoRefresh();
    jest.clearAllMocks();

    appState.handlers.forEach((h) => h(state));
    expect(auth.stopAutoRefresh).toHaveBeenCalledTimes(1);
    expect(auth.startAutoRefresh).not.toHaveBeenCalled();
  });

  it('removes its listener on cleanup', () => {
    // Returned to the root component's effect. Leaking it would stack a
    // refresher per remount.
    const stop = startSessionAutoRefresh();
    stop();
    expect(appState.remove).toHaveBeenCalledTimes(1);
  });
});

describe('the rest of the surface', () => {
  it('signOut ends the Supabase session', async () => {
    await signOut();
    expect(auth.signOut).toHaveBeenCalledTimes(1);
  });

  it('onSessionChange forwards the session and returns an unsubscribe', () => {
    const unsubscribe = jest.fn();
    let emit: (event: string, session: unknown) => void = () => {};
    auth.onAuthStateChange.mockImplementation((cb: typeof emit) => {
      emit = cb;
      return { data: { subscription: { unsubscribe } } };
    });

    const handler = jest.fn();
    const stop = onSessionChange(handler);

    emit('SIGNED_IN', { access_token: 'tok' });
    expect(handler).toHaveBeenCalledWith({ access_token: 'tok' });

    // The event name is deliberately dropped — callers care about the session.
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]).toHaveLength(1);

    stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
