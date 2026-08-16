import { render, userEvent, waitFor } from '@testing-library/react-native';

import { VehicleDetailScreen } from '../VehicleDetailScreen';
import { apiRequest, ApiRequestError } from '../../api/client';
import { getHealthBandJudgement } from '@crewchief/core/health-band';

/**
 * The dossier.
 *
 * The screen a car opens into, and the hub every other mobile surface is
 * reached from — advisor, invoice scan, recalls, wishlist. Four callbacks means
 * four ways to strand somebody, and none of them were covered.
 *
 * ── Two things worth pinning beyond "it renders" ────────────────────────────
 *
 * **The health band comes from `@crewchief/core/health-band`**, which both
 * clients read. A band spelled locally would let the phone call a car "Fair"
 * while the web calls the same score "Needs attention" — the exact divergence
 * the shared package exists to prevent. The test asserts against the real
 * judgement function rather than a string.
 *
 * **401 does not sign you out here, and that is deliberate.** Every other
 * screen calls `onSignOut` on a 401. This one shows "Your session ended" with a
 * "Sign in again" button, because it is reachable from a deep link and silently
 * bouncing somebody to a login screen loses the thing they tapped. The
 * asymmetry is easy to "fix" by mistake, so it is pinned.
 *
 * `userEvent` throughout, never `fireEvent` — see `AddVehicleScreen.test.tsx`.
 */

jest.mock('../../api/client', () => {
  const actual = jest.requireActual('../../api/client');
  return { ...actual, apiRequest: jest.fn() };
});

const request = apiRequest as jest.MockedFunction<typeof apiRequest>;

/**
 * `vehicle_health_summary` and `nhtsa_data` are Supabase embeds, so each can
 * arrive as an object or an array — which is why the screen has `first()`.
 * `asArray` exercises the other shape.
 */
function respond(over: Record<string, unknown> = {}, { asArray = false } = {}) {
  const health = { health_score: 61, summary: 'Fair.' };
  const nhtsa = { recalls: [{ id: 1 }, { id: 2 }] };

  request.mockResolvedValue({
    vehicle: {
      id: 'v1',
      year: 2018,
      make: 'Honda',
      model: 'Accord',
      current_mileage: 94_800,
      vehicle_health_summary: asArray ? [health] : health,
      nhtsa_data: asArray ? [nhtsa] : nhtsa,
      ...over,
    },
  } as never);
}

async function mount() {
  const props = {
    vehicleId: 'v1',
    onBack: jest.fn(),
    onSignOut: jest.fn(),
    onAskAdvisor: jest.fn(),
    onScanInvoice: jest.fn(),
    onViewRecalls: jest.fn(),
    onOpenWishlist: jest.fn(),
    onOpenHistory: jest.fn(),
  };
  return { props, view: await render(<VehicleDetailScreen {...props} />) };
}

beforeEach(() => request.mockReset());

describe('the dossier', () => {
  it('draws the car', async () => {
    respond();
    const { view } = await mount();

    expect(await view.findByText(/2018 Honda Accord/)).toBeTruthy();
  });

  it('reads embeds that arrive as arrays', async () => {
    /*
      A Supabase to-many embed is an array, to-one is an object, and which you
      get depends on the query. Handling one shape only would show a car with no
      health and no recalls — silently, with no error.
    */
    respond({}, { asArray: true });
    const { view } = await mount();

    expect(await view.findByText(/2018 Honda Accord/)).toBeTruthy();
    expect(view.getByLabelText(/View 2 open recalls/)).toBeTruthy();
  });
});

describe('the health band', () => {
  it('uses core’s judgement rather than one spelled here', async () => {
    /*
      `health-band` is read by both clients. A locally-spelled band would let
      the phone say "Fair" where the web says "Needs attention" for the same
      score — which is the divergence the shared package exists to stop.
    */
    respond();
    const { view } = await mount();

    const expected = getHealthBandJudgement(61);
    await view.findByText(/2018 Honda Accord/);

    expect(view.getAllByText(new RegExp(expected.label, 'i')).length).toBeGreaterThan(0);
  });

  it('says nothing about health when there is no score', async () => {
    // Absent is normal — a car added minutes ago has no summary yet. Inventing
    // a band for it would be a claim about a car nothing has assessed.
    respond({ vehicle_health_summary: null });
    const { view } = await mount();

    await view.findByText(/2018 Honda Accord/);
    expect(view.queryByText(new RegExp(getHealthBandJudgement(61).label, 'i'))).toBeNull();
  });
});

describe('recalls', () => {
  it('pluralises the label correctly', async () => {
    // Read aloud by a screen reader, so "1 open recalls" is a real defect
    // rather than a typo.
    respond({ nhtsa_data: { recalls: [{ id: 1 }] } });
    const { view } = await mount();

    expect(await view.findByLabelText(/View 1 open recall$/)).toBeTruthy();
  });

  it('opens the recall screen when tapped', async () => {
    const user = userEvent.setup();
    respond();
    const { props, view } = await mount();

    await view.findByText(/2018 Honda Accord/);
    await user.press(view.getByLabelText(/View 2 open recalls/));

    expect(props.onViewRecalls).toHaveBeenCalledTimes(1);
  });
});

describe('the ways out', () => {
  it('reaches the wishlist', async () => {
    const user = userEvent.setup();
    respond();
    const { props, view } = await mount();

    await view.findByText(/2018 Honda Accord/);
    await user.press(view.getByText(/wishlist/i));

    expect(props.onOpenWishlist).toHaveBeenCalledTimes(1);
  });
});

