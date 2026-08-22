import { render, userEvent, waitFor } from '@testing-library/react-native';

import { RecallDetailScreen } from '../RecallDetailScreen';
import { apiRequest, ApiRequestError } from '../../api/client';

/**
 * Where a recall notification lands.
 *
 * Phase 5.6, and the highest-stakes screen in the app. A recall is a **safety
 * claim about a specific car**, the person arrives from an unprompted push
 * rather than by choosing to look, and NHTSA's own severities include "do not
 * drive this vehicle".
 *
 * Getting that wrong in either direction is serious: rendering a do-not-drive
 * recall as an ordinary maintenance item understates something that should stop
 * someone driving, and inventing urgency where NHTSA flagged none teaches people
 * to discount the next one.
 *
 * It had no behaviour coverage. Every rule below was enforced only by reading
 * the component.
 *
 * ── The fixtures go through the real normaliser ─────────────────────────────
 *
 * `normaliseRecalls` is what turns NHTSA's payload into what this screen draws,
 * including the `parkIt` / `parkOutSide` flags that decide the banner. Building
 * `NormalisedRecall` objects by hand here would test the screen against a shape
 * the parser might not produce — so the fixtures are raw NHTSA-shaped rows and
 * the screen gets them the way production does.
 *
 * `userEvent` throughout, never `fireEvent` — see `AddVehicleScreen.test.tsx`.
 */

jest.mock('../../api/client', () => {
  const actual = jest.requireActual('../../api/client');
  return { ...actual, apiRequest: jest.fn() };
});

const request = apiRequest as jest.MockedFunction<typeof apiRequest>;

/** A raw NHTSA-shaped row, as stored in `nhtsa_data.recalls`. */
function rawRecall(over: Record<string, unknown> = {}) {
  return {
    NHTSACampaignNumber: '20V123000',
    Component: 'FUEL PUMP',
    Summary: 'The low-pressure fuel pump may fail.',
    Consequence: 'An engine stall increases the risk of a crash.',
    Remedy: 'Dealers will replace the fuel pump free of charge.',
    ...over,
  };
}

/**
 * The response shape the screen actually reads.
 *
 * `nhtsa_data` hangs off `vehicle`, not off the root — the first draft of this
 * file put it at `root.nhtsa` and every content assertion failed while the
 * vehicle name rendered perfectly, which is a good illustration of why the
 * fixture belongs next to the code that consumes it.
 *
 * `asArray` covers the other shape: a Supabase embed comes back as an array
 * when the relationship is to-many, which is why the screen has `first()` at
 * all. Both forms are exercised below.
 */
function respond(recalls: unknown[], { asArray = false } = {}) {
  const nhtsa_data = asArray ? [{ recalls }] : { recalls };
  request.mockResolvedValue({
    vehicle: { year: 2018, make: 'Honda', model: 'Accord', nhtsa_data },
  } as never);
}

/**
 * A vehicle whose NHTSA record has **never been fetched**.
 *
 * ⚠ Distinct from `respond([])`, and the distinction is the bug. That fixture
 * supplies `nhtsa_data: { recalls: [] }` — a lookup that ran and found
 * nothing. This one omits the row entirely, which is every vehicle between
 * being added and being researched, and every vehicle whose research failed.
 * Both reach the screen as an empty array.
 */
function respondUnresearched() {
  request.mockResolvedValue({
    vehicle: { year: 2003, make: 'Honda', model: 'Accord' },
  } as never);
}

/**
 * Async, because `render` is.
 *
 * RNTL 14 returns a Promise — React 19 made mounting concurrent. The first
 * draft of this file returned it unawaited and every case died on
 * `view.findByText is not a function`, which names the symptom and not the
 * cause. Awaiting inside the helper means no call site can forget.
 */
