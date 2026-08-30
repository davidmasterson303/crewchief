import { render, userEvent, waitFor } from '@testing-library/react-native';

import { AccountScreen } from '../AccountScreen';
import { deleteAccount, getSubscription } from '../../api/account';
import { ApiRequestError } from '../../api/client';
import { DELETION_CONFIRM_PHRASE } from '@wellkept/core/account-deletion';

/**
 * The one irreversible thing this app can do.
 *
 * App Store guideline 5.1.1(v) requires account deletion to be reachable from
 * inside the app, and `mobile-account-reachable.test.ts` holds the *reachable*
 * half. This holds the half that matters more once someone arrives: that the
 * confirmation gate actually gates, and that the failure paths do not leave
 * someone believing their account is gone when it is not — or worse, still
 * signed in when it is.
 *
 * It had no behaviour coverage at all. Every rule below was enforced only by
 * reading the component.
 *
 * ── Why the confirm phrase is imported, not typed ───────────────────────────
 *
 * `DELETION_CONFIRM_PHRASE` comes from `@wellkept/core/account-deletion`, the
 * same module the screen uses. Writing `'DELETE'` as a literal here would let
 * the phrase change in core and leave this suite green against a screen asking
 * for something else — a test that passes while the product it describes has
 * moved. The same reason `contrast.test.tsx` imports its floor.
 */

jest.mock('../../api/account', () => ({
  deleteAccount: jest.fn(),
  getSubscription: jest.fn(),
}));

const mockDelete = deleteAccount as jest.MockedFunction<typeof deleteAccount>;
const mockSubscription = getSubscription as jest.MockedFunction<typeof getSubscription>;

/**
 * Built from the constant, exactly as the screen builds it.
 *
 * Hardcoding "Type DELETE to confirm account deletion" would let the phrase
 * change in core and leave this suite failing for a reason that has nothing to
 * do with the behaviour it tests — or, worse, quietly matching the wrong field.
 */
const CONFIRM_FIELD = `Type ${DELETION_CONFIRM_PHRASE} to confirm account deletion`;

function mount(overrides: Partial<Parameters<typeof AccountScreen>[0]> = {}) {
  /*
    The callbacks stay `jest.Mock` rather than widening to the prop's own
    signature. Spreading `overrides` into them types each as a union, and the
    assertions below read `.mock.calls` — which the union does not have.
  */
  const props = {
    visible: true,
    email: 'owner@example.test',
    // Rendered only under `__DEV__`, and never asserted on here — see `DevToken`.
    accessToken: 'test-token',
    ...overrides,
    onClose: jest.fn(),
    onSignOut: jest.fn(),
    onDeleted: jest.fn(),
  };
  return { props, view: render(<AccountScreen {...props} />) };
}

beforeEach(() => {
  mockDelete.mockReset();
  mockDelete.mockResolvedValue({ deleted: { vehicles: 2, storageObjects: 5 } } as never);
  mockSubscription.mockReset();
  // The default is the ordinary account: nothing bought, nothing to warn about.
  mockSubscription.mockResolvedValue({ live: false, certain: true });
});

