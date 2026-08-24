import { render, userEvent, waitFor } from '@testing-library/react-native';

import { VehicleDetailScreen } from '../VehicleDetailScreen';
import { REFERENCE, SHORTEST, withSafeArea } from '../../test-support/safe-area';
import {
  HERO_NAV_FADE_START,
  HERO_TITLE_FADE_SPAN,
  detailHeroHeight,
  heroBands,
  heroTitleClearsNavTitle,
} from '../../theme/hero-motion';
import * as RN from 'react-native';
import { StyleSheet } from 'react-native';

/**
 * Every rendered host node of a kind, with its props.
 *
 * The same walker `instruments.test.tsx` uses, and for the same reason: there
 * is no accessible-name route to an SVG gradient or an `Image`, nor should
 * there be — neither is an interface element.
 */
function hostNodes(root: unknown, kind: string): Array<Record<string, unknown>> {
  const found: Array<Record<string, unknown>> = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const host = node as { type?: unknown; props?: Record<string, unknown>; children?: unknown[] };
    if (host.type === kind && host.props) found.push(host.props);
    for (const child of host.children ?? []) walk(child);
  };
  walk((root as { toJSON?: () => unknown })?.toJSON?.() ?? root);
  return found;
}

/** Every matched node's rendered `fontSize`, flattened the way RN merges. */
function readoutSizes(nodes: Array<{ props: Record<string, unknown> }>): number[] {
  return nodes.map((node) => {
    const flat = (StyleSheet.flatten(node.props.style as never) ?? {}) as { fontSize?: number };
    return flat.fontSize ?? 0;
  });
}
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
  /*
    ⚠ Real NHTSA field names. The fixture was `[{ id: 1 }, { id: 2 }]`, which
    `normaliseRecall` drops for having neither a component nor a summary — it
    stood in for a shape NHTSA cannot return, and it only ever passed because
    the banner counted the raw array rather than what the recall screen draws.
  */
  const nhtsa = {
    recalls: [
      { NHTSACampaignNumber: '23V-441', Component: 'FUEL SYSTEM', Summary: 'Pump may fail.' },
      { NHTSACampaignNumber: '21V-100', Component: 'AIR BAGS', Summary: 'Inflator may rupture.' },
    ],
  };

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

/**
 * ⚠ Every mount goes under a real `SafeAreaProvider` with chosen metrics.
 *
 * The hero's whole layering argument is arithmetic on `insets.top` and the
 * window height. See `test-support/safe-area.tsx` for why the provider is used
 * for real rather than the hook being mocked.
 */
/**
 * ⚠ The metrics drive **both** the safe area and the window.
 *
 * `useWindowDimensions` reads RN's `Dimensions`, not the safe-area provider, so
 * supplying `frame` alone leaves the screen laying out against jest's default
 * 750×1334 — which is above `HERO_COMPACT_BELOW`, so every "compact branch"
 * assertion would silently exercise the regular one. That is exactly the shape
 * of vacuous test §5 warns about, and it happened here on the first draft.
 */
async function mount(metrics = REFERENCE) {
  /*
    `Dimensions.get('window')`, not the `useWindowDimensions` export: RN's hook
    seeds its state from `Dimensions.get` on first render, and the module's own
    export is not spy-able through the `react-native` index under this preset.
  */
  jest.spyOn(RN.Dimensions, 'get').mockReturnValue({
    width: metrics.frame.width,
    height: metrics.frame.height,
    scale: 3,
    fontScale: 1,
  });

  const props = {
    vehicleId: 'v1',
    onBack: jest.fn(),
    onSignOut: jest.fn(),
    onAskAdvisor: jest.fn(),
    onScanInvoice: jest.fn(),
    onViewRecalls: jest.fn(),
    onOpenWishlist: jest.fn(),
    onOpenHistory: jest.fn(),
    onOpenHealth: jest.fn(),
    onOpenMilestone: jest.fn(),
    onOpenProfile: jest.fn(),
  };
  return { props, view: await render(withSafeArea(<VehicleDetailScreen {...props} />, metrics)) };
}

beforeEach(() => request.mockReset());
// The window spy is per-mount; restoring it stops one case's size leaking on.
afterEach(() => jest.restoreAllMocks());