describe('when the vehicle is gone', () => {
  it('treats a 404 as a state, not a crash', async () => {
    /*
      Reachable from a stale notification or a deep link to a deleted car. An
      error screen saying "something went wrong" would send someone looking for
      a fault that does not exist.
    */
    request.mockRejectedValue(new ApiRequestError({ status: 404, message: 'Not found' }));
    const { view } = await mount();

    expect(await view.findByText('This vehicle is no longer here')).toBeTruthy();
  });

  it('offers the way back to the garage', async () => {
    const user = userEvent.setup();
    request.mockRejectedValue(new ApiRequestError({ status: 404, message: 'Not found' }));
    const { props, view } = await mount();

    await view.findByText('This vehicle is no longer here');
    await user.press(view.getByText('Back to garage'));

    expect(props.onBack).toHaveBeenCalledTimes(1);
  });
});

describe('when the session ended', () => {
  it('does not sign out on its own', async () => {
    /*
      The deliberate asymmetry. Every other screen calls `onSignOut` from the
      401 handler; this one is reachable from a deep link, and bouncing someone
      silently to a login screen loses whatever they tapped to get here.
    */
    request.mockRejectedValue(new ApiRequestError({ status: 401, message: 'Unauthorized' }));
    const { props, view } = await mount();

    expect(await view.findByText('Your session ended')).toBeTruthy();
    expect(props.onSignOut).not.toHaveBeenCalled();
  });

  it('signs out when the person asks it to', async () => {
    // The pair. Without it, "does not sign out" is satisfied by a screen where
    // signing out is impossible.
    const user = userEvent.setup();
    request.mockRejectedValue(new ApiRequestError({ status: 401, message: 'Unauthorized' }));
    const { props, view } = await mount();

    await view.findByText('Your session ended');
    await user.press(view.getByText('Sign in again'));

    expect(props.onSignOut).toHaveBeenCalledTimes(1);
  });
});

describe('when it simply failed', () => {
  it('offers a retry rather than a sign-out', async () => {
    // A 500 is not a session problem, and the two must not share a button.
    request.mockRejectedValue(new ApiRequestError({ status: 500, message: 'Upstream failed' }));
    const { props, view } = await mount();

    expect(await view.findByText('Could not load this vehicle')).toBeTruthy();
    expect(view.getByText('Try again')).toBeTruthy();
    expect(props.onSignOut).not.toHaveBeenCalled();
  });

  it('actually retries', async () => {
    const user = userEvent.setup();
    request.mockRejectedValue(new ApiRequestError({ status: 500, message: 'Upstream failed' }));
    const { view } = await mount();

    await view.findByText('Could not load this vehicle');
    const before = request.mock.calls.length;

    await user.press(view.getByText('Try again'));

    await waitFor(() => expect(request.mock.calls.length).toBeGreaterThan(before));
  });
});

describe('what this screen leads to stays reachable', () => {
  /**
   * Every string the screen rendered, in the order it rendered them.
   *
   * Order is the assertion here — nothing else can express "below the fold".
   * A screen can contain a control and still have buried it, which is exactly
   * what happened on 15 Aug and is why this exists.
   */
  const textInOrder = (view: { toJSON: () => unknown }): string[] => {
    const out: string[] = [];

    const walk = (node: unknown) => {
      if (typeof node === 'string') {
        out.push(node);
        return;
      }
      if (!node || typeof node !== 'object') return;
      const host = node as { children?: unknown[] };
      for (const child of host.children ?? []) walk(child);
    };

    walk(view.toJSON());
    return out;
  };

  it('puts the advisor and the wishlist above the second instruments', async () => {
    /*
      ⚠ The regression David found in the simulator, in one assertion.

      Step 4 stacked the photo hero, a 184pt dial, the drivers, the score
      history and the build dial above the destinations — so "Ask the advisor",
      the verb this screen exists to lead to, and the wishlist with it, sat
      below roughly two screens of instruments. His words were "I can't see add
      wishlist any more" and "ask crewchief is buried too low", and both were
      the same defect.

      The board's own order is the fix and it was there all along: screen 02 is
      the car and what to do about it; **screen 03 is "vehicle detail,
      scrolled"** and is where "the two instruments web has and mobile does
      not" live. Reference is what you scroll to.
    */
    respond();
    const { view } = await mount();
    await view.findByText(/2018 Honda Accord/);

    const order = textInOrder(view);
    /*
      Case-insensitive: `SectionHeader` upper-cases its title, so a section is
      "HEALTH" in the tree and "Health" in the source. Matching exactly found
      the dial's readout and missed the heading.
    */
    const at = (needle: string) =>
      order.findIndex((line) => line.toLowerCase().includes(needle.toLowerCase()));

    expect(at('Health')).toBeGreaterThan(-1);
    expect(at('Ask the advisor')).toBeGreaterThan(-1);
    expect(at('Build')).toBeGreaterThan(-1);

    // Health first, then what to do about it, then the reference instruments.
    expect(at('Health')).toBeLessThan(at('Wishlist'));
    expect(at('Wishlist')).toBeLessThan(at('Ask the advisor'));
    expect(at('Ask the advisor')).toBeLessThan(at('Build'));
    expect(at('Ask the advisor')).toBeLessThan(at('Details'));
  });

  it('shows one dial on this screen, and it is not the hero', async () => {
    /*
      The board: "Hero · 184pt … **Garage bay and nothing else** — one dial per
      screen", and "Card · 104pt … deliberately still. **The plinth on vehicle
      detail**." A second hero is a second screen claiming the one dial, and at
      184 with a sweep it was most of what pushed the destinations down.

      The card variant is still — no ignition sweep — so the reading is present
      immediately rather than arriving.
    */
    respond();
    const { view } = await mount();

    expect(await view.findByText('61')).toBeTruthy();
    // The hero draws six numbered majors; the card draws none.
    expect(view.queryByText('20')).toBeNull();
    expect(view.queryByText('80')).toBeNull();
  });
});
