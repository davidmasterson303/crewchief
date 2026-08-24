import { StyleSheet } from 'react-native';
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

  it('shows the remedy when there is one, once the notice is opened', async () => {
    /*
      The pair. Without it, the assertion above is satisfied by a screen that
      never renders a remedy at all.

      ⚠ **R30, 23 Aug.** It is behind a disclosure now. NHTSA's summary,
      "What could happen" and "How it gets fixed" used to render at once — three
      levels of prose on one card, at low contrast, which is how a screen ends
      up read by nobody. The control that opens it is asserted first, so this
      still fails if the disclosure disappears rather than passing on absence.
    */
    respond([rawRecall()]);
    const { view } = await mount();

    const disclosure = await view.findByText('Read the full notice');
    expect(view.queryByText('How it gets fixed')).toBeNull();

    await userEvent.press(disclosure);
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

/**
 * ── Clearing a recall, added 23 Aug ─────────────────────────────────────────
 *
 * David's note: *"open recalls — I like the ask advisor function, but we need
 * some way to clear these too."* He was right, and the reason it matters is a
 * property of badges rather than of recalls: a count that can never go down
 * stops being read, so after the second week a permanent red chip is furniture.
 *
 * ⚠ The rule every case below is really testing is that **"repaired" stays the
 * owner's claim**. Recalls match on year/make/model rather than VIN, so nothing
 * here verifies anything — §10, on the screen where overstating is most
 * expensive.
 */
describe('marking a recall repaired', () => {
  /**
   * The marks ride on the vehicle, as `load-vehicle` embeds them.
   *
   * ⚠ `recall_actions` is on the **vehicle**, not the root, and it is the
   * database's snake_case rather than the client's camelCase — the embed is a
   * row, not a DTO. The first version of these tests fed the marks through a
   * separate `/recalls` mock, which stopped being how the screen reads them the
   * moment the embed landed.
   *
   * `/recalls` is still mocked, because a mark or an undo refetches through it.
   */
  function respondWith(recalls: unknown[], marks: Array<Record<string, unknown>> = []) {
    request.mockImplementation((path: string, init?: { method?: string }) => {
      if (path.startsWith('/recalls')) {
        if (init?.method === 'POST') {
          return Promise.resolve({
            addressed: { campaignNumber: '20V123000', addressedAt: '2026-08-23' },
          } as never);
        }
        if (init?.method === 'DELETE') return Promise.resolve({ removed: '20V123000' } as never);
        return Promise.resolve({
          addressed: marks.map((m) => ({
            campaignNumber: m.campaign_number,
            addressedAt: m.addressed_at,
          })),
        } as never);
      }
      return Promise.resolve({
        vehicle: {
          year: 2018,
          make: 'Honda',
          model: 'Accord',
          nhtsa_data: { recalls },
          recall_actions: marks,
        },
      } as never);
    });
  }

  function mount() {
    return render(
      <RecallDetailScreen
        vehicleId="v1"
        title="2018 Honda Accord"
        onAskAdvisor={jest.fn()}
        onSignOut={jest.fn()}
      />
    );
  }

  it('offers the two actions above the explanation', async () => {
    /*
      The design system's recall spec puts them before the three sentences:
      "its job is to drive an action, not to explain a notice." Somebody
      arriving from a push already knows they have a problem.
    */
    respondWith([rawRecall()]);
    const view = await mount();

    await view.findByText('FUEL PUMP');
    view.getByLabelText(/Find a dealer/i);
    view.getByLabelText(/Mark as repaired/i);
  });

  it('says who said so and when, never just "repaired"', async () => {
    // ⚠ Nothing verified anything. The strongest true sentence is that the
    // owner said so, on a date — which is why the record is a date, not a flag.
    respondWith([rawRecall()], [{ campaign_number: '20V123000', addressed_at: '2026-08-23' }]);
    const view = await mount();

    await view.findByText(/You marked this repaired on 23 Aug 2026/);
    expect(view.queryByLabelText(/Mark as repaired/i)).toBeNull();
  });

  it('counts a marked recall out of the open total without hiding it', async () => {
    /*
      Two claims in one case, and the second is the one worth protecting: the
      count goes down, and the notice **stays on the screen**. A public safety
      record must not be deleted by one person's claim about one car.
    */
    respondWith([rawRecall(), rawRecall({ NHTSACampaignNumber: '21V999000', Component: 'AIR BAG' })],
      [{ campaign_number: '20V123000', addressed_at: '2026-08-23' }]);
    const view = await mount();

    /*
      ⚠ **R31.** The open count is a `.chip-critical` now, and the marked count
      stays a quiet line beside it — a critical chip on work somebody has
      already had done is the colour teaching itself to mean nothing. They are
      two nodes rather than one dot-joined string.
    */
    await view.findByText('1 open');
    view.getByText('1 marked repaired');

    /*
      ⚠ **R28.** The headline is a name, not NHTSA's taxonomy string. The raw
      value still renders once, at provenance weight beside the campaign number,
      which is why both spellings are asserted — the mapping must not be a
      deletion.
    */
    view.getByText('Fuel pump');
    view.getByText('Air bag');
    view.getByText('FUEL PUMP');
    view.getByText('AIR BAG');
  });

  it('sends the campaign number and reads the list back', async () => {
    respondWith([rawRecall()]);
    const user = userEvent.setup();
    const view = await mount();

    await view.findByLabelText(/Mark as repaired/i);
    await user.press(view.getByLabelText(/Mark as repaired/i));

    await waitFor(() => {
      const posted = request.mock.calls.find(
        ([path, init]) => path === '/recalls' && init?.method === 'POST'
      );
      expect(posted?.[1]?.body).toMatchObject({ vehicleId: 'v1', campaignNumber: '20V123000' });
    });

    /*
      ⚠ Refetched rather than patched. The server owns `addressed_at`; a date
      guessed on the device and then corrected on the next load is a wrong date
      on a safety record, briefly, for no reason.

      Exactly one GET, and that is the whole shape of this screen's reads: the
      **initial** marks arrive embedded on the vehicle, so `/recalls` is only
      ever asked after a mutation. A second one here would mean the embed had
      stopped being read and the screen had gone back to a request it does not
      need.
    */
    const reads = request.mock.calls.filter(
      ([path, init]) => path.startsWith('/recalls') && !init?.method
    );
    expect(reads).toHaveLength(1);
  });

  it('lets the mark be taken back', async () => {
    // A claim somebody can make and cannot unmake is a trap, and this is the
    // mis-tap most worth being able to undo.
    respondWith([rawRecall()], [{ campaign_number: '20V123000', addressed_at: '2026-08-23' }]);
    const user = userEvent.setup();
    const view = await mount();

    await view.findByLabelText(/Undo marking/i);
    await user.press(view.getByLabelText(/Undo marking/i));

    await waitFor(() => {
      expect(
        request.mock.calls.some(([path, init]) => path.startsWith('/recalls') && init?.method === 'DELETE')
      ).toBe(true);
    });
  });

  it.each([
    ['absent', undefined],
    ['null', null],
    ['not an array', { campaign_number: '20V123000' }],
    ['a row with no campaign number', [{ addressed_at: '2026-08-23' }]],
  ])('shows a recall as open when the marks embed is %s', async (_label, marks) => {
    /*
      ⚠ The direction that matters, and the reason this is four cases rather
      than one. A malformed embed must leave a notice **showing** — suppressing
      an open safety recall because a field did not arrive is the one outcome
      this screen must never produce, and each shape above is a different way
      the field can fail to arrive.
    */
    request.mockImplementation((path: string) =>
      Promise.resolve({
        vehicle: {
          year: 2018,
          make: 'Honda',
          model: 'Accord',
          nhtsa_data: { recalls: [rawRecall()] },
          recall_actions: marks,
        },
      } as never)
    );

    const view = await mount();

    await view.findByText('1 open');
    view.getByLabelText(/Mark as repaired/i);
  });

  it('does not offer a mark on a recall with no campaign number', async () => {
    // The mark keys on `(vehicle_id, campaign_number)`. A button that silently
    // does nothing is worse than one that is not there.
    respondWith([rawRecall({ NHTSACampaignNumber: undefined })]);
    const view = await mount();

    await view.findByText('FUEL PUMP');
    expect(view.queryByLabelText(/Mark as repaired/i)).toBeNull();
    // Anti-vacuous: the other action is still offered, so this is about the
    // campaign number rather than about the actions failing to render.
    view.getByLabelText(/Find a dealer/i);
  });
});

/**
 * ── R28 / R29: what the card is allowed to print ────────────────────────────
 *
 * Both were reported off the same live card on 23 Aug, and both are the same
 * class of defect: a value that came out of a database was rendered as if it
 * had been written for a person.
 */
describe('the strings this card prints', () => {
  it('titles the card with a name, not NHTSA’s taxonomy', async () => {
    respond([rawRecall({ Component: 'AIR BAGS:SIDE/WINDOW:HEAD' })]);
    const { view } = await mount();

    await view.findByText('Airbags — side/window, head');
    // The raw code survives at provenance weight — a service desk knows it.
    view.getByText('AIR BAGS:SIDE/WINDOW:HEAD');
  });

  it('never reads the taxonomy string out loud', async () => {
    /*
      ⚠ The accessible names are where an enum would be *spoken*. Every one on
      this card goes through `plainComponent`, which is the reason it exists as
      a helper rather than a call at each site.
    */
    respond([rawRecall({ Component: 'AIR BAGS:SIDE/WINDOW:HEAD' })]);
    const { view } = await mount();

    await view.findByText('Airbags — side/window, head');
    view.getByLabelText('Ask the advisor about the Airbags — side/window, head recall');
  });

  it('renders the issue date as a date — the 2025-17-12 case', async () => {
    /*
      The live M235i card read **`Issued 2025-17-12`**. There is no month 17.
      `17/12/2025` is day-first, and `parseRecallDate` read every `d/d/YYYY` as
      month-first; the string it built was then rendered faithfully by every
      layer below it.
    */
    respond([rawRecall({ ReportReceivedDate: '17/12/2025' })]);
    const { view } = await mount();

    await view.findByText('Issued 17 Dec 2025');
    expect(view.queryByText(/2025-17-12/)).toBeNull();
  });

  it('says nothing rather than guessing at a date it cannot read', async () => {
    /*
      §10. `01/02/2026` is readable two ways and no sibling in the batch settles
      it — so there is no "Issued" line at all. A missing one costs an owner
      nothing; a transposed one tells them a 2019 campaign was issued last month.
    */
    respond([rawRecall({ ReportReceivedDate: '01/02/2026' })]);
    const { view } = await mount();

    await view.findByText('Campaign 20V123000');
    expect(view.queryByText(/^Issued /)).toBeNull();
  });

  it('reads an ambiguous date once a sibling settles the format', async () => {
    /*
      The batch inference, end to end. `01/02/2026` alone is unreadable; beside
      `24/04/2024` — which can only be day-first — it is 1 February.
    */
    respond([
      rawRecall({ ReportReceivedDate: '01/02/2026' }),
      rawRecall({ NHTSACampaignNumber: '21V999000', ReportReceivedDate: '24/04/2024' }),
    ]);
    const { view } = await mount();

    await view.findByText('Issued 1 Feb 2026');
    view.getByText('Issued 24 Apr 2024');
  });
});

/**
 * ── R16: the same component, as a section of Health ─────────────────────────
 *
 * Folding recalls under the score they drive means this renders inside
 * `HealthScreen`'s scroller. Two structural things change, and both are the
 * kind that look fine in a unit test and are broken on a device:
 *
 *   - A `ScrollView` inside a `ScrollView` on the same axis. The inner one eats
 *     the gesture and the outer one stops at its height.
 *   - `flex: 1` inside a scroll container, which collapses to zero — so an
 *     error state renders as an empty gap rather than as a message.
 */
describe('embedded in the health screen', () => {
  /** Every host view in the rendered tree, by type name. */
  function hostTypes(view: { toJSON: () => unknown }) {
    const found: string[] = [];
    const walk = (node: unknown) => {
      if (!node || typeof node !== 'object') return;
      const host = node as { type?: unknown; children?: unknown[] };
      if (typeof host.type === 'string') found.push(host.type);
      for (const child of host.children ?? []) walk(child);
    };
    walk(view.toJSON());
    return found;
  }

  it('renders no scroller of its own', async () => {
    respond([rawRecall()]);
    const view = await render(
      <RecallDetailScreen
        embedded
        vehicleId="v1"
        onAskAdvisor={jest.fn()}
        onSignOut={jest.fn()}
      />
    );

    await view.findByText(/Fuel pump/);
    expect(hostTypes(view)).not.toContain('RCTScrollView');
  });

  it('still renders one when it is the screen', async () => {
    // The anti-vacuous half: a component that never scrolls would pass above.
    respond([rawRecall()]);
    const view = await render(
      <RecallDetailScreen vehicleId="v1" onAskAdvisor={jest.fn()} onSignOut={jest.fn()} />
    );

    await view.findByText(/Fuel pump/);
    expect(hostTypes(view)).toContain('RCTScrollView');
  });

  it('leaves the car unnamed, because the host has already named it', async () => {
    respond([rawRecall()]);
    const view = await render(
      <RecallDetailScreen
        embedded
        vehicleId="v1"
        onAskAdvisor={jest.fn()}
        onSignOut={jest.fn()}
      />
    );

    await view.findByText(/Fuel pump/);
    expect(view.queryByText('2018 Honda Accord')).toBeNull();
  });

  it('shows an error as a message, not as an empty gap', async () => {
    request.mockRejectedValue(new ApiRequestError({ status: 500, message: 'Upstream failed' }));

    const view = await render(
      <RecallDetailScreen
        embedded
        vehicleId="v1"
        onAskAdvisor={jest.fn()}
        onSignOut={jest.fn()}
      />
    );

    await waitFor(() => expect(view.getByText('Could not load recalls')).toBeTruthy());

    /*
      ⚠ `flex: 1` is what would collapse it. Asserted on the style rather than
      on a measured height, because RNTL lays nothing out — but this is the
      exact property, and it is the one a future edit would restore by
      copy-pasting the screen-mode container.
    */
    const flat = (StyleSheet.flatten(view.getByText('Could not load recalls').parent?.props.style) ??
      {}) as Record<string, unknown>;
    expect(flat.flex).toBe(0);
  });
});

/**
 * ── MOB-08: a server 401 leaves something on the screen ─────────────────────
 *
 * Nineteen call sites forced a sign-out on **any** 401 and then `return`ed
 * without setting a state — which is only safe if `onSignOut()` unmounts the
 * screen, and it does not when the network call was the thing that failed.
 *
 * The client already went to trouble to distinguish `isLocallySignedOut`
 * (device) from a server 401 that a retry would fix, with a docblock recording
 * that a real tester hit this three times out of three on 5 Aug — and exactly
 * **one** screen consumed it.
 */
describe('a server 401 is not a sign-out', () => {
  it('keeps the person here and offers a retry', async () => {
    /*
      ⚠ Default `origin` is `'server'`, which is the case this is about: an
      expired token while offline, or a token the server would accept a moment
      later. Signing out here destroys a working session over one response.
    */
    request.mockRejectedValue(new ApiRequestError({ status: 401, message: 'Unauthorized' }));

    const { props, view } = await mount();

    await waitFor(() => expect(view.getByText('Could not load recalls')).toBeTruthy());
    expect(props.onSignOut).not.toHaveBeenCalled();
    view.getByText('Try again');
  });

  it('does not leave the screen in skeletons forever', async () => {
    /*
      The half that actually hurt. `return` without a state meant the loading
      branch stayed rendered — no error, no retry, nothing to pull — which is
      what an offline tester saw on Health.
    */
    request.mockRejectedValue(new ApiRequestError({ status: 401, message: 'Unauthorized' }));

    const { view } = await mount();

    await waitFor(() => expect(view.getByText('Could not load recalls')).toBeTruthy());
  });
});
