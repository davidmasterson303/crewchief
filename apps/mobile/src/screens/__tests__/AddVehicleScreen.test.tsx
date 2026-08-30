import { act, render, userEvent } from '@testing-library/react-native';

import { AddVehicleScreen } from '../AddVehicleScreen';
import { apiRequest, ApiRequestError } from '../../api/client';
import { decodeVin, fetchModels } from '../../api/vpic';

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

/*
  vPIC is a third party over a network, and this suite is about what the screen
  does with what it says. Stubbed at the module that owns the two calls —
  `api/vpic.ts` — rather than at `fetch`, so these cases assert the screen's
  behaviour and `vehicle-catalog.test.ts` asserts the parsing. Splitting them
  is what keeps a change to NHTSA's JSON shape from failing fifteen tests about
  something else.
*/
jest.mock('../../api/vpic', () => ({
  decodeVin: jest.fn().mockResolvedValue(null),
  fetchModels: jest.fn().mockResolvedValue([]),
}));

const mockApi = apiRequest as jest.MockedFunction<typeof apiRequest>;
const mockDecode = decodeVin as jest.MockedFunction<typeof decodeVin>;
const mockModels = fetchModels as jest.MockedFunction<typeof fetchModels>;

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
  mockDecode.mockReset().mockResolvedValue(null);
  mockModels.mockReset().mockResolvedValue([]);
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
      The rule lives in `@wellkept/core/mileage-tracking` precisely so the
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
    /*
      ⚠ **`origin: 'device'` as of 24 Aug (MOB-08).** This screen used to sign
      out on **any** 401, including a `server` one that a retry a second later
      would have accepted — and then `return`ed without setting a state, so
      offline with an expired token it showed skeletons forever with no error
      and no retry.

      A device-side 401 is the one that genuinely means "signed out", and it is
      the one this case is about.
    */
    mockApi.mockRejectedValue(new ApiRequestError({ status: 401, origin: 'device', message: 'Unauthorized' }));

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

/**
 * ── The catalogue, added 23 Aug ─────────────────────────────────────────────
 *
 * Everything above this line was already true of three free-text cells. These
 * cases are about the defect those cells could not see: a value that is
 * *accepted* and *wrong*, which produces a car with no recalls, no dossier and
 * no schedule and looks like a product that knows nothing rather than a typo.
 */