describe('the dossier', () => {
  it('draws the car', async () => {
    respond();
    const { view } = await mount();

    expect(await view.findAllByText(/2018 Honda Accord/)).toBeTruthy();
  });

  it('reads embeds that arrive as arrays', async () => {
    /*
      A Supabase to-many embed is an array, to-one is an object, and which you
      get depends on the query. Handling one shape only would show a car with no
      health and no recalls — silently, with no error.
    */
    respond({}, { asArray: true });
    const { view } = await mount();

    expect(await view.findAllByText(/2018 Honda Accord/)).toBeTruthy();
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
    await view.findAllByText(/2018 Honda Accord/);

    expect(view.getAllByText(new RegExp(expected.label, 'i')).length).toBeGreaterThan(0);
  });

  it('says nothing about health when there is no score', async () => {
    // Absent is normal — a car added minutes ago has no summary yet. Inventing
    // a band for it would be a claim about a car nothing has assessed.
    respond({ vehicle_health_summary: null });
    const { view } = await mount();

    await view.findAllByText(/2018 Honda Accord/);
    expect(view.queryByText(new RegExp(getHealthBandJudgement(61).label, 'i'))).toBeNull();
  });
});

describe('recalls', () => {
  it('pluralises the label correctly', async () => {
    // Read aloud by a screen reader, so "1 open recalls" is a real defect
    // rather than a typo.
    respond({ nhtsa_data: { recalls: [{ NHTSACampaignNumber: '23V-441', Component: 'FUEL SYSTEM' }] } });
    const { view } = await mount();

    expect(await view.findByLabelText(/View 1 open recall$/)).toBeTruthy();
  });

  it('opens the recall screen when tapped', async () => {
    const user = userEvent.setup();
    respond();
    const { props, view } = await mount();

    await view.findAllByText(/2018 Honda Accord/);
    await user.press(view.getByLabelText(/View 2 open recalls/));

    expect(props.onViewRecalls).toHaveBeenCalledTimes(1);
  });
});

describe('the ways out', () => {
  it('reaches the plan', async () => {
    /*
      ⚠ **R15, 23 Aug.** The row reads "Plan" now — needs and mods are one
      destination, opened on the segment the row named. The callback keeps its
      name because it still opens the same list; only the place it opens *in*
      changed.
    */
    const user = userEvent.setup();
    respond();
    const { props, view } = await mount();

    await view.findAllByText(/2018 Honda Accord/);
    await user.press(view.getByText('Plan'));

    expect(props.onOpenWishlist).toHaveBeenCalledTimes(1);
  });

  it('reaches service on one row, not two', async () => {
    // R14. `Service due` and `Service history` were siblings answering one
    // question; `Service` opens on `Due` and `History` on the other segment.
    const user = userEvent.setup();
    respond();
    const { props, view } = await mount();

    await view.findAllByText(/2018 Honda Accord/);

    await user.press(view.getByText('Service'));
    expect(props.onOpenMilestone).toHaveBeenCalledTimes(1);

    await user.press(view.getByText('History'));
    expect(props.onOpenHistory).toHaveBeenCalledTimes(1);

    // And nothing on the hub still offers the two old destinations by name.
    expect(view.queryByText('Service due')).toBeNull();
    expect(view.queryByText('Wishlist')).toBeNull();
    expect(view.queryByText('Build')).toBeNull();
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
    await view.findAllByText(/2018 Honda Accord/);

    const order = textInOrder(view);
    /*
      Case-insensitive: `SectionHeader` upper-cases its title, so a section is
      "HEALTH" in the tree and "Health" in the source. Matching exactly found
      the dial's readout and missed the heading.
    */
    const at = (needle: string) =>
      order.findIndex((line) => line.toLowerCase().includes(needle.toLowerCase()));

    /*
      ⚠ Rewritten 23 Aug with the hub, and again with the IA merge. The claim is
      the same one — the verb this screen exists to lead to must not sit under a
      stack of instruments — but the landmarks changed twice: the instruments
      left this screen, and then five hub rows became three (R14, R15). `Plan`
      is where `Wishlist` and `Build` went.
    */
    expect(at('This car')).toBeGreaterThan(-1);
    expect(at('Ask the advisor')).toBeGreaterThan(-1);

    // The reading, then the places to go, then the one thing to do, then the
    // answers the owner gave when they added the car.
    expect(at('Fair')).toBeLessThan(at('This car'));
    expect(at('This car')).toBeLessThan(at('Plan'));
    expect(at('Plan')).toBeLessThan(at('Ask the advisor'));
    expect(at('Ask the advisor')).toBeLessThan(at('What you told us'));
  });

  it('shows the score twice, and never over the car', async () => {
    /*
      ⚠ Rewritten 23 Aug when the hero dial was removed. It used to assert the
      dial's readout size — 20 at hero/132, 36 at card/104 — which is now a
      component that does not exist.

      What replaced the claim: the score appears **twice**, and neither is on
      the photograph. The nav chip persists as chrome; the health card's own
      reading is the subject of the paragraph under it. Three copies existed for
      part of a day and the dial was the one that went, because it covered the
      car.
    */
    respond();
    const { view } = await mount(REFERENCE);

    await view.findAllByText(/2018 Honda Accord/);

    const readouts = await view.findAllByText('61');
    expect(readouts).toHaveLength(2);
    // The chip's fixed 16, and the card's own 30. No instrument readout.
    expect(readoutSizes(readouts).sort((a, b) => a - b)).toEqual([16, 30]);
  });

  it('sizes the hero title down on the shortest display', async () => {
    /*
      The compact branch outlived the dial it was written for. A two-line 36pt
      name is too much for a 414pt hero whether or not there is an instrument
      beside it, so the threshold still sizes the title — 36 above it, 28 below.
    */
    respond();

    const tall = await mount(REFERENCE);
    const tallTitle = (await tall.view.findAllByText(/2018 Honda Accord/))[0];
    expect(readoutSizes([tallTitle])).toEqual([36]);

    const short = await mount(SHORTEST);
    const shortTitle = (await short.view.findAllByText(/2018 Honda Accord/))[0];
    expect(readoutSizes([shortTitle])).toEqual([28]);
  });
});

