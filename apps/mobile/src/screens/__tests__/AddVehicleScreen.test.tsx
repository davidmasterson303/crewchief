import { render, userEvent } from '@testing-library/react-native';

import { AddVehicleScreen } from '../AddVehicleScreen';
import { apiRequest, ApiRequestError } from '../../api/client';

/**
 * What the first-run screen actually sends.
 *
 * ── Why this file exists twice ──────────────────────────────────────────────
 *
 * A version of this suite was written on 8 Aug and **deleted rather than left
 * broken**: `fireEvent` did not reach the handlers, the failures looked
 * harness-shaped rather than like defects, and the screen's docblock recorded
 * the gap and the assertions to restore instead of shipping a weakened test.
 *
 * ⚠ **That diagnosis was wrong, and the wrong half was expensive.** It said
 * `fireEvent` "does not work here" and fails silently — that `changeText`
 * leaves `props.value` unchanged and the press lands on nothing. Re-measured on
 * 15 Aug 2026: an **awaited** `fireEvent.changeText` sets `value` and flips
 * `accessibilityState.disabled` exactly as `userEvent.type` does.
 *
 * The real fault was the missing `await`. In RNTL 14 `render`, `fireEvent` and
 * `userEvent` are all async, and an un-awaited one leaves React's act scope
 * open — after which **no later render in that file commits at all**, and
 * `toJSON()` returns null. Believing the API was simply broken hid that for a
 * week: `contrast.test.tsx` grew a "do not add a test below this line" warning
 * around the un-awaited calls instead of an `await`. `jest.setup.js` carries
 * the mechanism and now fails on it.
 *
 * **Use `userEvent` in every screen test in this app, and await it.** Not
 * because `fireEvent` is broken, but because `userEvent` models a real press
 * rather than a synthetic prop call — it respects `disabled`, `pointerEvents`
 * and the press sequence, which is what these tests are meant to assert on.
 * `render` is already awaited throughout (see `GarageScreen.test.tsx`); this is
 * the same discipline one layer down.
 *
 * ── The guard against the failure above ─────────────────────────────────────
 *
 * Every "it did not send" assertion in this file is paired with one that proves
 * the same interaction *does* send under valid input. An absence is only
 * evidence when the presence is demonstrated beside it.
 */

jest.mock('../../api/client', () => {
  // Spread the real module so `ApiRequestError` stays a real class — a stubbed
  // one would make `instanceof` and `.status` behave differently here than in
  // the app, which is the shape of bug this suite is meant to catch.
  const actual = jest.requireActual('../../api/client');
  return { ...actual, apiRequest: jest.fn() };
});

const mockApi = apiRequest as jest.MockedFunction<typeof apiRequest>;

function mount(overrides: Partial<Parameters<typeof AddVehicleScreen>[0]> = {}) {
  const props = { onAdded: jest.fn(), onSignOut: jest.fn(), ...overrides };
  return { props, view: render(<AddVehicleScreen {...props} />) };
}

/** The minimum a car needs: year, make, model, and a plausible odometer. */
async function fillTheCar(
  user: ReturnType<typeof userEvent.setup>,
  view: Awaited<ReturnType<typeof render>>,
  mileage = '94800'
) {
  await user.type(view.getByLabelText('Model year'), '2018');
  await user.type(view.getByLabelText('Make'), 'Honda');
  await user.type(view.getByLabelText('Model'), 'Accord');
  await user.type(view.getByLabelText('Current mileage'), mileage);
}

beforeEach(() => {
  mockApi.mockReset();
});

describe('adding a car', () => {
  it('sends what the form holds, and nothing it was not given', async () => {
    const user = userEvent.setup();
    mockApi.mockResolvedValue({ vehicle: { id: 'v1' } } as never);

    const { props, view } = mount();
    await fillTheCar(user, await view);
    await user.press((await view).getByLabelText('Add to my garage'));

    expect(mockApi).toHaveBeenCalledTimes(1);
    const [path, init] = mockApi.mock.calls[0];

    expect(path).toBe('/vehicles');
    expect(init).toMatchObject({ method: 'POST' });
    expect(init?.body).toMatchObject({
      year: 2018,
      make: 'Honda',
      model: 'Accord',
      currentMileage: 94_800,
    });

    expect(props.onAdded).toHaveBeenCalledWith('v1', '2018 Honda Accord');
  });

  it('never puts a user_id in the body', async () => {
    /*
      Ownership comes from the verified session, and the route takes it from
      `caller.userId`. A client-supplied `user_id` reads as authoritative even
      when the handler ignores it, which is one careless edit from being
      trusted. `create-vehicle-route.test.ts` holds the server half; this is the
      client half of the same rule.
    */
    const user = userEvent.setup();
    mockApi.mockResolvedValue({ vehicle: { id: 'v1' } } as never);

    const { view } = mount();
    await fillTheCar(user, await view);
    await user.press((await view).getByLabelText('Add to my garage'));

    const body = mockApi.mock.calls[0][1]?.body as Record<string, unknown>;
    const keys = Object.keys(body).map((key) => key.toLowerCase());

    expect(keys).not.toContain('user_id');
    expect(keys).not.toContain('userid');
  });
});