describe('naming the car', () => {
  it('sends the catalogue spelling, not the one that was typed', async () => {
    /*
      ⚠ The whole reason the catalogue exists. "bmw" is a different make from
      "BMW" to every join downstream, and the old form sent it verbatim.
    */
    const user = userEvent.setup();
    mockApi.mockResolvedValue({ vehicle: { id: 'v9' } } as never);

    const { props, view } = mount();
    const resolved = await view;

    await user.type(resolved.getByLabelText('Model year'), '2015');
    await user.type(resolved.getByLabelText('Make'), 'bmw');
    await user.type(resolved.getByLabelText('Model'), 'M235i');
    await user.type(resolved.getByLabelText('Current mileage'), '66000');
    await user.press(resolved.getByLabelText('Add to my garage'));

    expect(mockApi.mock.calls[0][1]?.body).toMatchObject({ year: 2015, make: 'BMW' });
    // And into the title the garage shows while the detail screen loads.
    expect(props.onAdded).toHaveBeenCalledWith('v9', '2015 BMW M235i');
  });

  it('leaves a make it has never heard of exactly as it was typed', async () => {
    /*
      The pair to the case above, and the one that makes it a catalogue rather
      than a gate — §10. A form that only accepted its own list would refuse
      every grey import and kit car on the road.
    */
    const user = userEvent.setup();
    mockApi.mockResolvedValue({ vehicle: { id: 'v10' } } as never);

    const { view } = mount();
    const resolved = await view;

    await user.type(resolved.getByLabelText('Model year'), '1994');
    await user.type(resolved.getByLabelText('Make'), 'Koenigsegg');
    await user.type(resolved.getByLabelText('Model'), 'CC');
    await user.type(resolved.getByLabelText('Current mileage'), '4200');
    await user.press(resolved.getByLabelText('Add to my garage'));

    expect(mockApi.mock.calls[0][1]?.body).toMatchObject({ make: 'Koenigsegg', model: 'CC' });
  });

  it('offers makes as they are typed, and taking one clears the model under it', async () => {
    /*
      A model belongs to a make. An Accord left sitting under Subaru because the
      make was corrected is the one state this form must never submit: it
      typechecks, it looks filled in, and it creates a car that does not exist.
    */
    const user = userEvent.setup();
    const { view } = mount();
    const resolved = await view;

    await user.type(resolved.getByLabelText('Model'), 'Accord');
    await user.type(resolved.getByLabelText('Make'), 'suba');
    await user.press(resolved.getByLabelText('Subaru, use as make'));

    expect(resolved.getByLabelText('Make').props.value).toBe('Subaru');
    expect(resolved.getByLabelText('Model').props.value).toBe('');
  });

  it('says what a model year can be, and will not send one that cannot', async () => {
    // "205" and "20155" both passed the old four-character check, and the
    // second one only because it was truncated.
    const user = userEvent.setup();
    const { view } = mount();
    const resolved = await view;

    await user.type(resolved.getByLabelText('Model year'), '2055');
    await user.type(resolved.getByLabelText('Make'), 'Honda');
    await user.type(resolved.getByLabelText('Model'), 'Accord');

    expect(JSON.stringify(resolved.toJSON())).toMatch(/Model years run from 1981/);

    await user.press(resolved.getByLabelText('Add to my garage'));
    expect(mockApi).not.toHaveBeenCalled();
  });

  it('asks vPIC for models once a year and a make are both settled', async () => {
    /*
      Both, not either. vPIC's model list is keyed on the pair, and asking with
      one of them missing is a request that can only answer nothing.
    */
    jest.useFakeTimers();
    try {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      mockModels.mockResolvedValue(['M235i', 'X5']);

      const { view } = mount();
      const resolved = await view;

      await user.type(resolved.getByLabelText('Make'), 'BMW');
      // A make on its own is not enough to ask about.
      expect(mockModels).not.toHaveBeenCalled();

      await user.type(resolved.getByLabelText('Model year'), '2015');
      await act(async () => {
        jest.advanceTimersByTime(400);
      });

      expect(mockModels).toHaveBeenCalledWith('BMW', 2015, expect.anything());
    } finally {
      jest.useRealTimers();
    }
  });

  it('says why a model list is empty rather than sitting blank', async () => {
    /*
      Three causes an owner can tell apart, and only one is a dead end. ⚠ And
      the dead end still claims nothing about the car — NHTSA not listing a
      model is a fact about NHTSA.
    */
    const user = userEvent.setup();
    const { view } = mount();
    const resolved = await view;

    await user.type(resolved.getByLabelText('Model'), 'W');
    expect(JSON.stringify(resolved.toJSON())).toMatch(/Pick a model year and a make/);
  });
});