describe('the first load stands in for the dossier', () => {
  it('shows a shaped placeholder rather than a dot in an empty field', async () => {
    /*
      This is the densest screen in the app and the one a recall notification
      opens, so it is the most likely to be met cold. It showed a centred
      `ActivityIndicator` until 16 Aug, while the primitive built for exactly
      this had sat unused since 14 Aug.

      `SkeletonCard` announces itself once for the group — eight identical
      "loading" bars read aloud is worse than silence — so the accessible name
      is what proves it rendered.
    */
    request.mockImplementation(() => new Promise(() => {}));

    const { view } = await mount();

    expect(view.getAllByLabelText('Loading').length).toBeGreaterThan(0);
    expect(view.queryByText(/2018 Honda Accord/)).toBeNull();
  });
});

/**
 * ── The hero pullback's geometry ────────────────────────────────────────────
 *
 * §5 of `design_handoff_v8/HERO_PULLBACK_PROMPT.md`. Most of these are
 * assertions on pure functions rather than on a rendered tree, and deliberately
 * so: the failures they guard against are **arithmetic**, they only appear
 * mid-scroll at one device size, and a render test would have to catch the
 * screen in flight to see them. `hero-motion.ts` exists so they can be checked
 * standing still.
 */
describe('the hero pullback', () => {
  /*
    ⚠ Three cases were deleted here on 23 Aug, and what they were is worth
    recording: the layering invariant (the dial docking clear of the sheet
    edge), its anti-vacuous pair, and the rest-state clearance between the
    plinth and the title. All three guarded the travelling health dial, and all
    three were the hardest-won assertions in this file — the invariant caught
    the bug the design itself had twice.

    The dial was removed because it covered the car. **There is nothing left to
    collide**, so keeping those tests would leave three guards that can never
    fail — which is worse than none, because they read as coverage. The rule
    they enforced now lives in the design's history, not in an assertion about
    a component that does not exist.
  */
  it('clamps the hero height at both ends', () => {
    // 62% of a 6.7" display is a generous hero; 62% of a 4.7" is not enough.
    expect(detailHeroHeight(667)).toBe(414);
    expect(detailHeroHeight(932)).toBe(560);

    // Anti-vacuous: the clamp is not returning a bound for everything.
    expect(detailHeroHeight(800)).toBe(496);
  });

  it('takes the compact branch only below the threshold', () => {
    /*
      ⚠ In practice only the 4.7″ display takes it — the mini (812pt → 503)
      clears by 3pt. Worth a test because that margin is what makes the clamp
      dangerous to edit.

      The branch survives the dial's removal because it still sizes the title:
      a two-line 36pt name is too much for a 414pt hero whether or not there is
      an instrument beside it.
    */
    expect(heroBands(detailHeroHeight(667)).compact).toBe(true);
    expect(heroBands(detailHeroHeight(812)).compact).toBe(false);
    expect(detailHeroHeight(812)).toBe(503);
  });

  it('finishes the hero title before the nav title starts', () => {
    // Two legible copies of one car's name on one screen is the failure the
    // stagger avoids. Held as a relationship so either number can move.
    expect(heroTitleClearsNavTitle()).toBe(true);
    expect(HERO_TITLE_FADE_SPAN).toBeLessThan(HERO_NAV_FADE_START);
  });

  it('renders the empty-state fill and no image when there is no photo', async () => {
    respond({ photo_url: null });
    const { view } = await mount();

    await view.findAllByText(/2018 Honda Accord/);
    expect(hostNodes(view.root, 'Image')).toHaveLength(0);
    // The radial is a designed state, not a gap — a garage carries
    // unphotographed vehicles for weeks.
    expect(hostNodes(view.root, 'RNSVGRadialGradient').length).toBeGreaterThan(0);
  });

  it('gives the nav title the slack and reserves the chip its slot', async () => {
    /*
      Centred across the full width, "2019 Mercedes-AMG C63 S" runs under both
      the chip and the control beside it. The title is the only thing keeping
      the car from being anonymous once the hero is covered, so it takes the
      slack and truncates rather than sharing space with chrome.
    */
    respond({ make: 'Mercedes-AMG', model: 'C63 S', year: 2019 });
    const { view } = await mount();

    const titles = await view.findAllByText(/2019 Mercedes-AMG C63 S/);
    const nav = titles
      .map((node) => (StyleSheet.flatten(node.props.style as never) ?? {}) as Record<string, unknown>)
      .find((flat) => flat.flex === 1);

    expect(nav).toBeDefined();
    expect(titles.some((node) => node.props.numberOfLines === 1)).toBe(true);
  });
});

