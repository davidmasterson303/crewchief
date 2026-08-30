import { render, userEvent, waitFor } from '@testing-library/react-native';

import { ServiceMilestoneScreen } from '../ServiceMilestoneScreen';
import { apiRequest } from '../../api/client';
import { SERVICE_BASIS_LABELS } from '@wellkept/core/service-provenance';

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
function respondWith(maintenanceLineItems: unknown[] | Error) {
  request.mockImplementation(async (path: string) => {
    if (path.startsWith('/load-vehicle')) return VEHICLE as never;
    if (path.startsWith('/load-maintenance-data')) {
      if (maintenanceLineItems instanceof Error) throw maintenanceLineItems;
      /*
        ⚠ Both keys are returned, and they carry different things — because the
        real route returns both and the screen read the wrong one until
        12 Aug 2026.

        `lineItems` is `invoice_line_items`: a description and a price, with no
        service date and no mileage. `maintenanceLineItems` is the service
        record. A mock returning only the key the screen happens to read cannot
        tell the two apart, and this suite could not: it mirrored the bug.

        The decoy is shaped like a real invoice row so that a screen reading it
        would visibly answer "unknown" rather than crash.
      */
      return {
        lineItems: [
          { description: 'Engine oil and filter', quantity: 1, total_price: 92.4 },
        ],
        maintenanceLineItems,
      } as never;
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

describe('the history it reads is the service record, not the invoice lines', () => {
  /*
    The bug this pins, found 12 Aug 2026 and live since A2a shipped.

    `/load-maintenance-data` returns two things that both look like history:

      lineItems             -> invoice_line_items      (description, price)
      maintenanceLineItems  -> maintenance_line_items  (+ service_date, mileage)

    This screen read `lineItems`. Those rows carry **no service date and no
    mileage**, so every lookup built from them returned null — and A2a's fix,
    which exists precisely to stop every time-based service reporting
    "unknown", silently did nothing.

    It typechecked because `ServiceHistoryRow` accepts `description` *or*
    `item_description`, so an invoice row satisfies the type while being
    structurally unable to answer the question. **The server sweep always read
    the right table**, which is what makes this worth a guard: the notification
    could say a service was due since 85,000 miles while the screen it opened
    said nobody knows.

    The assertions below are about the "Timed by date, not mileage" card, which
    is the screen's own admission that it has no record — the exact symptom.
  */

  it('stops reporting a service as undated once a dated record exists', async () => {
    respondWith([
      {
        item_description: 'Brake fluid replacement',
        service_date: '2026-02-10',
        mileage_at_service: 58_000,
        source: 'invoice',
      },
    ]);

    const user = userEvent.setup();
    const view = await render(<ServiceMilestoneScreen vehicleId="v1" onSignOut={jest.fn()} />);
    await passTheGate(user, view);

    /*
      Asserted as the *absence* of the screen's own admission rather than the
      presence of the service name — once a service is dated it leaves the
      "Timed by date, not mileage" card and may not be rendered anywhere else,
      so presence is the wrong signal and was the first version of this test.
    */
    expect(view.queryByText(/Nothing on record says when these were last done/)).toBeNull();
  });

  it('does not mistake an invoice line for a service record', async () => {
    /*
      The decoy alone. `respondWith([])` still leaves `lineItems` populated with
      an invoice-shaped row — if the screen ever reads that key again, it would
      believe it has history and this goes red.
    */
    respondWith([]);

    const user = userEvent.setup();
    const view = await render(<ServiceMilestoneScreen vehicleId="v1" onSignOut={jest.fn()} />);
    await passTheGate(user, view);

    expect(await view.findByText(/Nothing on record says when these were last done/)).toBeTruthy();
  });
});

/**
 * ── R14 / §5: the question stopped being a screen ───────────────────────────
 *
 * This screen was one question, one field and one button, with 70% of the
 * display empty under it — and what is actually due was on the *other side* of
 * answering it. The review's general rule came out of this exact screen: no
 * screen exists whose only content is one question.
 */
describe('the mileage confirm', () => {
  it('shows what is due before the odometer is confirmed, not after', async () => {
    respondWith([]);
    const view = await render(<ServiceMilestoneScreen vehicleId="v1" onSignOut={jest.fn()} />);

    /*
      Both halves in one case, and the second is the one that changed: the
      question is still asked, and the schedule is on screen underneath it
      rather than behind it.
    */
    await view.findByText(/Still around .* miles\?/);
    expect((await view.findAllByText(/Engine oil and filter/i)).length).toBeGreaterThan(0);
  });

  it('says what the list below was worked out from', async () => {
    /*
      §10. The schedule is computed from the last reading, and the banner is
      what makes that true statement visible — a list computed from an
      unconfirmed number with nothing on screen saying so is the overclaim this
      product exists not to make.
    */
    respondWith([]);
    const view = await render(<ServiceMilestoneScreen vehicleId="v1" onSignOut={jest.fn()} />);

    await view.findByText(/The list below is worked out from this reading/);
  });

  it('drops the banner once the reading is confirmed', async () => {
    // The anti-vacuous half: a banner that never went away would pass above.
    respondWith([]);
    const user = userEvent.setup();
    const view = await render(<ServiceMilestoneScreen vehicleId="v1" onSignOut={jest.fn()} />);

    await user.press(await view.findByLabelText('That is right'));

    await waitFor(() => expect(view.queryByText(/Still around .* miles\?/)).toBeNull());
  });
});