async function mount(overrides: Partial<Parameters<typeof RecallDetailScreen>[0]> = {}) {
  const props = {
    vehicleId: 'v1',
    ...overrides,
    onAskAdvisor: jest.fn(),
    onSignOut: jest.fn(),
  };
  return { props, view: await render(<RecallDetailScreen {...props} />) };
}

beforeEach(() => {
  request.mockReset();
});

describe('the severity banner', () => {
  it('leads with the do-not-drive instruction', async () => {
    /*
      NHTSA's `parkIt`. This is the reason the screen is not a list: someone
      opening it from a notification needs the instruction *before* the context,
      so the banner sits above the vehicle name.
    */
    respond([rawRecall({ parkIt: true })]);
    const { view } = await mount();

    expect(await view.findByText(/do not drive/i)).toBeTruthy();
  });

  it('distinguishes park-outside from do-not-drive', async () => {
    // `parkOutSide` is a fire risk when parked, not an instruction to stop
    // driving. Collapsing the two would either overstate or understate one.
    respond([rawRecall({ parkOutSide: true })]);
    const { view } = await mount();

    // Exact banner titles, not a loose /park/i — the body copy also says
    // "parked", so a fuzzy match found several nodes and proved nothing.
    expect(await view.findByText('Park outside, away from buildings')).toBeTruthy();
    expect(view.queryByText('Do not drive this vehicle')).toBeNull();
  });

  it('shows no banner for an ordinary recall', async () => {
    /*
      The direction that matters most. Inventing urgency where NHTSA flagged
      none teaches people to discount the next alert — and the next one might
      be the parkIt.
    */
    respond([rawRecall()]);
    const { view } = await mount();

    // `getAllBy`: the component name appears as a heading AND inside the
    // advisor button's label, so a singular query throws on a correct screen.
    await view.findAllByText(/FUEL PUMP/i);

    expect(view.queryByText('Do not drive this vehicle')).toBeNull();
    expect(view.queryByText('Park outside, away from buildings')).toBeNull();
  });

  it('reads recalls when the embed arrives as an array', async () => {
    /*
      `first()` exists for this: a Supabase to-many embed returns an array, a
      to-one returns an object, and which one you get depends on the query. A
      screen that handled only one shape would render an empty recall list
      against a car that has them — silently, with no error.
    */
    respond([rawRecall({ parkIt: true })], { asArray: true });
    const { view } = await mount();

    expect(await view.findByText(/do not drive/i)).toBeTruthy();
  });

  it('takes the worst severity when a car has several recalls', async () => {
    // A banner reflecting whichever recall sorted first would hide a
    // do-not-drive behind an ordinary one.
    respond([rawRecall(), rawRecall({ NHTSACampaignNumber: '23V999000', parkIt: true })]);
    const { view } = await mount();

    expect(await view.findByText(/do not drive/i)).toBeTruthy();
  });
});

describe('what it will not claim', () => {
  it('omits the remedy section rather than heading an empty box', async () => {
    /*
      Stored payloads predate NHTSA's `Remedy` field, so absent is the normal
      case. A "How it gets fixed" heading over nothing reads as "nobody knows
      how to fix this" — a worse claim than staying quiet.
    */
    respond([rawRecall({ Remedy: undefined })]);
    const { view } = await mount();

    await view.findAllByText(/FUEL PUMP/i);
    expect(view.queryByText('How it gets fixed')).toBeNull();
  });

  it('shows the remedy when there is one', async () => {
    // The pair. Without it, the assertion above is satisfied by a screen that
    // never renders a remedy at all.
    respond([rawRecall()]);
    const { view } = await mount();

    expect(await view.findByText('How it gets fixed')).toBeTruthy();
  });
});

describe('when there is nothing to show', () => {
  it('says so rather than rendering an empty screen', async () => {
    // Reachable from a stale notification after the data changed.
    respond([]);
    const { view } = await mount();

    /*
      "No recalls ON RECORD", not "you have no recalls". The screen reads
      NHTSA's list, and the distinction is deliberate — asserting the exact
      string keeps that hedge from being softened away.
    */
    expect(await view.findByText('No recalls on record')).toBeTruthy();
  });
});