/**
 * ── The health verdict may not outrank the records beside it ────────────────
 *
 * 23 Aug, on the real M235i: the card read "a complete lack of documented
 * maintenance … impossible to assess its current condition" while the service
 * history one tap away listed five services and $1,461.
 *
 * Both were honest. The summary row was generated on 30 Jul, the invoice was
 * filed on 6 Aug, and nothing on this read path recomputes it — so the screen
 * was handed an out-of-date sentence and presented it as a current one.
 *
 * `healthVerdict` owns the rule; this is the screen actually applying it, with
 * the live row's own values. The prose and the count arrive on **different
 * requests**, so the mock is per-URL rather than one body for all three: the
 * contradiction only exists where those two meet.
 */
describe('the health verdict, against what the screen is holding', () => {
  const STALE_SUMMARY =
    "Based on your provided service history, the vehicle's health is highly uncertain due to a complete lack of documented maintenance.";

  /** Three requests go out together; each gets the body it would really get. */
  function respondWith({
    summary,
    lastGenerated,
    filedAt,
  }: {
    summary: string;
    lastGenerated: string | null;
    filedAt: string | null;
  }) {
    request.mockImplementation((path: string) => {
      if (path.startsWith('/load-maintenance-data')) {
        return Promise.resolve({
          maintenanceLineItems:
            filedAt === null ? [] : Array.from({ length: 5 }, () => ({ created_at: filedAt })),
        }) as never;
      }

      if (path.startsWith('/wishlist')) return Promise.resolve({ wishlistItems: [] }) as never;

      return Promise.resolve({
        vehicle: {
          id: 'v1',
          year: 2015,
          make: 'BMW',
          model: 'M235i',
          current_mileage: 66_000,
          vehicle_health_summary: {
            health_score: 70,
            summary,
            last_generated: lastGenerated,
          },
          nhtsa_data: {
            recalls: [
              {
                NHTSACampaignNumber: '25V871000',
                Component: 'AIR BAGS',
                Summary: 'Inflator may rupture.',
              },
              {
                NHTSACampaignNumber: '23V-441',
                Component: 'FUEL SYSTEM',
                Summary: 'Pump may fail.',
              },
            ],
          },
        },
      }) as never;
    });
  }

  it('does not show a sentence written before the records it contradicts', async () => {
    respondWith({
      summary: STALE_SUMMARY,
      lastGenerated: '2026-07-30T01:05:47.583+00:00',
      filedAt: '2026-08-06T02:43:11.903661+00:00',
    });

    const { view } = await mount();
    await view.findAllByText(/2015 BMW M235i/);

    // The sentence itself is gone, not captioned. Both halves are asserted:
    // a card that simply stopped rendering anything would pass the first.
    expect(view.queryByText(/complete lack of documented maintenance/)).toBeNull();
    await view.findByText(/taken before your 5 service records were filed/i);
  });

  it('names what the reading was worked out from', async () => {
    respondWith({
      summary: 'Solid history, nothing overdue.',
      lastGenerated: '2026-08-20T00:00:00+00:00',
      filedAt: '2026-08-06T02:43:11.903661+00:00',
    });

    const { view } = await mount();
    await view.findByText('Solid history, nothing overdue.');

    // The provenance line is what makes a contradiction visible on the screen
    // rather than only to somebody who opens the history and compares.
    await view.findByText(/Based on 5 recorded services · 2 open recalls/);
  });

  it('leaves a current reading alone', async () => {
    /*
      The anti-vacuous half. A screen that suppressed every summary would pass
      the first case here and be worse than the defect — so a reading that
      postdates its records has to survive intact.
    */
    respondWith({
      summary: STALE_SUMMARY,
      lastGenerated: '2026-08-20T00:00:00+00:00',
      filedAt: '2026-08-06T02:43:11.903661+00:00',
    });

    const { view } = await mount();
    await view.findByText(new RegExp('complete lack of documented maintenance'));
  });
});

