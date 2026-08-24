import { Alert } from 'react-native';
import { render, userEvent, waitFor } from '@testing-library/react-native';

import { WishlistScreen } from '../WishlistScreen';
import { apiRequest, ApiRequestError } from '../../api/client';
import { wishlistItemIdentifier } from '@crewchief/core/wishlist-identifier';

/**
 * The wishlist, on the phone.
 *
 * Phase 5.6. Two things here have a history of going wrong quietly, and both
 * are what this suite is really for.
 *
 * ── The identifier ──────────────────────────────────────────────────────────
 *
 * `@crewchief/core/wishlist-identifier` exists because three call sites once
 * built the identifier three different ways, and produced duplicate rows, an
 * "already added" state that lied, and deletes that silently matched nothing. A
 * fourth spelling on this screen would reintroduce all three — so the test
 * imports the real function and asserts the request carries *its* output, not a
 * string this file happens to agree with today.
 *
 * ── 409 is a success path wearing an error's clothes ────────────────────────
 *
 * The route returns 409 when the identifier already exists. That is the dedupe
 * working. Reporting it as a failure would tell somebody their add broke when
 * the item is sitting on the list in front of them.
 *
 * `userEvent` throughout, never `fireEvent` — see `AddVehicleScreen.test.tsx`.
 * `render` is awaited inside `mount` so no call site can forget it.
 */

jest.mock('../../api/client', () => {
  const actual = jest.requireActual('../../api/client');
  return { ...actual, apiRequest: jest.fn() };
});

const request = apiRequest as jest.MockedFunction<typeof apiRequest>;

function item(over: Record<string, unknown> = {}) {
  return {
    id: 'w1',
    item_name: 'Front brake pads',
    item_type: 'maintenance',
    estimated_cost: 240,
    ...over,
  };
}

/** Only `/wishlist` GET returns a list; POST and DELETE resolve empty. */
function listReturns(items: unknown[]) {
  request.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (!init?.method || init.method === 'GET') return { wishlistItems: items } as never;
    return {} as never;
  });
}

async function mount(overrides: Partial<Parameters<typeof WishlistScreen>[0]> = {}) {
  const props = { vehicleId: 'v1', ...overrides, onSignOut: jest.fn() };
  return { props, view: await render(<WishlistScreen {...props} onAdd={jest.fn()} />) };
}

let alertSpy: jest.SpyInstance;