describe('a vehicle nobody has checked yet', () => {
  /*
    ⚠ The web's 21 Aug defect, reached on mobile 22 Aug. A 2003 Accord — inside
    the Takata campaigns — with no NHTSA record was shown "NHTSA has no open
    recalls listed for this vehicle", which is a claim about a lookup that never
    ran. Absence rendered as a finding, on a safety claim, on the screen a
    recall notification opens.

    The existing empty-state case above supplies `nhtsa_data: { recalls: [] }`
    and is therefore about a *checked* car. Nothing tested the other shape,
    which is why this survived the web fix.
  */

  it('does not claim NHTSA listed nothing', async () => {
    respondUnresearched();
    const { view } = await mount();

    // The exact sentence that was wrong. It must not appear for this car.
    expect(view.queryByText(/NHTSA has no open recalls listed/)).toBeNull();
  });

  it('says the check has not run', async () => {
    respondUnresearched();
    const { view } = await mount();

    expect(await view.findByText('Recalls not checked yet')).toBeTruthy();
    expect(await view.findByText(/have not checked this vehicle for recalls/i)).toBeTruthy();
  });

  it('refuses the all-clear reading in words', async () => {
    /*
      `health-claims.ts` puts "This is not a clear result." in the copy on
      purpose — an absent panel invites the reader to fill it in with their own
      optimism. Asserted here so the sentence cannot be trimmed to something
      that merely sounds neutral.
    */
    respondUnresearched();
    const { view } = await mount();

    expect(await view.findByText(/not a clear result/i)).toBeTruthy();
  });

  it('still says "No recalls on record" when the lookup did run', async () => {
    /*
      ⚠ Anti-vacuous, and the direction that would quietly ruin the common
      case: a screen that treated every empty list as unchecked would never
      give anybody the reassuring answer they are entitled to.
    */
    respond([]);
    const { view } = await mount();

    expect(await view.findByText('No recalls on record')).toBeTruthy();
    expect(view.queryByText('Recalls not checked yet')).toBeNull();
  });
});

describe('failure paths', () => {
  it('signs out on a 401', async () => {
    // Arranged before mounting: the screen fetches on mount, so a mock set
    // afterwards would be too late and the assertion would pass or fail on
    // timing rather than on behaviour.
    request.mockRejectedValue(new ApiRequestError({ status: 401, message: 'Unauthorized' }));

    const { props } = await mount();

    await waitFor(() => expect(props.onSignOut).toHaveBeenCalledTimes(1));
  });

  it('keeps the person here for any other failure', async () => {
    /*
      A 500 is not a session problem. Signing out for one would drop somebody
      who followed a safety notification back to a login screen.
    */
    request.mockRejectedValue(new ApiRequestError({ status: 500, message: 'Upstream failed' }));
    const { props, view } = await mount();

    expect(await view.findByText(/Upstream failed/)).toBeTruthy();
    expect(props.onSignOut).not.toHaveBeenCalled();
  });
});

describe('the advisor hand-off', () => {
  it('asks about the specific recall, not the car in general', async () => {
    /*
      The advisor is one of the things you can do *from* this screen. Handing it
      a generic question would waste the one piece of context the screen has —
      which recall the person is actually looking at.
    */
    const user = userEvent.setup();
    respond([rawRecall()]);
    const { props, view } = await mount();
    const resolved = view;

    await resolved.findAllByText(/FUEL PUMP/i);
    await user.press(resolved.getByLabelText(/Ask the advisor about the FUEL PUMP recall/i));

    expect(props.onAskAdvisor).toHaveBeenCalledTimes(1);
    const [vehicleId, ask] = props.onAskAdvisor.mock.calls[0];
    expect(vehicleId).toBe('v1');
    expect(String(ask)).toMatch(/FUEL PUMP/i);
  });
});