/**
 * ── R10 / R24 / R25: the chrome that persists ───────────────────────────────
 *
 * The nav pills and the score chip are on screen for the whole of this screen's
 * scroll, which makes them the app's most-used controls and the ones where a
 * missing hit area or a missing name costs the most.
 */
describe('the hero’s nav, as controls', () => {
  it('gives the score chip a name that says where it goes', async () => {
    respond();
    const { view } = await mount();

    /*
      R10. It was `pointerEvents="none"` chrome announcing "Health score 61 out
      of 100 — Fair" and offering nothing to do about it. A reading and a door
      to a reading are different things, and the arc cannot distinguish them.
    */
    const chip = await view.findByLabelText('Health score 61, Fair. Opens health detail.');
    expect(chip.props.accessibilityRole).toBe('button');
  });

  it('opens the health detail from the chip', async () => {
    respond();
    const { props, view } = await mount();

    await userEvent.press(
      await view.findByLabelText('Health score 61, Fair. Opens health detail.')
    );
    expect(props.onOpenHealth).toHaveBeenCalled();
  });

  it('grows both nav targets to 44pt without redrawing them', async () => {
    /*
      R25. The pills are drawn at 36 because that is what reads as a pill over a
      photograph rather than as a bar. `hitSlop` is React Native's
      `.tap-target-44`: the drawing is unchanged and the target grows around it.

      Asserted as slop rather than as a measured box — RNTL lays nothing out, so
      a height assertion here would be reading back the style it was given. What
      is checkable is that the compensation is present on both, which is the
      thing that goes missing.
    */
    respond();
    const { view } = await mount();

    for (const label of ['Back to the garage', 'Health score 61, Fair. Opens health detail.']) {
      const slop = (await view.findByLabelText(label)).props.hitSlop as Record<string, number>;

      expect(slop).toBeDefined();
      // 36 drawn + 4 top + 4 bottom clears 44; anything less does not.
      expect(slop.top + slop.bottom).toBeGreaterThanOrEqual(8);
    }
  });
});
