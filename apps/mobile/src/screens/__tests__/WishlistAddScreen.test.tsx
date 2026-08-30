import { render, userEvent, waitFor } from '@testing-library/react-native';

import { WishlistAddScreen } from '../WishlistAddScreen';
import { apiRequest, ApiRequestError } from '../../api/client';
import { wishlistItemIdentifier } from '@wellkept/core/wishlist-identifier';

/**
 * The wishlist's catalogue.
 *
 * ── Half of this file moved here rather than being written ──────────────────
 *
 * The identifier, the type, the empty-entry refusal, the 409 reading and the
 * 401 sign-out were all asserted against `WishlistScreen`'s composer. The
 * composer is gone — adding is a route now — so the claims moved with the
 * behaviour instead of being deleted with the control. They were the expensive
 * ones to learn and none of them stopped being true.
 *
 * ⚠ Including the pair that exists because a test once passed vacuously: the
 * whitespace case is written beside one proving a real entry *does* post,
 * because the first draft of it pressed a control that never posts and
 * asserted "no POST" against nothing.
 *
 * ── What is new here ────────────────────────────────────────────────────────
 *
 * The suggestions themselves — that they come from all three knowledge-base
 * sources, that the filter narrows as you type, that an item already on the
 * list says so, and that free text still gets through. `wishlist-suggestions.ts`
 * owns the mapping and has its own tests; these are about the screen.
 */

jest.mock('../../api/client', () => {
  const actual = jest.requireActual('../../api/client');
  return { ...actual, apiRequest: jest.fn() };
});

const request = apiRequest as jest.MockedFunction<typeof apiRequest>;

/** The Accord's real knowledge base, trimmed — shapes read off the live row. */
const KNOWLEDGE = {
  known_issues: [
    {
      part: '10th Gen CVT Transmission',
      severity: 'Medium',
      description: 'CVT fluid degradation leads to hesitation and hunting.',
      mileage_range: '80,000-120,000 mi',
    },
    {
      part: 'Fuel injector seals',
      severity: 'High',
      description: 'Seals harden and weep. Left alone it becomes a fire risk.',
    },
  ],
  maintenance_schedule: [
    {
      service: 'Engine Oil (0W-20 Full Synthetic)',
      priority: 'Critical',
      description: 'Lubricates the turbo engine and prevents internal wear.',
      interval_miles: 5000,
    },
  ],
  common_mods: [
    { name: 'K&N Drop-in Air Filter', purpose: 'Modest airflow improvement, reusable', difficulty: 'Easy' },
  ],
};

function respond({ onList = [] as string[] } = {}) {
  request.mockImplementation((path: string, init?: { method?: string }) => {
    if (path.startsWith('/wishlist') && !init?.method) {
      return Promise.resolve({
        wishlistItems: onList.map((id) => ({ item_identifier: id })),
      } as never);
    }
    if (path.startsWith('/wishlist')) return Promise.resolve({} as never);
    return Promise.resolve({
      vehicle: { year: 2018, make: 'Honda', model: 'Accord' },
      knowledge: KNOWLEDGE,
    } as never);
  });
}

/** ⚠ `async`, and awaited — RNTL 14's `render` is async. See `jest.setup.js`. */
async function mount() {
  const props = {
    vehicleId: 'v1',
    title: '2018 Honda Accord',
    onSignOut: jest.fn(),
    onAskAdvisor: jest.fn(),
    onAdded: jest.fn(),
  };
  return { props, view: await render(<WishlistAddScreen {...props} />) };
}

const posted = () =>
  request.mock.calls.find(([path, init]) => path === '/wishlist' && init?.method === 'POST');

beforeEach(() => jest.clearAllMocks());