describe('the VIN, which fills the form and never gates it', () => {
  /** A clean decode, as `parseVpicDecode` returns one. */
  const M235I = {
    year: 2015,
    make: 'BMW',
    model: 'M235i',
    trim: null,
    confidence: 'clean' as const,
  };

  /*
    ⚠ No "open the VIN block" step any more. It was a collapsed row until
    23 Aug; `specs/native-add-vehicle.spec.html` puts the VIN **first**, with
    year/make/model as a visible fallback under an "or", so the field is on
    screen from the moment the form is.
  */
  async function useVin(user: ReturnType<typeof userEvent.setup>, resolved: Awaited<ReturnType<typeof render>>) {
    await user.type(resolved.getByLabelText('VIN, 17 characters'), 'WBA1J7C51FV253855');
    await user.press(resolved.getByLabelText('Read the car off it'));
  }

  it('fills the empty fields and says where the values came from', async () => {
    const user = userEvent.setup();
    mockDecode.mockResolvedValue(M235I);

    const { view } = mount();
    const resolved = await view;
    await useVin(user, resolved);

    expect(resolved.getByLabelText('Model year').props.value).toBe('2015');
    expect(resolved.getByLabelText('Make').props.value).toBe('BMW');
    expect(resolved.getByLabelText('Model').props.value).toBe('M235i');
    expect(JSON.stringify(resolved.toJSON())).toMatch(/Filled in from the VIN: 2015 BMW M235i/);
  });

  it('never overwrites an answer the owner already gave', async () => {
    /*
      ⚠ The decode is additive. Somebody who typed the trim and then remembered
      the VIN must not watch their own answer replaced — and vPIC returns an
      empty `Trim` far more often than not, so an unconditional write would
      blank it.
    */
    const user = userEvent.setup();
    mockDecode.mockResolvedValue({ ...M235I, model: 'M2' });

    const { view } = mount();
    const resolved = await view;

    await user.type(resolved.getByLabelText('Model'), 'M235i xDrive');
    await useVin(user, resolved);

    expect(resolved.getByLabelText('Model').props.value).toBe('M235i xDrive');
    // Anti-vacuous: the fields it *was* allowed to fill were filled.
    expect(resolved.getByLabelText('Make').props.value).toBe('BMW');
  });

  it('keeps a decode NHTSA complained about, and repeats the complaint', async () => {
    /*
      Position 9 is only mandatory for North American builds, so a genuine
      import can fail it — and NHTSA decodes the car regardless. Refusing the
      answer would be this client being stricter than the authority it asked.
    */
    const user = userEvent.setup();
    mockDecode.mockResolvedValue({ ...M235I, confidence: 'suspect' });

    const { view } = mount();
    const resolved = await view;
    await useVin(user, resolved);

    expect(resolved.getByLabelText('Make').props.value).toBe('BMW');
    expect(JSON.stringify(resolved.toJSON())).toMatch(/check digit does not match/);
  });

  it('sends nobody down a dead end when the decode fails', async () => {
    // The form below is complete and usable, and the sentence says so rather
    // than leaving somebody staring at a VIN field that will not work.
    const user = userEvent.setup();
    mockDecode.mockResolvedValue(null);

    const { view } = mount();
    const resolved = await view;
    await useVin(user, resolved);

    expect(JSON.stringify(resolved.toJSON())).toMatch(/could not read that VIN/);
    expect(resolved.getByLabelText('Make').props.value).toBe('');

    // And the form still works. An absence is only evidence beside a presence.
    await user.type(resolved.getByLabelText('Model year'), '2018');
    await user.type(resolved.getByLabelText('Make'), 'Honda');
    await user.type(resolved.getByLabelText('Model'), 'Accord');
    await user.type(resolved.getByLabelText('Current mileage'), '94800');
    mockApi.mockResolvedValue({ vehicle: { id: 'v11' } } as never);
    await user.press(resolved.getByLabelText('Add to my garage'));

    expect(mockApi).toHaveBeenCalled();
  });

  it('refuses to look up something that is not a VIN yet', async () => {
    const user = userEvent.setup();
    const { view } = mount();
    const resolved = await view;

    await user.type(resolved.getByLabelText('VIN, 17 characters'), 'WBA1J7C51');
    await user.press(resolved.getByLabelText('Read the car off it'));

    expect(mockDecode).not.toHaveBeenCalled();
    expect(JSON.stringify(resolved.toJSON())).toMatch(/8 to go/);
  });

  it('names the three characters a VIN cannot contain', async () => {
    // I, O and Q are the ones an owner is most likely to type, because they are
    // the ones that look like 1 and 0 on a stamped plate.
    const user = userEvent.setup();
    const { view } = mount();
    const resolved = await view;

    await user.type(resolved.getByLabelText('VIN, 17 characters'), 'WBA1J7C51FV25385O');

    expect(JSON.stringify(resolved.toJSON())).toMatch(/I, O or Q/);
    expect(mockDecode).not.toHaveBeenCalled();
  });
});