describe('the mileage rule', () => {
  it('refuses an implausible reading without spending a round trip', async () => {
    /*
      The rule lives in `@crewchief/core/mileage-tracking` precisely so the
      phone can refuse before the network. The server refuses too, because a
      client is not a guarantee — but a person who typed a wrong number should
      find out immediately.
    */
    const user = userEvent.setup();
    const { view } = mount();

    await fillTheCar(user, await view, '99999999');
    await user.press((await view).getByLabelText('Add to my garage'));

    expect(mockApi).not.toHaveBeenCalled();
  });

  it('shows the reason rather than failing silently', async () => {
    const user = userEvent.setup();
    const { view } = mount();

    await fillTheCar(user, await view, '99999999');
    await user.press((await view).getByLabelText('Add to my garage'));

    // The message is core's, written to be shown. Asserting *something*
    // rendered rather than its exact wording, which is copy and will change.
    const resolved = await view;
    expect(resolved.toJSON()).toBeTruthy();
    expect(JSON.stringify(resolved.toJSON())).toMatch(/mileage|reading|check/i);
  });

  it('but does send when the reading is fine — proving the refusal is real', async () => {
    // The pair. Without this, the two assertions above are satisfied by a
    // press that never reached the handler at all.
    const user = userEvent.setup();
    mockApi.mockResolvedValue({ vehicle: { id: 'v1' } } as never);

    const { view } = mount();
    await fillTheCar(user, await view, '94800');
    await user.press((await view).getByLabelText('Add to my garage'));

    expect(mockApi).toHaveBeenCalledTimes(1);
  });
});

describe('the modifications question', () => {
  it('defaults to interested', async () => {
    const user = userEvent.setup();
    mockApi.mockResolvedValue({ vehicle: { id: 'v1' } } as never);

    const { view } = mount();
    await fillTheCar(user, await view);
    await user.press((await view).getByLabelText('Add to my garage'));

    expect(mockApi.mock.calls[0][1]?.body).toMatchObject({ wantsModifications: true });
  });

  it('carries a "not for me" answer through, because it hides a whole surface', async () => {
    // `showsModifications` is the whole rule, and this is the only place it is
    // set at creation. A dropped answer means the mods tab appears for someone
    // who said they did not want it.
    const user = userEvent.setup();
    mockApi.mockResolvedValue({ vehicle: { id: 'v1' } } as never);

    const { view } = mount();
    const resolved = await view;
    await fillTheCar(user, resolved);
    await user.press(resolved.getByText('Not for me'));
    await user.press(resolved.getByLabelText('Add to my garage'));

    expect(mockApi.mock.calls[0][1]?.body).toMatchObject({ wantsModifications: false });
  });
});

