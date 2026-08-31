/**
 * The History tab — the invoices, and the way to add one.
 *
 * David, 30 Aug: history becomes the fourth tab, and it needs a control that
 * starts a scan. Both halves are here, plus the two things easiest to ship
 * wrong on a screen like this: counting lines instead of invoices, and showing
 * an inviting empty state after a failed load.
 */

import { render, userEvent, waitFor } from '@testing-library/react-native';

import { InvoiceHistoryScreen } from '../InvoiceHistoryScreen';
import { apiRequest, ApiRequestError } from '../../api/client';

jest.mock('../../api/client', () => {
  const actual = jest.requireActual('../../api/client');
  return { ...actual, apiRequest: jest.fn() };
});

const request = apiRequest as jest.MockedFunction<typeof apiRequest>;

/**
 * ⚠ Both keys, because `/load-maintenance-data` returns two lists and reading
 * the wrong one was a live bug until 12 Aug 2026. A mock that returned only the
 * key the screen happens to read could not tell.
 */
const payload = (maintenanceLineItems: unknown[]) =>
  ({ lineItems: [], maintenanceLineItems }) as never;

const line = (over: Record<string, unknown> = {}) => ({
  id: `r-${Math.random().toString(36).slice(2, 8)}`,
  item_description: 'Front brake pads',
  service_date: '2026-05-01',
  shop_name: 'BAVARIAN AUTO',
  total_cost: 300,
  source: 'vision',
  source_document_id: 'doc-1',
  ...over,
});

async function setup(props: Partial<React.ComponentProps<typeof InvoiceHistoryScreen>> = {}) {
  const onScan = jest.fn();
  const onOpenInvoice = jest.fn();
  const view = await render(
    <InvoiceHistoryScreen
      vehicleId="v1"
      title="2019 BMW M3"
      onOpenInvoice={onOpenInvoice}
      onScan={onScan}
      onSignOut={jest.fn()}
      {...props}
    />
  );
  return { view, onScan, onOpenInvoice };
}

beforeEach(() => request.mockReset());

describe('an owner with no invoices', () => {
  it('is invited to scan one, rather than told a list is empty', async () => {
    request.mockResolvedValue(payload([]));
    const { view, onScan } = await setup();

    await waitFor(() => expect(view.getByText('No invoices yet')).toBeTruthy());
    await userEvent.press(view.getByText('Scan an invoice'));

    expect(onScan).toHaveBeenCalled();
  });

  it('shows one scan control, not two', async () => {
    /*
      The empty state offers the action and the pinned bar is hidden. Two
      identical buttons on one screenful is a screen that cannot decide what it
      wants — and the pinned one exists for long lists, which this is not.
    */
    request.mockResolvedValue(payload([]));
    const { view } = await setup();

    await waitFor(() => expect(view.getByText('No invoices yet')).toBeTruthy());
    expect(view.getAllByText('Scan an invoice')).toHaveLength(1);
  });
});

describe('the list counts invoices, never lines', () => {
  it('draws one row for a five-line invoice', async () => {
    /*
      ⚠ R17, on a new screen. The history screen drew one card per
      `maintenance_line_items` row, so a five-line invoice from one afternoon at
      one shop drew five cards repeating the same shop and total. Grouping is
      the whole reason this screen can exist without a documents endpoint.
    */
    request.mockResolvedValue(
      payload([
        line({ total_cost: 300 }),
        line({ total_cost: 120 }),
        line({ total_cost: 41 }),
        line({ total_cost: 500 }),
        line({ total_cost: 500 }),
      ])
    );
    const { view } = await setup();

    await waitFor(() => expect(view.getByText('1 invoice for 2019 BMW M3')).toBeTruthy());
    expect(view.getAllByText('Bavarian Auto')).toHaveLength(1);
    expect(view.getByText(/5 lines/)).toBeTruthy();
  });

  it('leaves typed records out — they are history, not invoices', async () => {
    /*
      A record with no source document was typed by hand or marked done from the
      wishlist. Both are real service history and neither is an invoice; listing
      them would claim a document exists for something nobody photographed.
    */
    request.mockResolvedValue(
      payload([
        line({ source_document_id: 'doc-1' }),
        line({ source_document_id: null, source: 'manual', item_description: 'Typed in' }),
      ])
    );
    const { view } = await setup();

    await waitFor(() => expect(view.getByText('1 invoice for 2019 BMW M3')).toBeTruthy());
    expect(view.queryByText('Typed in')).toBeNull();
  });

  it('opens the invoice with the lines it produced', async () => {
    request.mockResolvedValue(payload([line({ total_cost: 300 }), line({ total_cost: 120 })]));
    const { view, onOpenInvoice } = await setup();

    await waitFor(() => expect(view.getByText('Bavarian Auto')).toBeTruthy());
    await userEvent.press(view.getByText('Bavarian Auto'));

    const visit = onOpenInvoice.mock.calls[0][0];
    expect(visit.records).toHaveLength(2);
    expect(visit.total).toBe(420);
  });

  it('offers the pinned scan control once there is a list', async () => {
    request.mockResolvedValue(payload([line()]));
    const { view, onScan } = await setup();

    await waitFor(() => expect(view.getByText('Bavarian Auto')).toBeTruthy());
    await userEvent.press(view.getByText('Scan an invoice'));

    expect(onScan).toHaveBeenCalled();
  });
});

describe('a failed load is not an empty list', () => {
  it('says it could not load, and offers a retry', async () => {
    /*
      ⚠ The two states look identical as a blank screen and mean opposite
      things — and this screen's empty state invites a scan, so showing it after
      a failure would ask somebody to re-photograph an invoice they already
      have.
    */
    request.mockRejectedValue(
      new ApiRequestError({ status: 0, message: 'Network unavailable' })
    );
    const { view } = await setup();

    await waitFor(() => expect(view.getByText('Could not load your invoices')).toBeTruthy());
    expect(view.queryByText('No invoices yet')).toBeNull();
  });

  it('signs out only on a device 401, never a server one', async () => {
    /*
      MOB-08. A device 401 is genuinely signed out; a server 401 may be a token
      the server would accept a second later, and destroying a working session
      over one response is how a spurious failure becomes a forced re-login.
    */
    const onSignOut = jest.fn();
    /*
      `origin: 'server'` — the case that must NOT sign somebody out. The client
      goes to real trouble to tell the two apart and exactly one screen consumed
      the distinction before MOB-08.
    */
    request.mockRejectedValue(
      new ApiRequestError({ status: 401, origin: 'server', message: 'Unauthorized' })
    );
    const { view } = await setup({ onSignOut });

    await waitFor(() => expect(view.getByText('Could not load your invoices')).toBeTruthy());
    expect(onSignOut).not.toHaveBeenCalled();
  });
});
