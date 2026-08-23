import { render, userEvent } from '@testing-library/react-native';

import { BuildScreen } from '../BuildScreen';
import { apiRequest } from '../../api/client';

/**
 * The build, once it became a screen.
 *
 * ── What these are actually about ───────────────────────────────────────────
 *
 * The card this replaced rendered `rungs[0].role` — the word "Foundation" — out
 * of three fully-formed suggestions that `nextRungs` had already computed. So
 * the first and most important case here is simply *that the names, the reasons
 * and the difficulties reach the screen at all*, because the defect was never a
 * missing feature. It was a component discarding four fifths of its input, and
 * nothing failed.
 *
 * The rest cover the three things David said were missing — read them, add them
 * to a wishlist, decline them — plus the two states this product is careful
 * about: a dial at rest is **stock, not broken**, and a lookup that has not run
 * is not the same as nothing to suggest.
 */

jest.mock('../../api/client', () => {
  const actual = jest.requireActual('../../api/client');
  return { ...actual, apiRequest: jest.fn() };
});

/*
  The declines live in `secureStorage`, which is `expo-secure-store` — a native
  module. Stubbed as an in-memory map so the decline cases exercise the real
  module's logic without a keychain.
*/
jest.mock('../../auth/secure-storage', () => {
  const held = new Map<string, string>();
  return {
    secureStorage: {
      getItem: jest.fn(async (key: string) => held.get(key) ?? null),
      setItem: jest.fn(async (key: string, value: string) => {
        held.set(key, value);
      }),
      removeItem: jest.fn(async (key: string) => {
        held.delete(key);
      }),
      __held: held,
    },
  };
});

import { secureStorage } from '../../auth/secure-storage';

const request = apiRequest as jest.MockedFunction<typeof apiRequest>;

/** Every rendered string, in the order it appears. Order is the assertion. */
function textInOrder(view: { toJSON: () => unknown }): string[] {
  const out: string[] = [];

  const walk = (node: unknown) => {
    if (typeof node === 'string') {
      out.push(node);
      return;
    }
    if (!node || typeof node !== 'object') return;
    for (const child of (node as { children?: unknown[] }).children ?? []) walk(child);
  };

  walk(view.toJSON());
  return out;
}

/** The WRX's catalogue, in the shape `vehicle_knowledge_base` stores it. */
const MODS = [
  { name: 'Cobb Accessport V3', purpose: 'ECU tune', difficulty: 'Easy' },
  { name: 'Whiteline sway bars', purpose: 'Reduces body roll', difficulty: 'Moderate' },
  { name: 'Grimmspeed downpipe', purpose: 'Required for the next power step', difficulty: 'Hard' },
];

function respond({
  mods = MODS,
  mindedness = 'mild',
  wishlist = [] as Array<Record<string, unknown>>,
}: {
  mods?: typeof MODS;
  mindedness?: string;
  wishlist?: Array<Record<string, unknown>>;
} = {}) {
  request.mockImplementation((path: string) => {
    if (path.startsWith('/wishlist')) return Promise.resolve({ wishlistItems: wishlist } as never);
    return Promise.resolve({
      vehicle: { year: 2018, make: 'Subaru', model: 'WRX', performance_mindedness: mindedness },
      knowledge: { common_mods: mods },
    } as never);
  });
}

/**
 * ⚠ `async`, and every caller awaits it.
 *
 * `render` is async in RNTL 14. An un-awaited one leaves React's act scope open,
 * which stops every later render in the file from committing — `jest.setup.js`
 * now throws on it, and it cost `contrast.test.tsx` a week of measuring nothing
 * in green before it did.
 */
async function mount() {
  const props = {
    vehicleId: 'v1',
    title: '2018 Subaru WRX',
    onSignOut: jest.fn(),
    onOpenWishlist: jest.fn(),
  };
  return { props, view: await render(<BuildScreen {...props} />) };
}

beforeEach(() => {
  jest.clearAllMocks();
  (secureStorage as unknown as { __held: Map<string, string> }).__held.clear();
});

describe('the suggestions reach the screen', () => {
  it('names the parts, the roles, the effort and the reasoning', async () => {
    /*
      ⚠ The case the old card would have failed on every assertion but one.

      `nextRungs` returns `{ name, purpose, difficulty, role, rationale }` and
      the card rendered the role and nothing else — three named recommendations
      collapsed to the word "Foundation". Every line below is something that was
      already computed and thrown away.
    */
    respond();
    const { view } = await mount();

    await view.findByText('Cobb Accessport V3');
    view.getByText('Whiteline sway bars');
    view.getByText('Grimmspeed downpipe');

    // The effort, and the role in the product's own words — "Control before
    // more power" rather than "Control", because the rung's argument is *when*.
    view.getByText('Easy');
    /*
      Twice, and both are correct: once as the rung's own chip, once as a step
      on `ProgressionLadder`'s five-rung scale. Asserting a single match would
      be asserting that the ladder is absent.
    */
    expect(view.getAllByText('Control before more power').length).toBeGreaterThanOrEqual(2);

    // And the sentence that makes it a recommendation rather than a catalogue.
    expect(view.getAllByText(/before more power, not after/i).length).toBeGreaterThan(0);
  });

  it('puts the ladder in the order the product argues for', async () => {
    // Foundation before control before enabling. It is the one piece of
    // sequencing advice with a consequence attached, and the one a shop will
    // not volunteer while selling a tune.
    respond();
    const { view } = await mount();

    await view.findByText('Cobb Accessport V3');

    /*
      Walked rather than `JSON.stringify`d: the tree holds a `refreshControl`
      element whose props close a circle back through its own fiber, so
      stringifying it throws. `VehicleDetailScreen.test.tsx` walks for the same
      reason — a screen can contain a control and still have buried it, and only
      the order says which.
    */
    const order = textInOrder(view);
    const at = (needle: string) => order.findIndex((line) => line.includes(needle));

    expect(at('Cobb Accessport')).toBeGreaterThan(-1);
    expect(at('Cobb Accessport')).toBeLessThan(at('Whiteline'));
    expect(at('Whiteline')).toBeLessThan(at('Grimmspeed'));
  });
});