describe('the confirmation gate', () => {
  /*
    ── ⚠ Read this before mutation-testing this block ────────────────────────

    The gate is **two layers**, and that is deliberate:

      1. `disabled={!confirmed || deleting}` on the Pressable — the press never
         reaches the handler.
      2. `if (!confirmed || deleting) return;` at the top of `handleDelete` —
         the handler refuses regardless of how it was called.

    So removing *either one alone leaves this block green*, because the other
    still holds. Measured, not assumed: dropping the handler guard passes 10/10,
    dropping the `disabled` prop passes 10/10, dropping **both** fails two.

    That is defence in depth working, not a weak test. The property being
    asserted is "an unconfirmed account is not deleted", and that property is
    the conjunction — it survives either layer being removed, which is the
    entire point of having two on an irreversible action.

    ── The limit, stated rather than papered over ────────────────────────────

    **Neither layer can be pinned individually from a render test**, and an
    attempt to do it produced two tests that could not fail:

      - Reaching the handler past the `disabled` prop needs `onPress`, and
        `getByLabelText` returns the host `View`, whose `onPress` is
        `undefined`. `button.props.onPress?.()` is a silent no-op — the same
        trap `AddVehicleScreen.test.tsx` documents for `fireEvent`, in a new
        costume.
      - Asserting `accessibilityState.disabled` does not test the `disabled`
        prop either: that state is written explicitly and stays correct when
        the prop is removed.

    Both were deleted rather than left in wearing names they did not earn. A
    single-layer regression is therefore **not** caught here — it is caught by
    the next one, which is what the second layer is for. If that is ever not
    good enough, the instrument is a unit test of `handleDelete` extracted from
    the component, not a cleverer query.
  */

  it('does not delete when nothing has been typed', async () => {
    const user = userEvent.setup();
    const { view } = mount();

    await user.press((await view).getByLabelText('Delete my account'));

    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('does not delete on a near miss', async () => {
    /*
      "DELET" is the realistic wrong input — someone typing the word and being
      interrupted, or a keyboard swallowing the last character. It must not
      count.
    */
    const user = userEvent.setup();
    const { view } = mount();
    const resolved = await view;

    await user.type(resolved.getByLabelText(CONFIRM_FIELD), 'DELET');
    await user.press(resolved.getByLabelText('Delete my account'));

    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('deletes once the phrase is right — proving the refusals above are real', async () => {
    // The pair. Without it, both assertions above are satisfied by a button
    // that never works at all.
    const user = userEvent.setup();
    const { view } = mount();
    const resolved = await view;

    await user.type(resolved.getByLabelText(CONFIRM_FIELD), DELETION_CONFIRM_PHRASE);
    await user.press(resolved.getByLabelText('Delete my account'));

    expect(mockDelete).toHaveBeenCalledTimes(1);
  });

  it('accepts what an iOS keyboard actually produces', async () => {
    /*
      Lowercase and a trailing space. The software keyboard auto-capitalises and
      readily appends a space, so a strict comparison would reject people who
      typed exactly what was asked — turning a safety gate into a wall. The rule
      lives in core; this proves the screen uses it rather than its own.
    */
    const user = userEvent.setup();
    const { view } = mount();
    const resolved = await view;

    await user.type(resolved.getByLabelText(CONFIRM_FIELD), 'delete ');
    await user.press(resolved.getByLabelText('Delete my account'));

    expect(mockDelete).toHaveBeenCalledTimes(1);
  });

  it('announces itself as disabled, not merely behaves that way', async () => {
    /*
      This is an accessibility assertion, and it is **not** a test of layer 1.

      `accessibilityState` is written explicitly on the Pressable, so it stays
      correct even if the `disabled` prop is removed — verified by mutation.
      What it does prove is worth proving on its own: a button that is inert
      without saying so is worse than one that works. VoiceOver offers it, the
      tap does nothing, and nothing anywhere explains why.
    */
    const user = userEvent.setup();
    const { view } = mount();
    const resolved = await view;

    expect(resolved.getByLabelText('Delete my account').props.accessibilityState).toMatchObject({
      disabled: true,
    });

    await user.type(resolved.getByLabelText(CONFIRM_FIELD), DELETION_CONFIRM_PHRASE);

    expect(resolved.getByLabelText('Delete my account').props.accessibilityState).toMatchObject({
      disabled: false,
    });
  });
});

describe('after the account is gone', () => {
  it('hands the summary up so the caller can clear the session', async () => {
    /*
      The session is deliberately cleared by the caller, not here. The token
      names an auth user that no longer exists, so leaving it in the Keychain
      would leave the app rendering a garage it can no longer load — and the
      failure would arrive as a 401 on some later request rather than as the
      deletion it actually is.
    */
    const user = userEvent.setup();
    const { props, view } = mount();
    const resolved = await view;

    await user.type(resolved.getByLabelText(CONFIRM_FIELD), DELETION_CONFIRM_PHRASE);
    await user.press(resolved.getByLabelText('Delete my account'));

    expect(props.onDeleted).toHaveBeenCalledTimes(1);
    // What the server reported, not a fixed sentence.
    expect(String(props.onDeleted.mock.calls[0][0])).toMatch(/2/);
  });
});

describe('when deletion fails', () => {
  it('does not tell anyone their account is gone', async () => {
    // The worst available outcome: someone believes their data is destroyed,
    // stops asking, and it is all still there.
    const user = userEvent.setup();
    mockDelete.mockRejectedValue(new ApiRequestError({ status: 500, message: 'Upstream failed' }));

    const { props, view } = mount();
    const resolved = await view;

    await user.type(resolved.getByLabelText(CONFIRM_FIELD), DELETION_CONFIRM_PHRASE);
    await user.press(resolved.getByLabelText('Delete my account'));

    expect(props.onDeleted).not.toHaveBeenCalled();
  });

  it('says what went wrong', async () => {
    const user = userEvent.setup();
    mockDelete.mockRejectedValue(new ApiRequestError({ status: 500, message: 'Upstream failed' }));

    const { view } = mount();
    const resolved = await view;

    await user.type(resolved.getByLabelText(CONFIRM_FIELD), DELETION_CONFIRM_PHRASE);
    await user.press(resolved.getByLabelText('Delete my account'));

    expect(await resolved.findByText('Upstream failed')).toBeTruthy();
  });

  it('lets them try again rather than stranding them mid-deletion', async () => {
    // `deleting` has to be cleared on the failure path. Left set, the button
    // is disabled forever and the screen cannot even be closed — `handleClose`
    // returns early while deleting.
    const user = userEvent.setup();
    mockDelete.mockRejectedValue(new ApiRequestError({ status: 500, message: 'Upstream failed' }));

    const { view } = mount();
    const resolved = await view;

    await user.type(resolved.getByLabelText(CONFIRM_FIELD), DELETION_CONFIRM_PHRASE);
    await user.press(resolved.getByLabelText('Delete my account'));
    await resolved.findByText('Upstream failed');

    await user.press(resolved.getByLabelText('Delete my account'));

    expect(mockDelete).toHaveBeenCalledTimes(2);
  });
});

describe('closing the screen', () => {
  it('forgets a half-typed confirmation', async () => {
    /*
      Otherwise the phrase survives behind a closed modal, and the next time
      anyone opens Account the delete button is already armed — one tap from
      irreversible, with no visible reason why.
    */
    const user = userEvent.setup();
    const { props, view } = mount();
    const resolved = await view;

    await user.type(resolved.getByLabelText(CONFIRM_FIELD), DELETION_CONFIRM_PHRASE);
    await user.press(resolved.getByText('Done'));

    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(resolved.getByLabelText(CONFIRM_FIELD).props.value).toBe('');
  });

  it('signing out is not gated on the confirmation', async () => {
    // Different action, different consequence. Nothing about leaving should
    // require typing DELETE.
    const user = userEvent.setup();
    const { props, view } = mount();

    await user.press((await view).getByText('Sign out'));

    expect(props.onSignOut).toHaveBeenCalledTimes(1);
    expect(mockDelete).not.toHaveBeenCalled();
  });
});

describe('the subscription warning — Guideline 3.1.2 / E5', () => {
  /*
    Deleting an account while an Apple-billed subscription keeps charging is a
    documented rejection reason, and the failure is not paperwork: the account
    that could manage the subscription is gone, the charge continues, and there
    is no obvious way left to stop it.

    This is the surface Apple reviews, which is why the rule lives in
    `@wellkept/core/account-deletion` and both clients read it — two
    implementations let the reviewed one drift weaker without anything saying so.
  */

  it('says nothing to someone with no subscription', async () => {
    const { view } = mount();
    const resolved = await view;

    await waitFor(() => expect(mockSubscription).toHaveBeenCalled());
    expect(resolved.queryByText(/does not cancel/i)).toBeNull();
  });

  it('warns a subscriber that deletion does not cancel the billing', async () => {
    mockSubscription.mockResolvedValue({ live: true, certain: true });

    const { view } = mount();
    const resolved = await view;

    expect(await resolved.findByText(/does not cancel your subscription/i)).toBeTruthy();
    // Naming the place matters — "manage your subscription" is not a location.
    expect(await resolved.findByText(/Subscriptions/)).toBeTruthy();
  });

  it('still lets a subscriber delete — the warning is not a gate', async () => {
    /*
      The design decision worth pinning. Refusing deletion until the
      subscription is cancelled trades one guideline violation for a worse one:
      5.1.1(v) requires deletion to be completed from inside the app, and
      gating it on an action taken in a *different* app is exactly the
      obstruction it exists to prevent.
    */
    mockSubscription.mockResolvedValue({ live: true, certain: true });

    const user = userEvent.setup();
    const { view } = mount();
    const resolved = await view;

    await resolved.findByText(/does not cancel your subscription/i);
    await user.type(resolved.getByLabelText(CONFIRM_FIELD), DELETION_CONFIRM_PHRASE);
    await user.press(resolved.getByLabelText('Delete my account'));

    expect(mockDelete).toHaveBeenCalledTimes(1);
  });

  it('does not block deletion when the subscription read fails', async () => {
    /*
      The screen's job is deletion. A secondary read that fails must not take
      the required flow down with it — so `getSubscription` resolves to "no
      subscription" on a network error rather than throwing, and the server
      already fails the *other* way and warns when it cannot read.
    */
    mockSubscription.mockResolvedValue({ live: false, certain: false });

    const user = userEvent.setup();
    const { view } = mount();
    const resolved = await view;

    await user.type(resolved.getByLabelText(CONFIRM_FIELD), DELETION_CONFIRM_PHRASE);
    await user.press(resolved.getByLabelText('Delete my account'));

    expect(mockDelete).toHaveBeenCalledTimes(1);
  });
});
