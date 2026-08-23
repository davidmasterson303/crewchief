import { render, userEvent, waitFor } from '@testing-library/react-native';

import { everHadVehicle, recordEverHadVehicle } from '../../onboarding/first-run-storage';

import { GarageScreen } from '../GarageScreen';
import { apiRequest, ApiRequestError } from '../../api/client';

/**
 * The first test in this repo that mounts a React Native screen.
 *
 * ── What it has to earn ─────────────────────────────────────────────────────
 *
 * Nine defects were found by hand on 5 Aug and none by the 1,607-test suite.
 * The one below was the worst of them: **account deletion disappeared whenever
 * the API was down.** Loading and error returned before the header, so the
 * "Account" control simply was not on screen — and App Store guideline
 * 5.1.1(v) requires deletion to be reachable from inside the app. A reviewer
 * testing offline would have found it.
 *
 * `mobile-account-reachable.test.ts` in the web suite already pins it, but only
 * as a **source scan**: it proves each `return` in the component mentions the
 * account affordance. That is a proxy. This mounts the screen in its failing
 * state and looks for the control, which is the actual claim.
 *
 * Both are kept. The scan runs on every `npm test` from the root and catches a
 * regression in a file nobody thought to re-test; this catches the class of bug
 * a scan cannot see at all — a control that is present in the source and absent
 * on screen.
 */

/*
  The notification module is mocked so the C5 primer effect is deterministic.

  `GarageScreen` now reads the push permission and the primer dismissal when
  the vehicle list resolves. Left unmocked those are real async calls into
  `expo-notifications` and the Keychain, which resolve *after* the assertions
  and update state outside `act()` — visible as "overlapping act() calls"
  warnings and, once, as a failure that did not reproduce.

  A test that passes eight times out of nine is not passing. The default here
  is `granted`, which is the state that shows no primer, so every existing
  assertion sees the screen it was written against. The primer's own behaviour
  is covered in `push-priming.test.ts`, where the rule lives.
*/
/**
 * Controlled per test, because it decides which of the two empty states
 * renders. Defaults to a returning install — the majority case across this
 * file, and the one every other test here predates.
 */
jest.mock('../../onboarding/first-run-storage', () => ({
  everHadVehicle: jest.fn().mockResolvedValue(true),
  recordEverHadVehicle: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../notifications/register', () => ({
  currentPushPermission: jest.fn().mockResolvedValue('granted'),
  primerDismissedOn: jest.fn().mockResolvedValue(null),
  recordPrimerDismissed: jest.fn().mockResolvedValue(undefined),
  registerForPush: jest.fn().mockResolvedValue({ status: 'registered' }),
}));

jest.mock('../../api/client', () => {
  const actual = jest.requireActual('../../api/client');
  return { ...actual, apiRequest: jest.fn() };
});

const request = apiRequest as jest.MockedFunction<typeof apiRequest>;

const M235I = {
  id: 'db143cdc-e68c-46f0-849e-69f7a1873f58',
  year: 2015,
  make: 'BMW',
  model: 'M235i',
  trim: 'xDrive',
  current_mileage: 66000,
  vehicle_status: 'daily_driver',
  vehicle_health_summary: { health_score: 70, summary: 'Fair.' },
  /*
    ⚠ Real NHTSA field names, not `{ id: 1 }`.

    The old fixture was two bare objects, which `normaliseRecall` drops — "an
    entry rendering as a blank card is not information". That went unnoticed
    while the chip counted the raw array; once it counts what the recall screen
    would actually draw, a fixture NHTSA could never return stops standing in
    for one it could.
  */
  nhtsa_data: {
    recalls: [
      { NHTSACampaignNumber: '23V-441', Component: 'FUEL SYSTEM', Summary: 'Pump may fail.' },
      { NHTSACampaignNumber: '21V-100', Component: 'AIR BAGS', Summary: 'Inflator may rupture.' },
    ],
  },
};

/**
 * `render` is **async** in @testing-library/react-native 14 — React 19 made
 * mounting concurrent, so it returns a Promise. Forgetting the `await` gives
 * `view.findByText is not a function`, or an unpopulated `screen` reporting
 * that render "has not been called", neither of which names the cause.
 */
function renderGarage(
  overrides: {
    onAddVehicle?: () => void;
    /*
      The picker seam. `src/media/pick-image.ts` is the only module that imports
      `expo-image-picker`, and the screen takes the picker as a prop for exactly
      this reason — a native module in the graph crashes a build that lacks it,
      and there is no picker at all in a test runner.
    */
    pickPhoto?: () => Promise<unknown>;
  } = {}
) {
  return render(
    <GarageScreen
      accessToken="test-token"
      email="owner@example.test"
      onSignOut={jest.fn()}
      onOpenVehicle={jest.fn()}
      onAddVehicle={overrides.onAddVehicle ?? jest.fn()}
      pickPhoto={overrides.pickPhoto as never}
    />
  );
}