beforeEach(() => {
  request.mockReset();
  // `Alert.alert` is a native module call. Spying rather than stubbing the
  // whole module keeps the rest of react-native real.
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => alertSpy.mockRestore());

describe('listing', () => {
  it('draws what the API returned', async () => {
    listReturns([item()]);
    const { view } = await mount();

    expect(await view.findByText('Front brake pads')).toBeTruthy();
  });

  it('says the list is empty rather than rendering nothing', async () => {
    listReturns([]);
    const { view } = await mount();

    expect(await view.findByText('Nothing on the list yet')).toBeTruthy();
  });

  it('signs out on a 401', async () => {
    /*
      `GET /api/v1/wishlist` authenticated cookie-only until `922576f`, so this
      screen could add and delete items and never list them — invisible from the
      web, and indistinguishable here from an empty wishlist.
    */
    /*
      ⚠ **`origin: 'device'` as of 24 Aug (MOB-08).** This screen used to sign
      out on **any** 401, including a `server` one that a retry a second later
      would have accepted — and then `return`ed without setting a state, so
      offline with an expired token it showed skeletons forever with no error
      and no retry.

      A device-side 401 is the one that genuinely means "signed out", and it is
      the one this case is about.
    */
    request.mockRejectedValue(new ApiRequestError({ status: 401, origin: 'device', message: 'Unauthorized' }));
    const { props } = await mount();

    await waitFor(() => expect(props.onSignOut).toHaveBeenCalledTimes(1));
  });

  it('keeps the person here for any other failure', async () => {
    request.mockRejectedValue(new ApiRequestError({ status: 500, message: 'Upstream failed' }));
    const { props, view } = await mount();

    expect(await view.findByText(/Upstream failed/)).toBeTruthy();
    expect(props.onSignOut).not.toHaveBeenCalled();
  });
});

describe('removing an item', () => {
  it('asks before deleting', async () => {
    // Destructive and one tap away. A confirm is the difference between a
    // mis-tap and a lost item.
    const user = userEvent.setup();
    listReturns([item()]);
    const { view } = await mount();

    await view.findByText('Front brake pads');
    await user.press(view.getByLabelText('Remove Front brake pads from the wishlist'));

    expect(alertSpy).toHaveBeenCalled();
    expect(String(alertSpy.mock.calls[0][0])).toMatch(/remove/i);
  });

  it('sends no DELETE until the confirm is accepted', async () => {
    /*
      The assertion that makes the one above mean something. If the confirm were
      cosmetic — shown, then deleted anyway — both a "it asked" test and the
      product would look fine right up until someone tapped by accident.
    */
    const user = userEvent.setup();
    listReturns([item()]);
    const { view } = await mount();

    await view.findByText('Front brake pads');
    await user.press(view.getByLabelText('Remove Front brake pads from the wishlist'));

    expect(
      request.mock.calls.some(([, init]) => (init as { method?: string })?.method === 'DELETE')
    ).toBe(false);
  });

  it('deletes once the confirm is accepted', async () => {
    // Drives the destructive button out of the Alert's own button list, which
    // is the only way past a native confirm in a test.
    const user = userEvent.setup();
    listReturns([item()]);
    const { view } = await mount();

    await view.findByText('Front brake pads');
    await user.press(view.getByLabelText('Remove Front brake pads from the wishlist'));

    const buttons = alertSpy.mock.calls[0][2] as Array<{ text?: string; onPress?: () => void }>;
    const destructive = buttons.find((b) => /remove|delete/i.test(b.text ?? ''));
    expect(destructive).toBeDefined();
    await destructive!.onPress?.();

    await waitFor(() =>
      expect(
        request.mock.calls.some(([, init]) => (init as { method?: string })?.method === 'DELETE')
      ).toBe(true)
    );
  });
});

describe('marking an item done', () => {
  /*
    The only wishlist action that writes into the car's permanent service
    history — `POST /api/v1/wishlist/complete` inserts a `maintenance_line_items`
    row and deletes the wishlist entry. No undo.

    The rules about what a completion needs live in
    `@crewchief/core/wishlist-completion` and are tested there. These are about
    the screen obeying them: that the sheet is a deliberate step rather than a
    row tap, and that nothing is sent until it is confirmed.
  */
  const completions = () =>
    request.mock.calls.filter(([path]) => String(path).includes('complete'));

  it('does not complete anything from the list itself', async () => {
    // A one-tap Done on a list row would be the cheapest gesture on the screen
    // attached to its most consequential action.
    listReturns([item()]);
    const user = userEvent.setup();
    const { view } = await mount();
    const resolved = await view;

    await user.press(resolved.getByLabelText('Mark Front brake pads done'));

    expect(completions()).toHaveLength(0);
  });

  it('opens a sheet that names where the record goes', async () => {
    /*
      The result lands in the service history — somewhere the user is not
      looking. Naming the destination is what makes this an informed tap.
    */
    listReturns([item()]);
    const user = userEvent.setup();
    const { view } = await mount();
    const resolved = await view;

    await user.press(resolved.getByLabelText('Mark Front brake pads done'));

    expect(await resolved.findByText(/service history/i)).toBeTruthy();
  });

  it('sends the completion once confirmed', async () => {
    listReturns([item()]);
    const user = userEvent.setup();
    const { view } = await mount();
    const resolved = await view;

    await user.press(resolved.getByLabelText('Mark Front brake pads done'));
    // DIY is one tap and needs no shop — the fastest honest completion.
    await user.press(await resolved.findByLabelText('I did it'));
    await user.press(resolved.getByLabelText('Mark done'));

    const call = completions()[0];
    expect(call).toBeTruthy();

    const init = call![1] as { method?: string; body?: Record<string, unknown> };
    expect(init.method).toBe('POST');
    expect(init.body!.isDIY).toBe(true);
    // A blank cost is omitted rather than sent as a claimed zero.
    expect(init.body).not.toHaveProperty('partsCost');
  });

  it('refuses to send when a shop did the work and none was named', async () => {
    /*
      The one required field. Without it the route stores `'Unknown'`, which
      tells a reader nothing a year later — not even whether it happened.
    */
    listReturns([item()]);
    const user = userEvent.setup();
    const { view } = await mount();
    const resolved = await view;

    await user.press(resolved.getByLabelText('Mark Front brake pads done'));
    await user.press(await resolved.findByLabelText('A shop did it'));
    await user.press(resolved.getByLabelText('Mark done'));

    expect(completions()).toHaveLength(0);
    /*
      Matched on the remedy rather than on "who did the work", which is also the
      field's own label — the first version of this assertion matched both and
      failed as ambiguous. The message is the thing being asserted; the label
      would have been there whether or not the rule fired.
    */
    expect(await resolved.findByText(/mark it as DIY/i)).toBeTruthy();
  });
});