describe('the Track A2a service baseline', () => {
  it('sends null for both when the owner says nothing', async () => {
    /*
      `null`, not `0` and not omitted. The route distinguishes "no answer" from
      "zero miles" — 0 is a legitimate reading on a car delivered with a
      pre-delivery service — and `buildBaselineRow` writes no row at all for a
      pair of nulls.
    */
    const user = userEvent.setup();
    mockApi.mockResolvedValue({ vehicle: { id: 'v1' } } as never);

    const { view } = mount();
    await fillTheCar(user, await view);
    await user.press((await view).getByLabelText('Add to my garage'));

    expect(mockApi.mock.calls[0][1]?.body).toMatchObject({
      lastServiceMileage: null,
      lastServiceAge: null,
    });
  });

  it('sends a mileage on its own', async () => {
    // Useful without a date: every mileage-based service can count from it.
    const user = userEvent.setup();
    mockApi.mockResolvedValue({ vehicle: { id: 'v1' } } as never);

    const { view } = mount();
    const resolved = await view;
    await fillTheCar(user, resolved);
    await user.type(resolved.getByLabelText('Mileage at last oil change, optional'), '85000');
    await user.press(resolved.getByLabelText('Add to my garage'));

    expect(mockApi.mock.calls[0][1]?.body).toMatchObject({
      lastServiceMileage: 85_000,
      lastServiceAge: null,
    });
  });

  it('sends an age on its own', async () => {
    const user = userEvent.setup();
    mockApi.mockResolvedValue({ vehicle: { id: 'v1' } } as never);

    const { view } = mount();
    const resolved = await view;
    await fillTheCar(user, resolved);
    await user.press(resolved.getByText('6 to 12 months ago'));
    await user.press(resolved.getByLabelText('Add to my garage'));

    expect(mockApi.mock.calls[0][1]?.body).toMatchObject({
      lastServiceMileage: null,
      lastServiceAge: 'six-to-twelve',
    });
  });

  it('lets an age be unselected, so a mis-tap is recoverable', async () => {
    /*
      There is no "clear" control — pressing the selected option again is the
      only way back, and without it a stray tap becomes a permanent claim about
      the car's history that the owner never meant to make.
    */
    const user = userEvent.setup();
    mockApi.mockResolvedValue({ vehicle: { id: 'v1' } } as never);

    const { view } = mount();
    const resolved = await view;
    await fillTheCar(user, resolved);
    await user.press(resolved.getByText('Over a year ago'));
    await user.press(resolved.getByText('Over a year ago'));
    await user.press(resolved.getByLabelText('Add to my garage'));

    expect(mockApi.mock.calls[0][1]?.body).toMatchObject({ lastServiceAge: null });
  });

  it('does not block submission — nothing here is required', async () => {
    // The reason there is no skip button. A gate would need one; this is not a
    // gate, and the first test in this block already submits with both empty.
    const user = userEvent.setup();
    mockApi.mockResolvedValue({ vehicle: { id: 'v1' } } as never);

    const { props, view } = mount();
    await fillTheCar(user, await view);
    await user.press((await view).getByLabelText('Add to my garage'));

    expect(props.onAdded).toHaveBeenCalled();
  });
});

describe('when the request fails', () => {
  it('signs out on a 401 rather than showing an error nobody can act on', async () => {
    const user = userEvent.setup();
    // The constructor takes an options object, not (message, status). Passing
    // positional arguments builds an error whose `status` is `undefined` — it
    // still throws, the screen still catches it, and the 401 branch is simply
    // never taken. Caught here by the test failing; worth naming because the
    // wrong call is the one that looks right.
    mockApi.mockRejectedValue(new ApiRequestError({ status: 401, message: 'Unauthorized' }));

    const { props, view } = mount();
    await fillTheCar(user, await view);
    await user.press((await view).getByLabelText('Add to my garage'));

    expect(props.onSignOut).toHaveBeenCalledTimes(1);
  });

  it('keeps the person on the screen for any other failure', async () => {
    /*
      A 500 is not a session problem. Signing out for one would discard a
      filled-in form and send someone back to a login screen to fix something
      that was never theirs — and it is the behaviour a broad
      `catch → onSignOut` produces.
    */
    const user = userEvent.setup();
    mockApi.mockRejectedValue(
      new ApiRequestError({ status: 500, message: 'Upstream is having a moment' })
    );

    const { props, view } = mount();
    await fillTheCar(user, await view);
    await user.press((await view).getByLabelText('Add to my garage'));

    expect(props.onSignOut).not.toHaveBeenCalled();
    expect(props.onAdded).not.toHaveBeenCalled();
    expect(JSON.stringify((await view).toJSON())).toMatch(/Upstream is having a moment/);
  });

  it('reports a 200 that carried no vehicle rather than navigating nowhere', async () => {
    // `onAdded` takes an id. Calling it with `undefined` would push a detail
    // screen for a car that does not exist.
    const user = userEvent.setup();
    mockApi.mockResolvedValue({} as never);

    const { props, view } = mount();
    await fillTheCar(user, await view);
    await user.press((await view).getByLabelText('Add to my garage'));

    expect(props.onAdded).not.toHaveBeenCalled();
    expect(JSON.stringify((await view).toJSON())).toMatch(/not saved/i);
  });
});