beforeEach(() => jest.clearAllMocks());

describe('the recall chip counts what is still open', () => {
  /*
    ── Two corrections, and both are silent ────────────────────────────────

    The chip was `nhtsa_data.recalls.length` off the raw payload, which counted
    rows the recall screen refuses to draw **and** campaigns the owner had
    already dealt with. The second was not even a bug until 23 Aug, because
    there was no way to mark one — and a badge that can never go down stops
    being read, which is the whole reason `/api/v1/recalls` exists.
  */
  it('does not count a record with nothing to say', async () => {
    request.mockResolvedValue({
      vehicles: [
        {
          ...M235I,
          nhtsa_data: {
            recalls: [
              { NHTSACampaignNumber: '23V-441', Component: 'FUEL SYSTEM', Summary: 'Pump.' },
              // No component and no summary: `normaliseRecall` drops it, so the
              // recall screen would show one card. The chip must agree.
              { NHTSACampaignNumber: '00V-000' },
            ],
          },
        },
      ],
    });

    const view = await renderGarage();
    await view.findByText('2015 BMW M235i');

    expect(view.getByText('1 recall')).toBeTruthy();
  });

  it('subtracts what the owner has marked repaired', async () => {
    request.mockResolvedValue({
      vehicles: [{ ...M235I, recall_actions: [{ campaign_number: '23V-441' }] }],
    });

    const view = await renderGarage();
    await view.findByText('2015 BMW M235i');

    // Two on record, one marked — and the chip is the count of what is left.
    expect(view.getByText('1 recall')).toBeTruthy();
  });

  it('shows no chip once every recall has been marked', async () => {
    request.mockResolvedValue({
      vehicles: [
        {
          ...M235I,
          recall_actions: [{ campaign_number: '23V-441' }, { campaign_number: '21V-100' }],
        },
      ],
    });

    const view = await renderGarage();
    await view.findByText('2015 BMW M235i');

    expect(view.queryByText(/recall/)).toBeNull();
  });

  it('treats unreadable marks as nothing marked, never as everything', async () => {
    /*
      ⚠ The direction that matters. A missing or malformed `recall_actions`
      embed must leave a recall **showing**, not hide it — erring the other way
      suppresses an open safety notice on the strength of a failed read.
    */
    request.mockResolvedValue({ vehicles: [{ ...M235I, recall_actions: null }] });

    const view = await renderGarage();
    await view.findByText('2015 BMW M235i');

    expect(view.getByText('2 recalls')).toBeTruthy();
  });
});

describe('the garage', () => {
  it('draws a vehicle the API returned', async () => {
    request.mockResolvedValue({ vehicles: [M235I] });

    const view = await renderGarage();

    expect(await view.findByText('2015 BMW M235i')).toBeTruthy();

    /*
      The trim, the status and the mileage are one subtitle now — the bay has a
      single identity lockup where the card had a header and a meta row. The
      claims are unchanged and both still matter:

        - **Formatted, not raw.** `vehicle_status` reached the screen as
          "daily_driver" once, and only looking at it caught that.
        - **Grouped, not concatenated.** The separator earns its place only
          when there is something on both sides, so a car with no trim must not
          render a leading "· ".
    */
    expect(view.getByText('xDrive · Daily Driver · 66,000 mi')).toBeTruthy();

    // Recalls stay on the bay. A garage that shows condition but not an open
    // safety defect is showing the reassuring half.
    expect(view.getByText('2 recalls')).toBeTruthy();
  });
});