describe('the suggestions', () => {
  it('draws all three knowledge-base sources, not just the mods', async () => {
    /*
      `BuildScreen` had been reading `common_mods` for a day while this screen
      offered a text box. Issues and the schedule map onto the other two
      wishlist types exactly, which is the sign this was always the shape.
    */
    respond();
    const { view } = await mount();

    await view.findByText('Fuel injector seals');
    view.getByText('10th Gen CVT Transmission');
    view.getByText('Engine Oil (0W-20 Full Synthetic)');
    view.getByText('K&N Drop-in Air Filter');
  });

  it('puts what the research called urgent first', async () => {
    // A High-severity issue and a Critical service outrank a CVT flush and an
    // air filter. Ordered rather than grouped: grouping by type would file a
    // critical service under a cosmetic mod whenever the alphabet said so.
    respond();
    const { view } = await mount();

    await view.findByText('Fuel injector seals');

    const order: string[] = [];
    const walk = (node: unknown) => {
      if (typeof node === 'string') return order.push(node);
      if (!node || typeof node !== 'object') return;
      for (const child of (node as { children?: unknown[] }).children ?? []) walk(child);
    };
    walk(view.toJSON());

    const at = (needle: string) => order.findIndex((line) => line.includes(needle));
    expect(at('Fuel injector seals')).toBeLessThan(at('10th Gen CVT'));
    expect(at('Engine Oil')).toBeLessThan(at('K&N'));
  });

  it('colours a chip only where the research made a severity call', async () => {
    /*
      ⚠ The spec's rule: "priority chips are neutral unless the item is
      genuinely urgent." A list where half the chips are amber has taught its
      reader that amber means nothing.
    */
    respond();
    const { view } = await mount();

    await view.findByText('Fuel injector seals');

    /*
      ⚠ **R40, 23 Aug.** Every chip now names the row's *kind*; none of them
      names its priority. The urgent rows used to read "Do first" — and because
      the list is sorted urgent-first, that word appeared on every row of the
      first screenful and told the reader nothing the order had not. Urgency is
      the section header and the chip's colour.
    */
    // `ListGroup` uppercases its label, so the header reads DO FIRST; the row's
    // chip does not, which is what makes these two distinguishable here.
    expect(view.getAllByText('DO FIRST')).toHaveLength(1);
    expect(view.queryByText('Do first')).toBeNull();

    // Two urgent rows, each still naming what kind of thing it is.
    expect(view.getAllByText('Known issue').length).toBeGreaterThan(0);
    view.getByText('Modification');
  });

  it('drops the sections while filtering, because a result set is not a plan', async () => {
    respond();
    const user = userEvent.setup();
    const { view } = await mount();

    await view.findByText('Fuel injector seals');
    await user.type(view.getByLabelText("Search suggestions"), 'filter');

    // The count is the useful label on a search; "Do first" over one match is not.
    expect(view.queryByText('DO FIRST')).toBeNull();
    expect(view.queryByText('EVERYTHING ELSE')).toBeNull();
  });
});

describe('filtering as you type', () => {
  it('narrows on every keystroke, with no debounce to wait through', async () => {
    respond();
    const user = userEvent.setup();
    const { view } = await mount();

    await view.findByText('K&N Drop-in Air Filter');
    await user.type(view.getByLabelText("Search suggestions"), 'filter');

    view.getByText('K&N Drop-in Air Filter');
    expect(view.queryByText('Fuel injector seals')).toBeNull();
  });

  it('matches the reason, not only the name', async () => {
    /*
      Somebody searching "fluid" should find "10th Gen CVT Transmission", whose
      reason opens "CVT fluid degradation…". A name-only filter looks broken to
      everyone who does not already know the part's formal title — which is
      most people, and the entire audience for a suggestion list.
    */
    respond();
    const user = userEvent.setup();
    const { view } = await mount();

    await view.findByText('K&N Drop-in Air Filter');
    await user.type(view.getByLabelText("Search suggestions"), 'hesitation');

    view.getByText('10th Gen CVT Transmission');
    expect(view.queryByText('K&N Drop-in Air Filter')).toBeNull();
  });

  it('offers to add whatever was typed when nothing matches', async () => {
    // ⚠ The catalogue is an accelerator, never a gate. The noise an owner's
    // gearbox makes is in no research payload. §10.
    respond();
    const user = userEvent.setup();
    const { view } = await mount();

    await view.findByText('K&N Drop-in Air Filter');
    await user.type(view.getByLabelText("Search suggestions"), 'clunk over bumps');

    await view.findByLabelText('Add clunk over bumps to the wishlist');
    view.getByText(/Nothing we know about matches/i);
  });
});

