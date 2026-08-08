import { render, waitFor } from '@testing-library/react-native';

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
  nhtsa_data: { recalls: [{ id: 1 }, { id: 2 }] },
};

/**
 * `render` is **async** in @testing-library/react-native 14 — React 19 made
 * mounting concurrent, so it returns a Promise. Forgetting the `await` gives
 * `view.findByText is not a function`, or an unpopulated `screen` reporting
 * that render "has not been called", neither of which names the cause.
 */
function renderGarage() {
  return render(
    <GarageScreen
      accessToken="test-token"
      email="owner@example.test"
      onSignOut={jest.fn()}
      onOpenVehicle={jest.fn()}
    />
  );
}

beforeEach(() => jest.clearAllMocks());

describe('the garage', () => {
  it('draws a vehicle the API returned', async () => {
    request.mockResolvedValue({ vehicles: [M235I] });

    const view = await renderGarage();

    expect(await view.findByText('2015 BMW M235i')).toBeTruthy();
    // Formatted, not raw. `vehicle_status` reached the screen as
    // "daily_driver" once, and only looking at it caught that.
    expect(view.getByText('Daily Driver')).toBeTruthy();
    expect(view.getByText('66,000 mi')).toBeTruthy();
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
    // The ordinary first-run state, and not a failure.
    request.mockResolvedValue({ vehicles: [] });

    const view = await renderGarage();

    expect(await view.findByLabelText('Account')).toBeTruthy();
    expect(view.getByText('No vehicles yet')).toBeTruthy();
  });
});