describe('App Store 5.1.1(v) — account deletion stays reachable', () => {
  /*
    The three states the screen can be in. Deletion must be one tap away from
    every one of them, because "buried" for a reviewer means "not present",
    and the state a departing user is most likely to meet is the broken one.
  */
  it('offers Account while the garage is still loading', async () => {
    // A request that never settles: the loading state, held open.
    request.mockImplementation(() => new Promise(() => {}));

    const view = await renderGarage();

    expect(await view.findByLabelText('Account')).toBeTruthy();
  });

  it('offers Account when the API fails — the defect that shipped', async () => {
    // A server message distinct from the screen's own heading, so the
    // assertion cannot pass by matching the title it sits under.
    request.mockRejectedValue(
      new ApiRequestError({ status: 500, message: 'Upstream is having a moment' })
    );

    const view = await renderGarage();

    await waitFor(() => expect(view.getByText('Upstream is having a moment')).toBeTruthy());
    expect(view.getByText('Could not load your garage')).toBeTruthy();

    // The assertion the source scan can only approximate.
    expect(view.getByLabelText('Account')).toBeTruthy();
  });

  it('offers Account when the session has expired', async () => {
    request.mockRejectedValue(new ApiRequestError({ status: 401, message: 'Unauthorized' }));

    const view = await renderGarage();

    await waitFor(() => expect(view.getByText('Signed out')).toBeTruthy());
    expect(view.getByLabelText('Account')).toBeTruthy();
  });

  it('offers Account to an account with no cars', async () => {
    // An empty garage is the ordinary first-run state, and not a failure.
    request.mockResolvedValue({ vehicles: [] });

    const view = await renderGarage();

    expect(await view.findByLabelText('Account')).toBeTruthy();
  });

  it('offers Account behind the opening explanation too', async () => {
    /*
      ⚠ The reason the first-run screen replaces the *body* and not the screen.

      Somebody who has just signed up, cannot work out what this is, and wants
      to sign out or delete the account they just made is the person most likely
      to need Account and the one a full-screen takeover would hide it from —
      the failure this screen's own header comment already warns about.
    */
    (everHadVehicle as jest.Mock).mockResolvedValue(false);
    request.mockResolvedValue({ vehicles: [] });

    const view = await renderGarage();

    expect(await view.findByText('Start with one car')).toBeTruthy();
    expect(view.getByLabelText('Account')).toBeTruthy();
  });
});

describe('which empty garage you get', () => {
  it('explains the product to an install that has never had a car', async () => {
    (everHadVehicle as jest.Mock).mockResolvedValue(false);
    request.mockResolvedValue({ vehicles: [] });

    const view = await renderGarage();

    expect(await view.findByText('Start with one car')).toBeTruthy();
    expect(view.queryByText('No vehicles yet')).toBeNull();
  });

  it('says only that it is empty to someone who has had one before', async () => {
    /*
      A year-old account that sold its last car is not a new user. Greeting it
      with "Start with one car" is the product forgetting them, which is why the
      stored fact is "ever had a vehicle" rather than "seen onboarding" —
      `@crewchief/core/first-run` carries the argument.
    */
    (everHadVehicle as jest.Mock).mockResolvedValue(true);
    request.mockResolvedValue({ vehicles: [] });

    const view = await renderGarage();

    expect(await view.findByText('No vehicles yet')).toBeTruthy();
    expect(view.queryByText('Start with one car')).toBeNull();
  });

  it('remembers a garage that had cars in it, so the explanation does not return', async () => {
    /*
      Recorded on a **load** that returns cars rather than on the create. The
      two differ for the case that matters: signing in on a second phone to an
      account that already has cars never runs a create, and a flag written only
      there would leave that install believing forever that this is a first run.
    */
    (everHadVehicle as jest.Mock).mockResolvedValue(false);
    request.mockResolvedValue({ vehicles: [M235I] });

    await renderGarage();

    await waitFor(() => expect(recordEverHadVehicle).toHaveBeenCalled());
  });
});

/**
 * Adding a car is reachable from every state, not just the empty one.
 *
 * **The defect this pins was live.** "Add a car" existed only inside
 * `ListEmptyComponent`, so the affordance disappeared the moment you owned a
 * car — there was no way on the phone to add a second. Invisible while the web
 * was where you became a user, and a hole in the product once the phone *is*
 * the product.
 *
 * It is the same rule, broken the same way, as the account-deletion bug
 * `mobile-account-reachable.test.ts` was written after: an affordance placed in
 * one branch of a screen that renders several. That guard is a source scan
 * because no mobile runner existed when it was written. One exists now, so this
 * mounts the screen instead — it asserts what a person can actually reach
 * rather than what the file contains.
 */