describe('adding — the claims that moved from the composer', () => {
  it('sends the identifier core computes, not one spelled here', async () => {
    /*
      The whole reason `wishlist-identifier` was extracted. Asserting against
      the real function rather than a literal means this cannot drift into
      agreeing with a fourth spelling.
    */
    respond();
    const user = userEvent.setup();
    const { view } = await mount();

    await view.findByText('K&N Drop-in Air Filter');
    await user.press(view.getByLabelText('Add K&N Drop-in Air Filter to the wishlist'));

    await waitFor(() => expect(posted()).toBeDefined());
    expect(posted()![1]?.body).toMatchObject({
      vehicleId: 'v1',
      itemType: 'modification',
      itemName: 'K&N Drop-in Air Filter',
      itemIdentifier: wishlistItemIdentifier('modification', 'K&N Drop-in Air Filter'),
    });
  });

  it('files each suggestion as the type its source implies', async () => {
    // The type is half the identifier, so filing an issue as maintenance would
    // dedupe against the wrong thing.
    respond();
    const user = userEvent.setup();
    const { view } = await mount();

    await view.findByText('Fuel injector seals');
    await user.press(view.getByLabelText('Add Fuel injector seals to the wishlist'));

    await waitFor(() => expect(posted()).toBeDefined());
    expect(posted()![1]?.body).toMatchObject({
      itemType: 'issue',
      itemIdentifier: wishlistItemIdentifier('issue', 'Fuel injector seals'),
    });
  });

  it('carries the reason onto the row, not just the name', async () => {
    // Six weeks later "Charge pipe" on a list has lost the only thing that made
    // it a recommendation rather than a shopping line.
    respond();
    const user = userEvent.setup();
    const { view } = await mount();

    await view.findByText('Fuel injector seals');
    await user.press(view.getByLabelText('Add Fuel injector seals to the wishlist'));

    await waitFor(() => expect(posted()).toBeDefined());
    expect(String((posted()![1]?.body as Record<string, unknown>).description)).toMatch(/fire risk/i);
  });

  it('sends nothing for a whitespace-only entry', async () => {
    respond();
    const user = userEvent.setup();
    const { view } = await mount();

    await view.findByText('K&N Drop-in Air Filter');
    await user.type(view.getByLabelText("Search suggestions"), '   ');

    expect(view.queryByLabelText(/^Add {3}to the wishlist$/)).toBeNull();
    expect(posted()).toBeUndefined();
  });

  it('but does send for real text — proving the refusal above is real', async () => {
    /*
      The pair, and it is not decorative: the first version of the whitespace
      case pressed a control that never posts and asserted "no POST" against
      nothing. It passed and proved nothing.
    */
    respond();
    const user = userEvent.setup();
    const { view } = await mount();

    await view.findByText('K&N Drop-in Air Filter');
    await user.type(view.getByLabelText("Search suggestions"), 'Wipers');
    await user.press(await view.findByLabelText('Add Wipers to the wishlist'));

    await waitFor(() => expect(posted()).toBeDefined());
    expect(posted()![1]?.body).toMatchObject({ itemName: 'Wipers', itemType: 'maintenance' });
  });

  it('reads a duplicate as already on the list, not as a failure', async () => {
    /*
      409 is the dedupe working. Telling somebody their add broke, while the
      item sits on the list in front of them, is the wrong claim.
    */
    request.mockImplementation((path: string, init?: { method?: string }) => {
      if (init?.method === 'POST') {
        return Promise.reject(new ApiRequestError({ status: 409, message: 'Duplicate' }));
      }
      if (path.startsWith('/wishlist')) return Promise.resolve({ wishlistItems: [] } as never);
      return Promise.resolve({
        vehicle: { year: 2018, make: 'Honda', model: 'Accord' },
        knowledge: KNOWLEDGE,
      } as never);
    });

    const user = userEvent.setup();
    const { view } = await mount();

    await view.findByText('K&N Drop-in Air Filter');
    await user.press(view.getByLabelText('Add K&N Drop-in Air Filter to the wishlist'));

    // Flips to the on-list state rather than showing an error about a state
    // the person already has.
    await view.findByText('On the list');
    expect(view.queryByText(/could not be added/i)).toBeNull();
  });

  it('signs out if the add comes back 401', async () => {
    request.mockImplementation((path: string, init?: { method?: string }) => {
      if (init?.method === 'POST') {
        /*
          ⚠ **`origin: 'device'` as of 24 Aug (MOB-08).** This screen used to sign
          out on **any** 401, including a `server` one that a retry a second later
          would have accepted — and then `return`ed without setting a state, so
          offline with an expired token it showed skeletons forever with no error
          and no retry.

          A device-side 401 is the one that genuinely means "signed out", and it is
          the one this case is about.
        */
        return Promise.reject(new ApiRequestError({ status: 401, origin: 'device', message: 'Unauthorized' }));
      }
      if (path.startsWith('/wishlist')) return Promise.resolve({ wishlistItems: [] } as never);
      return Promise.resolve({
        vehicle: { year: 2018, make: 'Honda', model: 'Accord' },
        knowledge: KNOWLEDGE,
      } as never);
    });

    const user = userEvent.setup();
    const { props, view } = await mount();

    await view.findByText('K&N Drop-in Air Filter');
    await user.press(view.getByLabelText('Add K&N Drop-in Air Filter to the wishlist'));

    await waitFor(() => expect(props.onSignOut).toHaveBeenCalled());
  });

  it('says an item is already there rather than offering to add it twice', async () => {
    respond({ onList: [wishlistItemIdentifier('modification', 'K&N Drop-in Air Filter')] });
    const { view } = await mount();

    await view.findByText('K&N Drop-in Air Filter');
    view.getByText('On the list');
    expect(view.queryByLabelText('Add K&N Drop-in Air Filter to the wishlist')).toBeNull();
  });
});

