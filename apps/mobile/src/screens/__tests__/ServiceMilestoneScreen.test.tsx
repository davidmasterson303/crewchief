import { render, userEvent } from '@testing-library/react-native';

import { ServiceMilestoneScreen } from '../ServiceMilestoneScreen';
import { apiRequest } from '../../api/client';
import { SERVICE_BASIS_LABELS } from '@crewchief/core/service-provenance';

/**
 * Where a service notification lands.
 *
 * This screen is opened by a push the app sent unprompted, so nobody chose to
 * come here and nobody is primed to be sceptical of what it says. That is why
 * David's 7 Aug decision was **confirm, then assert, with provenance** — all
 * three — and why the provenance half is worth testing rather than eyeballing:
 * a wrong label is invisible, and structure confers authority the two inputs
 * have not earned.
 *
 * ── Why history is the thing under test ─────────────────────────────────────
 *
 * `evaluateSchedule` accepted `lastServiceMileage` and `lastServiceDate` from
 * the day it was written and **nothing ever passed either**, so every
 * time-based service reported `unknown` and every mileage-based one counted
 * from the odometer. The wiring that closed that is a day old and is the least
 * proven code on the screen.
 *
 * ── The two requests, and why only one may fail the screen ──────────────────
 *
 * `/load-vehicle` is the screen. `/load-maintenance-data` improves what it can
 * say. Losing the second returns the screen to exactly the behaviour it shipped
 * with, so it is caught and swallowed — asserted below, because a `Promise.all`
 * here would let a maintenance blip blank a screen a notification just opened.
 */

jest.mock('../../api/client', () => {
  const actual = jest.requireActual('../../api/client');
  return { ...actual, apiRequest: jest.fn() };
});

const request = apiRequest as jest.MockedFunction<typeof apiRequest>;

const VEHICLE = {
  vehicle: { year: 2018, make: 'Honda', model: 'Accord', current_mileage: 94_800 },
  knowledge: {
    maintenance_schedule: [
      { service: 'Engine oil and filter', interval_miles: 7_500, priority: 'Critical' },
      { service: 'Brake fluid replacement', interval_months: 24, priority: 'Critical' },
    ],
  },
};

/**
 * Routes each call by path, because the screen fires both in parallel and
 * `mockResolvedValueOnce` would bind to whichever happened to settle first.
 */
function respondWith(lineItems: unknown[] | Error) {
  request.mockImplementation(async (path: string) => {
    if (path.startsWith('/load-vehicle')) return VEHICLE as never;
    if (path.startsWith('/load-maintenance-data')) {
      if (lineItems instanceof Error) throw lineItems;
      return { lineItems } as never;
    }
    return {} as never;
  });
}

/** The screen gates on confirming the odometer before it asserts anything. */
async function passTheGate(
  user: ReturnType<typeof userEvent.setup>,
  view: Awaited<ReturnType<typeof render>>
) {
  await view.findByText(/Still around/);
  await user.press(view.getByText('That is right'));
}

beforeEach(() => {
  request.mockReset();
});

describe('the odometer gate', () => {
  it('asks before it asserts anything', async () => {
    /*
      The whole screen rests on a mileage the owner typed at some point in the
      past. Asserting "your 100,000 service is due" over a stale number is the
      failure the gate exists to prevent.
    */
    respondWith([]);
    const view = await render(<ServiceMilestoneScreen vehicleId="v1" onSignOut={jest.fn()} />);

    expect(await view.findByText(/Still around/)).toBeTruthy();
    expect(view.queryByText(/Nothing due right now/)).toBeNull();
  });

  it('shows the answer once the reading is confirmed', async () => {
    const user = userEvent.setup();
    respondWith([]);

    const view = await render(<ServiceMilestoneScreen vehicleId="v1" onSignOut={jest.fn()} />);
    await passTheGate(user, view);

    expect(view.queryByText(/Still around/)).toBeNull();
  });
});

describe('provenance', () => {
  it('says "estimated" when there is no history to count from', async () => {
    // The second-hand car with nothing recorded — the common case, and the one
    // that must not claim to be reading records.
    const user = userEvent.setup();
    respondWith([]);

    const view = await render(<ServiceMilestoneScreen vehicleId="v1" onSignOut={jest.fn()} />);
    await passTheGate(user, view);

    expect(await view.findByText(SERVICE_BASIS_LABELS['mileage-estimate'])).toBeTruthy();
    expect(view.queryByText(SERVICE_BASIS_LABELS['service-history'])).toBeNull();
  });

  it('claims service records only when every service in the visit has them', async () => {
    const user = userEvent.setup();
    respondWith([
      {
        item_description: 'Oil change — full synthetic',
        service_date: '2026-02-10',
        mileage_at_service: 92_000,
        source: 'vision',
      },
    ]);

    const view = await render(<ServiceMilestoneScreen vehicleId="v1" onSignOut={jest.fn()} />);
    await passTheGate(user, view);

    // The oil service now counts from 92,000 rather than from the odometer.
    expect(await view.findByText(SERVICE_BASIS_LABELS['service-history'])).toBeTruthy();
  });

  it('does not let a remembered date pass as a record', async () => {
    /*
      Track A2a's distinction, end to end: a row written by the onboarding
      question carries `source: 'owner-onboarding'`, and the milestone must say
      so rather than claiming "from your service records". An invoice is
      evidence; "I think it was around 92,000" is a recollection.
    */
    const user = userEvent.setup();
    respondWith([
      {
        item_description: 'Oil change — reported at sign-up',
        service_date: '2026-02-10',
        mileage_at_service: 92_000,
        source: 'owner-onboarding',
      },
    ]);

    const view = await render(<ServiceMilestoneScreen vehicleId="v1" onSignOut={jest.fn()} />);
    await passTheGate(user, view);

    expect(await view.findByText(SERVICE_BASIS_LABELS['owner-reported'])).toBeTruthy();
    expect(view.queryByText(SERVICE_BASIS_LABELS['service-history'])).toBeNull();
  });
});

describe('when the maintenance request fails', () => {
  it('still renders the screen', async () => {
    /*
      A push notification opened this. Blanking it because a secondary request
      failed is the worst possible response — the person came here from an
      alert and finds nothing at all.
    */
    const user = userEvent.setup();
    respondWith(new Error('maintenance is down'));

    const view = await render(<ServiceMilestoneScreen vehicleId="v1" onSignOut={jest.fn()} />);
    await passTheGate(user, view);

    expect(view.queryByText(/Still around/)).toBeNull();
    expect(await view.findByText(SERVICE_BASIS_LABELS['mileage-estimate'])).toBeTruthy();
  });

  it('degrades to estimating rather than to an error', async () => {
    // Losing history returns this screen to exactly the behaviour it shipped
    // with, which is a known-good state rather than a broken one.
    const user = userEvent.setup();
    respondWith(new Error('maintenance is down'));

    const view = await render(<ServiceMilestoneScreen vehicleId="v1" onSignOut={jest.fn()} />);
    await passTheGate(user, view);

    expect(view.queryByText(/Could not load/i)).toBeNull();
  });
});
