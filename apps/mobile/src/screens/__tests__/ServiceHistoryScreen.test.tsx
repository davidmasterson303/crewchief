/**
 * What has been done to this car, on the phone.
 *
 * The phone could write to the service record three ways and read it back
 * nowhere. These cover the reading — and specifically the part that is easy to
 * ship wrong: a list makes every row look equally solid, and one of them may be
 * something the owner half-remembered on a sign-up screen.
 */

import { render, userEvent, waitFor } from '@testing-library/react-native';

import { ServiceHistoryScreen } from '../ServiceHistoryScreen';
import { apiRequest, ApiRequestError } from '../../api/client';

jest.mock('../../api/client', () => {
  const actual = jest.requireActual('../../api/client');
  return { ...actual, apiRequest: jest.fn() };
});

const request = apiRequest as jest.MockedFunction<typeof apiRequest>;

/**
 * ⚠ Both keys, always, and carrying different things.
 *
 * `/load-maintenance-data` returns `lineItems` (`invoice_line_items` — a
 * description and a price, no date) alongside `maintenanceLineItems` (the
 * service record). `ServiceMilestoneScreen` read the wrong one until 12 Aug
 * 2026 and its suite could not tell, because the mock returned only the key the
 * screen happened to read.
 *
 * The decoy here names a service that is not in the real record, so a screen
 * reading it would show a row that should not exist.
 */
function respondWith(maintenanceLineItems: unknown[]) {
  request.mockImplementation(async () => ({
    lineItems: [{ description: 'Cabin air filter', quantity: 1, total_price: 40 }],
    maintenanceLineItems,
  }) as never);
}

const INVOICE_ROW = {
  id: 'm1',
  item_description: 'Front brake pads & rotors, replace',
  service_date: '2026-08-02',
  shop_name: 'BLACKMARKET MOTORSPORTS',
  total_cost: 678,
  mileage_at_service: 61_400,
  source: 'vision',
};

const RECOLLECTION_ROW = {
  id: 'm2',
  item_description: 'Timing belt',
  service_date: '2024-05-01',
  total_cost: null,
  mileage_at_service: 48_000,
  source: 'owner-onboarding',
};

function mount() {
  return render(<ServiceHistoryScreen vehicleId="v1" onSignOut={jest.fn()} />);
}

beforeEach(() => {
  request.mockReset();
});

describe('reading the record', () => {
  it('draws what the service record returned', async () => {
    respondWith([INVOICE_ROW]);
    const view = await mount();

    expect(await view.findByText(/Front brake pads/)).toBeTruthy();
    expect(view.getByText(/BLACKMARKET MOTORSPORTS/)).toBeTruthy();
  });

  it('does not draw invoice lines as though they were services', async () => {
    /*
      The bug that was live on the sibling screen. If this one ever reads
      `lineItems`, the decoy appears and this goes red.
    */
    respondWith([INVOICE_ROW]);
    const view = await mount();

    await view.findByText(/Front brake pads/);
    expect(view.queryByText(/Cabin air filter/)).toBeNull();
  });

  it('says the list is empty rather than rendering nothing', async () => {
    respondWith([]);
    const view = await mount();

    expect(await view.findByText('Nothing recorded yet')).toBeTruthy();
  });
});

describe('provenance', () => {
  /*
    The reason this screen is worth building carefully. `20260808150000` added
    `'owner-onboarding'` rather than reusing `'manual'` so the product could say
    "an invoice is evidence, a recollection is not" — and a list is where that
    distinction is either visible or lost.
  */

  it('attributes a row read from an invoice', async () => {
    respondWith([INVOICE_ROW]);
    const view = await mount();

    expect(await view.findByText(/Read from an invoice/)).toBeTruthy();
  });

  it('marks a recollection as one, in different words', async () => {
    respondWith([RECOLLECTION_ROW]);
    const view = await mount();

    const label = await view.findByText(/told us at sign-up/i);
    expect(label).toBeTruthy();
    // And it must not be dressed as a record.
    expect(view.queryByText(/Read from an invoice/)).toBeNull();
  });

  it('says nothing at all for a row with no source', async () => {
    /*
      Rows predate the column. An unattributed row is old, not suspicious, and
      inventing an attribution is the failure the column exists to prevent.
    */
    respondWith([{ ...INVOICE_ROW, source: null }]);
    const view = await mount();

    await view.findByText(/Front brake pads/);
    expect(view.queryByText(/Read from an invoice/)).toBeNull();
    expect(view.queryByText(/told us at sign-up/i)).toBeNull();
  });
});

describe('the total', () => {
  it('says how many rows it covers when it does not cover them all', async () => {
    /*
      A total over some rows read as a total over all of them is the misreading
      this line exists to prevent. `RECOLLECTION_ROW` has no cost.
    */
    respondWith([INVOICE_ROW, RECOLLECTION_ROW]);
    const view = await mount();

    expect(await view.findByText(/across 1 of 2/)).toBeTruthy();
  });

  it('does not qualify a total that covers everything', async () => {
    respondWith([INVOICE_ROW]);
    const view = await mount();

    await view.findByText(/Front brake pads/);
    expect(view.queryByText(/across/)).toBeNull();
  });
});

describe('failure', () => {
  it('shows an error rather than an empty list', async () => {
    /*
      "No service history" and "we could not load it" look identical as a blank
      screen and mean opposite things. The route was changed for this exact
      reason; throwing it away here would undo that.
    */
    request.mockRejectedValue(new ApiRequestError({ status: 0, message: 'Network unavailable' }));
    const view = await mount();

    expect(await view.findByText('Could not load the service history')).toBeTruthy();
    expect(view.queryByText('Nothing recorded yet')).toBeNull();
  });

  it('signs out on a 401', async () => {
    const onSignOut = jest.fn();
    request.mockRejectedValue(new ApiRequestError({ status: 401, message: 'Unauthorized' }));

    await render(<ServiceHistoryScreen vehicleId="v1" onSignOut={onSignOut} />);

    await waitFor(() => expect(onSignOut).toHaveBeenCalled());
  });

  it('lets the person retry', async () => {
    request.mockRejectedValueOnce(new ApiRequestError({ status: 0, message: 'Network unavailable' }));
    const user = userEvent.setup();
    const view = await mount();

    await view.findByText('Could not load the service history');
    respondWith([INVOICE_ROW]);
    await user.press(view.getByLabelText('Try again'));

    expect(await view.findByText(/Front brake pads/)).toBeTruthy();
  });
});
