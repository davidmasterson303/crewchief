import { render, userEvent } from '@testing-library/react-native';

import { SignInScreen } from '../SignInScreen';
import { resetPassword, signIn, signUp } from '../../auth/session';

/**
 * The front door.
 *
 * This is the first screen an App Store reviewer sees and, since 8 Aug, the
 * only place a person can become a CrewChief user at all — the web no longer
 * carries enrollment. A defect here is not a degraded experience, it is a
 * product nobody can enter.
 *
 * It had no behaviour coverage. `contrast.test.tsx` mounts it and measures its
 * colours, which proves it renders and says nothing about what it does.
 *
 * ── What is mocked, and what deliberately is not ────────────────────────────
 *
 * `auth/session` is mocked at the `signIn`/`signUp` boundary — those call
 * Supabase, and the thing worth testing is which one this screen calls, with
 * what, and what it does with each shape of answer.
 *
 * The **mode switch is not mocked at all**, because it is state in this
 * component and it is where the interesting bug lives: a screen that reads
 * "Create account" while calling `signIn` looks completely correct in a
 * screenshot.
 *
 * `userEvent` throughout, never `fireEvent` — see `AddVehicleScreen.test.tsx`
 * for why the latter silently does nothing under React 19's concurrent render.
 */

jest.mock('../../auth/session', () => ({
  signIn: jest.fn(),
  signUp: jest.fn(),
  resetPassword: jest.fn(),
}));

/*
  Not mocked in `jest.setup.js` because it is CrewChief's own module, and that
  file's rule is to stub only what the host platform provides. Stubbed here,
  where a reader can see it: `hasDevCredentials` reads an EXPO_PUBLIC value
  behind a `__DEV__` guard, and a dev build with credentials in `.env` would
  otherwise fire an automatic sign-in in the middle of every test below.
*/
jest.mock('../../auth/dev-session', () => ({
  hasDevCredentials: () => false,
  signInWithDevCredentials: jest.fn(),
}));

const mockSignIn = signIn as jest.MockedFunction<typeof signIn>;
const mockSignUp = signUp as jest.MockedFunction<typeof signUp>;
const mockResetPassword = resetPassword as jest.MockedFunction<typeof resetPassword>;

async function fill(
  user: ReturnType<typeof userEvent.setup>,
  view: Awaited<ReturnType<typeof render>>,
  email = 'owner@example.test',
  password = 'correct-horse'
) {
  await user.type(view.getByPlaceholderText('Email'), email);
  await user.type(view.getByPlaceholderText('Password'), password);
}

beforeEach(() => {
  mockSignIn.mockReset();
  mockSignUp.mockReset();
  mockResetPassword.mockReset();
  mockSignIn.mockResolvedValue({ ok: true });
  mockSignUp.mockResolvedValue({ ok: true });
  mockResetPassword.mockResolvedValue({ ok: true });
});

describe('what a screen reader finds', () => {
  /*
    The front door is the one screen where an unlabelled field is
    unrecoverable — there is nothing before it to go back to.
  */

  it('names both fields, rather than relying on the placeholder', () => {
    // A placeholder is announced as the field's *value* when empty and
    // disappears entirely once someone types, leaving two unnamed boxes.
    const view = render(<SignInScreen />);

    return view.then((resolved) => {
      expect(resolved.getByLabelText('Email')).toBeTruthy();
      expect(resolved.getByLabelText('Password')).toBeTruthy();
    });
  });

  it('keeps the submit button named while it is working', async () => {
    /*
      The `<Text>` naming this button is swapped for a spinner while `busy`, so
      without an explicit label the control goes silent at exactly the moment
      it has something to say. `mobile-busy-controls-named.test.ts` holds the
      rule across every screen; this proves it on the one that matters most.
    */
    const user = userEvent.setup();
    let release: (value: { ok: true }) => void = () => {};
    mockSignIn.mockReturnValue(
      new Promise<{ ok: true }>((resolve) => {
        release = resolve;
      })
    );

    const view = await render(<SignInScreen />);
    await fill(user, view);
    await user.press(view.getByLabelText('Sign in'));

    // Mid-flight: the label text is gone from the tree, the name is not.
    expect(view.queryByText('Sign in')).toBeNull();
    const button = view.getByLabelText('Sign in');
    expect(button.props.accessibilityState).toMatchObject({ busy: true });

    release({ ok: true });
  });

  it('renames itself in sign-up mode', async () => {
    // A label frozen at "Sign in" would be worse than none — it would announce
    // the wrong action with total confidence.
    const user = userEvent.setup();
    const view = await render(<SignInScreen />);

    await user.press(view.getByText('New here? Create an account'));

    expect(view.getByLabelText('Create account')).toBeTruthy();
    expect(view.queryByLabelText('Sign in')).toBeNull();
  });
});