describe('adding a car', () => {
  it('is reachable with cars in the garage', async () => {
    // The state the old placement missed entirely.
    request.mockResolvedValue({ vehicles: [M235I] });

    const view = await renderGarage();

    await view.findByText('2015 BMW M235i');
    expect(view.getByLabelText('Add a car')).toBeTruthy();
  });

  it('is reachable with an empty garage', async () => {
    request.mockResolvedValue({ vehicles: [] });

    const view = await renderGarage();

    expect(await view.findByLabelText('Add a car')).toBeTruthy();
  });

  it('is reachable when the garage failed to load', async () => {
    /*
      A person whose connection dropped should still be able to start adding a
      car. This is also the state where the old empty-state placement was most
      misleading: the list is empty because the request failed, not because the
      account has no cars.
    */
    request.mockRejectedValue(
      new ApiRequestError({ status: 500, message: 'Upstream is having a moment' })
    );

    const view = await renderGarage();

    await waitFor(() => expect(view.getByText('Could not load your garage')).toBeTruthy());
    expect(view.getByLabelText('Add a car')).toBeTruthy();
  });

  it('actually calls the handler rather than merely rendering a control', async () => {
    /*
      The three above prove a label exists. This proves it is wired — a
      `Pressable` with no `onPress`, or one bound to the wrong callback, renders
      and reads identically. `userEvent` rather than `fireEvent`: see
      `AddVehicleScreen.test.tsx` for why the latter silently does nothing here.
    */
    const user = userEvent.setup();
    const onAddVehicle = jest.fn();
    request.mockResolvedValue({ vehicles: [M235I] });

    const view = await renderGarage({ onAddVehicle });

    await view.findByText('2015 BMW M235i');
    await user.press(view.getByLabelText('Add a car'));

    expect(onAddVehicle).toHaveBeenCalledTimes(1);
  });
});

describe('adding a photograph', () => {
  const PICKED = {
    uri: 'file:///tmp/car.jpg',
    name: 'car.jpg',
    type: 'image/jpeg',
    size: 400 * 1024,
  };

  it('offers no control when the build has no picker', async () => {
    /*
      Omitted means no control, never a control that fails. The picker is a
      native module and a build without it cannot be asked for a photograph —
      showing the button anyway would be a dead end dressed as an affordance.
    */
    request.mockResolvedValue({ vehicles: [M235I] });

    const view = await renderGarage();
    await view.findByText('2015 BMW M235i');

    expect(view.queryByLabelText('Add photo')).toBeNull();
  });

  it('offers Add photo on a car that has none', async () => {
    /*
      ⚠ The defect David found on 15 Aug. The identity plate is a finished
      design for a car with no photograph, and it was the only reachable state —
      a plate you cannot replace is a dead end rather than a fallback.
    */
    request.mockResolvedValue({ vehicles: [M235I] });

    const view = await renderGarage({ pickPhoto: jest.fn() });
    await view.findByText('2015 BMW M235i');

    expect(view.getByLabelText('Add photo')).toBeTruthy();
  });

  it('says nothing at all when the picker is dismissed', async () => {
    /*
      Dismissal is not a failure, and it must stay distinguishable from one.
      Showing "cancelled" after a deliberate tap on Cancel is how an app feels
      accusatory.
    */
    request.mockResolvedValue({ vehicles: [M235I] });
    const pickPhoto = jest.fn().mockResolvedValue(null);

    const view = await renderGarage({ pickPhoto });
    await view.findByText('2015 BMW M235i');

    await userEvent.setup().press(view.getByLabelText('Add photo'));

    await waitFor(() => expect(pickPhoto).toHaveBeenCalled());
    expect(view.queryByText('That photo was not saved')).toBeNull();
  });

  it('shows the refusal the owner can act on', async () => {
    /*
      The size ceiling is genuinely reachable from a phone — there is no image
      manipulator in this build to cap a dimension with — so its message names
      the numbers and reaches the screen intact rather than becoming a generic
      failure.
    */
    request.mockResolvedValue({ vehicles: [M235I] });
    const pickPhoto = jest
      .fn()
      .mockResolvedValue({ ...PICKED, size: 3 * 1024 * 1024 });

    const view = await renderGarage({ pickPhoto });
    await view.findByText('2015 BMW M235i');

    await userEvent.setup().press(view.getByLabelText('Add photo'));

    expect(await view.findByText(/the limit is 1\.5 MB/)).toBeTruthy();
  });

  it('refetches the garage after a photo lands, rather than patching the row', async () => {
    /*
      The upload returns a signed URL, but the garage row carries a `photo_url`
      the server signs its own way. Writing one into a row the next refresh
      overwrites is the disagreement that reads as a photo flickering back to
      the plate.
    */
    request.mockResolvedValue({ vehicles: [M235I] });
    const pickPhoto = jest.fn().mockResolvedValue(PICKED);

    const view = await renderGarage({ pickPhoto });
    await view.findByText('2015 BMW M235i');

    const before = request.mock.calls.length;
    await userEvent.setup().press(view.getByLabelText('Add photo'));

    await waitFor(() => {
      const paths = request.mock.calls.slice(before).map((call) => call[0]);
      expect(paths).toContain('/upload-photo');
      expect(paths).toContain('/vehicles');
    });
  });
});