describe('acting on a suggestion', () => {
  it('adds one to the wishlist under the shared identifier', async () => {
    /*
      ⚠ `wishlistItemIdentifier`, never a locally-invented key. The table dedupes
      on `(vehicle_id, item_identifier)` and `wishlist-identifier.ts` records
      what a fourth format cost: duplicate rows, an "Add" that never became
      "Added", and a delete that silently matched nothing.
    */
    respond();
    const user = userEvent.setup();
    const { view } = await mount();

    await view.findByText('Cobb Accessport V3');
    await user.press(view.getAllByLabelText(/Add to wishlist/i)[0]);

    const call = request.mock.calls.find(([path, init]) => path === '/wishlist' && init?.method === 'POST');
    expect(call).toBeTruthy();
    expect(call?.[1]?.body).toMatchObject({
      itemType: 'modification',
      itemName: 'Cobb Accessport V3',
      itemIdentifier: 'modification:cobb_accessport_v3',
    });
  });

  it('carries the reasoning onto the wishlist row, not just the part name', async () => {
    // Six weeks later "Whiteline sway bars" on a list has lost the only thing
    // that made it a recommendation. The description is where that survives.
    respond();
    const user = userEvent.setup();
    const { view } = await mount();

    await view.findByText('Whiteline sway bars');
    await user.press(view.getAllByLabelText(/Add to wishlist/i)[1]);

    const call = request.mock.calls.find(([path, init]) => path === '/wishlist' && init?.method === 'POST');
    expect(String((call?.[1]?.body as Record<string, unknown>)?.description)).not.toBe('');
    expect((call?.[1]?.body as Record<string, unknown>)?.category).toBe('Control before more power');
  });

  it('says an item is already there rather than offering to add it twice', async () => {
    respond({ wishlist: [{ item_identifier: 'modification:cobb_accessport_v3' }] });
    const { view } = await mount();

    await view.findByText('Cobb Accessport V3');
    view.getByLabelText(/On the wishlist/i);
  });

  it('takes a decline, and keeps a way back', async () => {
    /*
      ⚠ Listed rather than gone. A dismissal with no trace is a decision nobody
      can revisit, and the ladder deliberately has no ceiling — `tierCeiling`
      was removed for hard-coding a finish line nobody drew, and a permanent
      invisible decline would put one back a row at a time.
    */
    respond();
    const user = userEvent.setup();
    const { view } = await mount();

    await view.findByText('Cobb Accessport V3');
    await user.press(view.getByLabelText('Not interested in Cobb Accessport V3'));

    // Gone from the suggestions, present in the list of things said no to.
    // `SectionHeader` upper-cases, so the tree carries "YOU SAID NO TO THESE".
    await view.findByText(/you said no to these/i);
    view.getByLabelText('Put Cobb Accessport V3 back in the list');

    await user.press(view.getByLabelText('Put Cobb Accessport V3 back in the list'));
    expect(view.queryByText(/you said no to these/i)).toBeNull();
  });
});

describe('the states this product is careful about', () => {
  it('reads a car with no recorded work as Stock, never as a fault', async () => {
    /*
      ⚠ `modification_tracking` is empty across the whole product, so this is
      every car. A build dial at rest is a car nobody has recorded work on — it
      must never borrow the health ramp, which would paint an unmodified car as
      a critical failure and announce it to a screen reader as one.
    */
    respond();
    const { view } = await mount();

    /*
      Twice — the dial's own accessible name and the word under it. Both must
      say Stock, and neither may borrow the health ramp: a build dial coloured
      from the health band would paint an unmodified car as a critical failure
      and announce it to a screen reader as one.
    */
    expect((await view.findAllByText('Stock')).length).toBeGreaterThan(0);
    view.getByLabelText('Build progress — Stock');
    expect(view.queryByText(/critical/i)).toBeNull();
  });

  it('does not claim there is nothing to suggest when the lookup has not run', async () => {
    // The recall screen's 21 Aug defect, in another place: an empty list is a
    // statement about a lookup, and saying "no suggestions" about one that
    // never ran is a claim the product has not earned.
    respond({ mods: [] });
    const { view } = await mount();

    await view.findByText(/have not worked out what suits this car yet/i);
  });

  it('says modifications are off rather than showing an empty plan', async () => {
    // The one genuine off switch, and it is "not now" rather than "never" —
    // the same argument the register switch makes about an irreversible answer.
    respond({ mindedness: 'stock' });
    const { view } = await mount();

    await view.findByText(/modifications are turned off/i);
    expect(view.queryByText('Cobb Accessport V3')).toBeNull();
  });
});