describe('signing in', () => {
  it('calls signIn with what was typed', async () => {
    const user = userEvent.setup();
    const view = await render(<SignInScreen />);

    await fill(user, view);
    await user.press(view.getByText('Sign in'));

    expect(mockSignIn).toHaveBeenCalledWith('owner@example.test', 'correct-horse');
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  it('does nothing until both fields have something in them', async () => {
    /*
      Paired with the case above, which proves the same press *does* submit
      when the form is complete. Without that pair this passes for a form that
      is simply broken.
    */
    const user = userEvent.setup();
    const view = await render(<SignInScreen />);

    await user.type(view.getByPlaceholderText('Email'), 'owner@example.test');
    await user.press(view.getByText('Sign in'));

    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it('shows why a sign-in failed', async () => {
    const user = userEvent.setup();
    mockSignIn.mockResolvedValue({ ok: false, error: 'Email or password did not match' });

    const view = await render(<SignInScreen />);
    await fill(user, view);
    await user.press(view.getByText('Sign in'));

    expect(await view.findByText('Email or password did not match')).toBeTruthy();
  });

  it('stays usable after a failure, rather than stranding someone on a spinner', async () => {
    // `busy` has to be cleared on the failure path. Left set, the button is
    // disabled forever and the only way out is force-quitting the app.
    const user = userEvent.setup();
    mockSignIn.mockResolvedValue({ ok: false, error: 'Email or password did not match' });

    const view = await render(<SignInScreen />);
    await fill(user, view);
    await user.press(view.getByText('Sign in'));
    await view.findByText('Email or password did not match');

    await user.press(view.getByText('Sign in'));

    expect(mockSignIn).toHaveBeenCalledTimes(2);
  });
});

describe('creating an account', () => {
  it('switches to sign-up and calls signUp, not signIn', async () => {
    /*
      The bug worth the whole file. A screen whose label says "Create account"
      while it calls `signIn` is indistinguishable from a correct one in a
      screenshot, in a typecheck, and in a contrast audit — and it means nobody
      can ever join.
    */
    const user = userEvent.setup();
    const view = await render(<SignInScreen />);

    await user.press(view.getByText('New here? Create an account'));
    await fill(user, view);
    await user.press(view.getByText('Create account'));

    expect(mockSignUp).toHaveBeenCalledWith('owner@example.test', 'correct-horse');
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it('changes what the screen says, not just what it does', async () => {
    const user = userEvent.setup();
    const view = await render(<SignInScreen />);

    expect(view.getByText('Sign in to your garage')).toBeTruthy();

    await user.press(view.getByText('New here? Create an account'));

    expect(view.getByText('Create your garage')).toBeTruthy();
    expect(view.getByText('Already have an account? Sign in')).toBeTruthy();
  });

  it('goes back to sign-in when asked', async () => {
    // A one-way switch would trap someone who tapped it by accident.
    const user = userEvent.setup();
    const view = await render(<SignInScreen />);

    await user.press(view.getByText('New here? Create an account'));
    await user.press(view.getByText('Already have an account? Sign in'));

    await fill(user, view);
    await user.press(view.getByText('Sign in'));

    expect(mockSignIn).toHaveBeenCalledTimes(1);
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  it('surfaces Supabase-s own reason rather than one flat sentence', async () => {
    /*
      Deliberate asymmetry with sign-in. "Password too short", "already
      registered" and "invalid email" each need a different action from the
      person reading them; a generic message sends them round the same loop.
    */
    const user = userEvent.setup();
    mockSignUp.mockResolvedValue({ ok: false, error: 'Password should be at least 6 characters' });

    const view = await render(<SignInScreen />);
    await user.press(view.getByText('New here? Create an account'));
    await fill(user, view, 'owner@example.test', 'short');
    await user.press(view.getByText('Create account'));

    expect(await view.findByText('Password should be at least 6 characters')).toBeTruthy();
  });
});

describe('when the project requires email confirmation', () => {
  /*
    ⚠ Whether confirmation is on is a Supabase dashboard setting, not anything
    in this repo — so this cannot assert which path production takes. What it
    can assert is that **both paths are handled**, because the difference is
    invisible until a real account is created against a real project.

    It matters for submission: with confirmation on, a reviewer who signs up
    gets an email they cannot read on a device they do not own. The answer is
    demo credentials in App Store Connect rather than a code change — but that
    is a decision someone has to make before review, not during it.
  */

  it('tells the person what happened instead of appearing to do nothing', async () => {
    // No session comes back, so nothing swaps this screen out. Without an
    // explicit notice, the button looks broken.
    const user = userEvent.setup();
    mockSignUp.mockResolvedValue({ ok: true, needsConfirmation: true });

    const view = await render(<SignInScreen />);
    await user.press(view.getByText('New here? Create an account'));
    await fill(user, view);
    await user.press(view.getByText('Create account'));

    expect(await view.findByText(/check your email/i)).toBeTruthy();
  });

  it('drops them back into sign-in, which is where they need to go next', async () => {
    const user = userEvent.setup();
    mockSignUp.mockResolvedValue({ ok: true, needsConfirmation: true });

    const view = await render(<SignInScreen />);
    await user.press(view.getByText('New here? Create an account'));
    await fill(user, view);
    await user.press(view.getByText('Create account'));

    await view.findByText(/check your email/i);
    expect(view.getByText('Sign in to your garage')).toBeTruthy();
  });

  it('clears the password so the field is not left holding one', async () => {
    const user = userEvent.setup();
    mockSignUp.mockResolvedValue({ ok: true, needsConfirmation: true });

    const view = await render(<SignInScreen />);
    await user.press(view.getByText('New here? Create an account'));
    await fill(user, view);
    await user.press(view.getByText('Create account'));

    await view.findByText(/check your email/i);
    expect(view.getByPlaceholderText('Password').props.value).toBe('');
  });

  it('leaves the screen usable, so they can sign in once confirmed', async () => {
    // `busy` cleared on this path too. It is the one success branch that does
    // *not* unmount the screen, which is exactly why it is easy to miss.
    const user = userEvent.setup();
    mockSignUp.mockResolvedValue({ ok: true, needsConfirmation: true });

    const view = await render(<SignInScreen />);
    await user.press(view.getByText('New here? Create an account'));
    await fill(user, view);
    await user.press(view.getByText('Create account'));
    await view.findByText(/check your email/i);

    await user.type(view.getByPlaceholderText('Password'), 'correct-horse');
    await user.press(view.getByText('Sign in'));

    expect(mockSignIn).toHaveBeenCalledTimes(1);
  });
});

describe('the documents somebody is agreeing to', () => {
  /*
    Added 14 Aug, with the pages themselves — neither existed anywhere in this
    product before then, so an account was created against terms nobody could
    read. Apple's 3.1.2 wants both reachable in the binary once subscriptions
    ship; this puts them at the moment consent is actually given.
  */

  it('names both documents while creating an account', async () => {
    const user = userEvent.setup();
    const view = await render(<SignInScreen />);

    await user.press(view.getByText('New here? Create an account'));

    expect(view.getByText('Terms of Use')).toBeTruthy();
    expect(view.getByText('Privacy Policy')).toBeTruthy();
  });

  it('does not claim agreement on the sign-in form', async () => {
    // Signing in is not the moment consent is given, and a sentence saying it
    // is would be a false statement on the screen a reviewer opens first.
    const view = await render(<SignInScreen />);

    expect(view.queryByText('Terms of Use')).toBeNull();
    expect(view.queryByText('Privacy Policy')).toBeNull();
  });

  it('tells a screen reader that both leave the app', async () => {
    const user = userEvent.setup();
    const view = await render(<SignInScreen />);

    await user.press(view.getByText('New here? Create an account'));

    expect(view.getByLabelText('Terms of Use, opens in your browser')).toBeTruthy();
    expect(view.getByLabelText('Privacy Policy, opens in your browser')).toBeTruthy();
  });
});

describe('the way back in when the password is gone', () => {
  /*
    Added 14 Aug. The web app has had `/forgot-password` since before the pivot
    and this screen had no route to it — so on a mobile-first product the only
    recovery from a mistyped password was to know, from somewhere outside the
    app, to go and use a website.

    The interesting risk here is not whether the email sends. It is that a
    reset control on an unauthenticated screen can answer "does this person
    have an account", which is the oracle `signIn` is deliberately written to
    avoid. These tests hold that line.
  */

  it('offers a way back on the sign-in form', async () => {
    const view = await render(<SignInScreen />);

    expect(view.getByText('Forgot your password?')).toBeTruthy();
  });

  it('does not offer it while creating an account', async () => {
    // There is no password to have forgotten yet, and asking to reset one for
    // an address with no account is the oracle question in another costume.
    const user = userEvent.setup();
    const view = await render(<SignInScreen />);

    await user.press(view.getByText('New here? Create an account'));

    expect(view.queryByText('Forgot your password?')).toBeNull();
  });

  it('sends the reset for whatever address is in the field', async () => {
    const user = userEvent.setup();
    const view = await render(<SignInScreen />);

    await user.type(view.getByPlaceholderText('Email'), 'owner@example.test');
    await user.press(view.getByText('Forgot your password?'));

    expect(mockResetPassword).toHaveBeenCalledWith('owner@example.test');
  });

  it('does not require a password to recover a forgotten password', async () => {
    /*
      The submit button is gated on both fields. If this control were gated the
      same way it would be unreachable by the only people who need it — which
      is the loop it exists to break, and it would have looked fine in every
      screenshot.
    */
    const user = userEvent.setup();
    const view = await render(<SignInScreen />);

    await user.type(view.getByPlaceholderText('Email'), 'owner@example.test');
    await user.press(view.getByText('Forgot your password?'));

    expect(mockResetPassword).toHaveBeenCalledTimes(1);
    expect(view.getByPlaceholderText('Password').props.value).toBe('');
  });

  it('never says whether the address has an account', async () => {
    /*
      The one assertion in this block that is about security rather than
      behaviour. Supabase answers identically for a known and an unknown
      address; if this screen ever starts distinguishing them, anyone who
      downloads the app can enumerate CrewChief's users.
    */
    const user = userEvent.setup();
    const view = await render(<SignInScreen />);

    await user.type(view.getByPlaceholderText('Email'), 'stranger@example.test');
    await user.press(view.getByText('Forgot your password?'));

    const notice = await view.findByText(/reset link is on its way/i);
    expect(notice).toBeTruthy();
    // "If that address has an account" — conditional, never a confirmation.
    expect(notice.props.children).toMatch(/^if /i);
    expect(notice.props.children).not.toMatch(/we (sent|found)|your account|that account/i);
  });

  it('says what to do when the field is empty rather than sending nothing', async () => {
    const user = userEvent.setup();
    mockResetPassword.mockResolvedValue({
      ok: false,
      error: 'Enter your email address first.',
    });

    const view = await render(<SignInScreen />);
    await user.press(view.getByText('Forgot your password?'));

    expect(await view.findByText('Enter your email address first.')).toBeTruthy();
  });
});