describe('learn more', () => {
  it('asks the advisor about that item, on this car', async () => {
    // A bare part name makes the advisor guess which car and which symptom —
    // it takes the vehicle record in context, so the question names both.
    respond();
    const user = userEvent.setup();
    const { props, view } = await mount();

    await view.findByText('Fuel injector seals');
    await user.press(view.getByLabelText('Ask the advisor about Fuel injector seals'));

    expect(props.onAskAdvisor).toHaveBeenCalledWith('v1', expect.stringContaining('Fuel injector seals'));
    expect(props.onAskAdvisor.mock.calls[0][1]).toMatch(/2018 Honda Accord/);
  });
});

describe('the state that is not an error', () => {
  it('does not claim there is nothing to suggest when research has not run', async () => {
    // An empty list is a statement about a lookup. Saying "nothing to suggest"
    // about one that never ran is the recall screen's 21 Aug defect, again.
    request.mockImplementation((path: string) =>
      path.startsWith('/wishlist')
        ? Promise.resolve({ wishlistItems: [] } as never)
        : Promise.resolve({
            vehicle: { year: 2018, make: 'Honda', model: 'Accord' },
            knowledge: null,
          } as never)
    );

    const { view } = await mount();
    await view.findByText(/have not worked out what .* needs yet/i);
  });
});
