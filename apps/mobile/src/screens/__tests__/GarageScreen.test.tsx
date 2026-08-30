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
  } = {}
) {
  return render(
    <GarageScreen
      accessToken="test-token"
      email="owner@example.test"
      onSignOut={jest.fn()}
      onOpenVehicle={jest.fn()}
      onAddVehicle={overrides.onAddVehicle ?? jest.fn()}
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

    expect(view.getByText('1 open recall')).toBeTruthy();
  });

  it('subtracts what the owner has marked repaired', async () => {
    request.mockResolvedValue({
      vehicles: [{ ...M235I, recall_actions: [{ campaign_number: '23V-441' }] }],
    });

    const view = await renderGarage();
    await view.findByText('2015 BMW M235i');

    // Two on record, one marked — and the chip is the count of what is left.
    expect(view.getByText('1 open recall')).toBeTruthy();
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

    expect(view.getByText('2 open recalls')).toBeTruthy();
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
    expect(view.getByText('2 open recalls')).toBeTruthy();
  });
});

/*
  ── ⚠ R13 · these five cases moved, and moving them is the point ────────────

  They asserted that `GarageScreen` renders an "Account" control in every state
  it can be in — loading, API failure, expired session, empty garage, first run
  — because App Store 5.1.1(v) requires deletion to be genuinely reachable, and
  because it had been lost in an early return once already.

  Account is a **tab** now. It is one tap from every screen in the app rather
  than from this one, so "does the garage render it in all five of its states"
  is no longer the question — the garage renders it in none of them, correctly.

  The guarantee is stronger and is checked where it now lives:
  `TabBar.test.tsx` for the control, and `lib/__tests__/mobile-account-reachable.test.ts`
  for the wiring that keeps the bar outside the navigator's screens. Neither can
  be satisfied by an early return, which is what these five were guarding
  against by hand.
*/

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
      `@wellkept/core/first-run` carries the argument.
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

/*
  ── ⚠ R18, 23 Aug: the garage has no photo control ─────────────────────────

  `describe('adding a photograph')` lived here and is **deleted rather than
  skipped**. A solid "Change photo" pill sat on the bay's photograph at the top
  right — visually the loudest control on the home screen, for the least
  frequent action anyone takes, on a screen whose one job is "open this car".

  The picker prop, the upload, its busy state and its error banner went with it.
  The behaviour those cases protected did not disappear: it is the vehicle
  hero's, where v8.2 already ruled the control is that hero's implied action,
  and `VehicleDetailScreen.test.tsx` is where it is now covered.
*/

/**
 * ── R19 / R20: what the bay leads with ──────────────────────────────────────
 *
 * Both findings are about the same screen telling the reader the wrong thing
 * first — the dial dominating an open safety recall, and a pager counting to
 * one.
 */
describe('the bay’s hierarchy', () => {
  it('puts an open recall above the dial, not under it', async () => {
    request.mockResolvedValue({
      vehicles: [
        {
          ...M235I,
          vehicle_health_summary: { health_score: 70 },
          nhtsa_data: {
            recalls: [
              { NHTSACampaignNumber: '25V871000', Component: 'AIR BAGS', Summary: 'May rupture.' },
            ],
          },
        },
      ],
    });

    const view = await renderGarage();
    const chip = await view.findByText('1 open recall');

    /*
      Order in the rendered tree, which is what a sighted reader scans and what
      a screen reader walks. Asserted as *position* rather than as a style: the
      finding was hierarchy, and a chip that merely got bigger under the dial
      would still be under the dial.
    */
    const order = view.toJSON();
    const flat: string[] = [];
    const walk = (node: unknown) => {
      if (typeof node === 'string') return flat.push(node);
      if (!node || typeof node !== 'object') return;
      const host = node as { children?: unknown[] };
      for (const child of host.children ?? []) walk(child);
    };
    walk(order);

    const recallAt = flat.findIndex((line) => line.includes('open recall'));
    const dialAt = flat.findIndex((line) => line === '70');

    expect(chip).toBeTruthy();
    expect(recallAt).toBeGreaterThan(-1);
    expect(dialAt).toBeGreaterThan(-1);
    expect(recallAt).toBeLessThan(dialAt);
  });

  it('does not page a garage of one', async () => {
    request.mockResolvedValue({ vehicles: [M235I] });
    const view = await renderGarage();

    await view.findByText(/M235i/);
    // R20. "1 of 1" is a pager for a list that cannot be paged.
    expect(view.queryByText('1 of 1')).toBeNull();
  });

  it('still pages a garage of two', async () => {
    // The anti-vacuous half: suppressing the pager everywhere would pass above.
    request.mockResolvedValue({
      vehicles: [M235I, { ...M235I, id: 'v2', year: 2018, make: 'Honda', model: 'Accord' }],
    });
    const view = await renderGarage();

    await view.findByText(/M235i/);
    view.getByText('1 of 2');
  });
});

/**
 * ── R21: the next-service row leads somewhere ───────────────────────────────
 *
 * "Engine oil and filter · in 420 mi" is the single most actionable string on
 * the home screen, and it was a readout. It opens `Service → Due` now.
 */
describe('the next-service row', () => {
  it('opens what is due when there is an answer', async () => {
    const onOpenService = jest.fn();
    request.mockResolvedValue({
      vehicles: [
        {
          ...M235I,
          next_service_label: 'Engine oil and filter',
          next_service_at_miles: 70_000,
        },
      ],
    });

    const view = await render(
      <GarageScreen
        accessToken="test-token"
        email="owner@example.test"
        onSignOut={jest.fn()}
        onOpenVehicle={jest.fn()}
        onOpenService={onOpenService}
        onAddVehicle={jest.fn()}
      />
    );

    await view.findByText('Engine oil and filter');
    await userEvent.press(view.getByLabelText(/^Next service: Engine oil and filter/));

    expect(onOpenService).toHaveBeenCalledWith('db143cdc-e68c-46f0-849e-69f7a1873f58', '2015 BMW M235i');
  });

  it('is a readout, not a target, when there is no schedule', async () => {
    /*
      ⚠ "No schedule yet" is a statement, not a destination. A pressable row
      leading to a screen that says the same thing is worse than an unpressable
      one — and it would be the common case, because most cars in this product
      have no `next_service_*` yet.
    */
    request.mockResolvedValue({ vehicles: [M235I] });

    const view = await render(
      <GarageScreen
        accessToken="test-token"
        email="owner@example.test"
        onSignOut={jest.fn()}
        onOpenVehicle={jest.fn()}
        onOpenService={jest.fn()}
        onAddVehicle={jest.fn()}
      />
    );

    await view.findByText(/M235i/);
    expect(view.queryByLabelText(/^Next service:/)).toBeNull();
  });
});
