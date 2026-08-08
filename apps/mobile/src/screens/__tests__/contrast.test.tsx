import { fireEvent, render } from '@testing-library/react-native';

import { GarageScreen } from '../GarageScreen';
import { VehicleDetailScreen } from '../VehicleDetailScreen';
import { InvoiceScanScreen } from '../InvoiceScanScreen';
import { RecallDetailScreen } from '../RecallDetailScreen';
import { WishlistScreen } from '../WishlistScreen';
import { ServiceMilestoneScreen } from '../ServiceMilestoneScreen';
import { SignInScreen } from '../SignInScreen';
import { AddVehicleScreen } from '../AddVehicleScreen';
import { apiRequest, ApiRequestError } from '../../api/client';
import { auditText, belowFloor, contrastRatio, SCREEN_BACKGROUND } from '../../test-support/contrast';

/**
 * The AA floor, measured on rendered screens.
 *
 * `lib/__tests__/mobile-text-contrast.test.ts` reads colour literals out of the
 * StyleSheets. That caught nine sub-floor styles and was worth writing, but it
 * cannot see a colour returned by a function, cannot know what is behind the
 * text, and reads each declaration in isolation rather than as the platform
 * merges them.
 *
 * The most important gap is the first. `healthBandHex()` returns the health
 * score's colour, so **the largest, most prominent number on two screens has
 * never been contrast-checked by anything** — the scan sees a function call.
 * The score is also the one colour that changes with the data, which is exactly
 * the case a literal scan is blind to.
 *
 * Both suites stay. The scan covers every style in the app including screens
 * nothing mounts; this covers fewer styles far more truthfully.
 */

jest.mock('../../api/client', () => {
  const actual = jest.requireActual('../../api/client');
  return { ...actual, apiRequest: jest.fn() };
});

const request = apiRequest as jest.MockedFunction<typeof apiRequest>;

/** The four bands, so every colour `healthBandHex` can return is measured. */
const SCORES = [92, 74, 55, 28];

const VEHICLE = (score: number) => ({
  id: 'db143cdc-e68c-46f0-849e-69f7a1873f58',
  year: 2015,
  make: 'BMW',
  model: 'M235i',
  trim: 'xDrive',
  current_mileage: 66000,
  avg_miles_per_month: 800,
  vehicle_status: 'daily_driver',
  performance_goal: 'mild',
  ownership_objective: 'Keep it reliable.',
  vehicle_health_summary: { health_score: score, summary: 'Fair.' },
  nhtsa_data: { recalls: [{ id: 1 }, { id: 2 }] },
});

beforeEach(() => jest.clearAllMocks());

describe('the health score colour — never checked by the source scan', () => {
  it.each(SCORES)('reads at AA on the garage card at score %i', async (score) => {
    request.mockResolvedValue({ vehicles: [VEHICLE(score)] });

    const view = await render(
      <GarageScreen
        accessToken="t"
        email="owner@example.test"
        onSignOut={jest.fn()}
        onOpenVehicle={jest.fn()}
        onAddVehicle={jest.fn()}
      />
    );

    await view.findByText('2015 BMW M235i');

    /*
      No backdrop passed: the helper derives each text's true surface from the
      tree, so a card, an inset panel and a white button are each measured
      against themselves rather than against one guess for the whole screen.
    */
    expect(belowFloor(auditText(view))).toEqual([]);
  });

  it.each(SCORES)('reads at AA on the vehicle detail card at score %i', async (score) => {
    request.mockResolvedValue({ vehicle: VEHICLE(score) });

    const view = await render(
      <VehicleDetailScreen
        vehicleId="db143cdc-e68c-46f0-849e-69f7a1873f58"
        onBack={jest.fn()}
        onSignOut={jest.fn()}
        onAskAdvisor={jest.fn()}
        onScanInvoice={jest.fn()}
        onViewRecalls={jest.fn()}
        onOpenWishlist={jest.fn()}
      />
    );

    await view.findByText('2015 BMW M235i');

    expect(belowFloor(auditText(view))).toEqual([]);
  });
});

describe('failure states, which are where sub-floor text hides', () => {
  it('the garage error screen', async () => {
    request.mockRejectedValue(new ApiRequestError({ status: 500, message: 'Upstream is down' }));

    const view = await render(
      <GarageScreen
        accessToken="t"
        email="owner@example.test"
        onSignOut={jest.fn()}
        onOpenVehicle={jest.fn()}
        onAddVehicle={jest.fn()}
      />
    );

    await view.findByText('Upstream is down');
    expect(belowFloor(auditText(view))).toEqual([]);
  });

  it('the garage empty state, which is the first thing a new user sees', async () => {
    request.mockResolvedValue({ vehicles: [] });

    const view = await render(
      <GarageScreen
        accessToken="t"
        email="owner@example.test"
        onSignOut={jest.fn()}
        onOpenVehicle={jest.fn()}
        onAddVehicle={jest.fn()}
      />
    );

    await view.findByText('No vehicles yet');
    expect(belowFloor(auditText(view))).toEqual([]);
  });

  it('the vehicle that is no longer there', async () => {
    request.mockRejectedValue(new ApiRequestError({ status: 404, message: 'Vehicle not found' }));

    const view = await render(
      <VehicleDetailScreen
        vehicleId="db143cdc-e68c-46f0-849e-69f7a1873f58"
        onBack={jest.fn()}
        onSignOut={jest.fn()}
        onAskAdvisor={jest.fn()}
        onScanInvoice={jest.fn()}
        onViewRecalls={jest.fn()}
        onOpenWishlist={jest.fn()}
      />
    );

    await view.findByText('This vehicle is no longer here');
    expect(belowFloor(auditText(view))).toEqual([]);
  });
});

describe('the invoice scanner', () => {
  it('reads at AA in its idle state', async () => {
    const view = await render(
      <InvoiceScanScreen
        vehicleId="db143cdc-e68c-46f0-849e-69f7a1873f58"
        pickImage={jest.fn()}
        onSignOut={jest.fn()}
      />
    );

    await view.findByText('Scan an invoice');
    expect(belowFloor(auditText(view))).toEqual([]);
  });
});

describe('the advisor CTA, which is dark text on white', () => {
  it('is measured against its own surface, not the screen', async () => {
    request.mockResolvedValue({ vehicle: VEHICLE(74) });

    const view = await render(
      <VehicleDetailScreen
        vehicleId="db143cdc-e68c-46f0-849e-69f7a1873f58"
        onBack={jest.fn()}
        onSignOut={jest.fn()}
        onAskAdvisor={jest.fn()}
        onScanInvoice={jest.fn()}
        onViewRecalls={jest.fn()}
        onOpenWishlist={jest.fn()}
      />
    );

    await view.findByText('Ask the advisor');

    /*
      A white button carrying near-black text. Audited against the screen it
      reads as 1.09:1 — a catastrophic failure that is in fact the best
      contrast on the screen, measured against the wrong surface. The derived
      backdrop is what makes this assertion mean anything.
    */
    const audits = auditText(view).filter((a) =>
      a.text.startsWith('Ask the advisor') || a.text.startsWith('It already knows')
    );

    expect(audits.length).toBeGreaterThan(0);
    expect(belowFloor(audits)).toEqual([]);
  });
});

describe('the measurement itself', () => {
  it('agrees with the floor the web guard uses', () => {
    // `text-contrast-floor.test.ts` sets FLOOR = 50, meaning /50 white. These
    // two numbers have to keep meaning the same thing.
    expect(contrastRatio('rgba(255,255,255,0.5)', SCREEN_BACKGROUND)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('rgba(255,255,255,0.45)', SCREEN_BACKGROUND)).toBeLessThan(4.5);
  });

  it('composites alpha rather than ignoring it', () => {
    // The whole point. Treating a 50% white as opaque white would report
    // 19:1 and pass everything.
    const opaque = contrastRatio('#ffffff', SCREEN_BACKGROUND)!;
    const half = contrastRatio('rgba(255,255,255,0.5)', SCREEN_BACKGROUND)!;

    expect(half).toBeLessThan(opaque);
  });

  it('finds text to audit at all', async () => {
    // Guards the guard: a walker that silently returned nothing would make
    // every assertion above pass vacuously.
    request.mockResolvedValue({ vehicles: [VEHICLE(74)] });

    const view = await render(
      <GarageScreen
        accessToken="t"
        email="owner@example.test"
        onSignOut={jest.fn()}
        onOpenVehicle={jest.fn()}
        onAddVehicle={jest.fn()}
      />
    );

    await view.findByText('2015 BMW M235i');
    expect(auditText(view).length).toBeGreaterThan(4);
  });
});

/**
 * The recall screen, 5.6.
 *
 * Two severity banners carry the only time-critical instructions in the app —
 * "do not drive this vehicle" and "park outside, away from buildings" — on
 * solid coloured fills. That is the same shape as the advisor CTA, which
 * shipped at **4.47:1** against a 4.5 floor with a comment claiming 8.6:1: the
 * measurement had been taken white-on-white when the text was near-black ink.
 * A banner nobody can read is not a banner.
 */
describe('the recall screen and its severity banners', () => {
  const RECALLS = (extra: Record<string, unknown> = {}) => ({
    vehicle: {
      year: 2015,
      make: 'BMW',
      model: 'M235i',
      nhtsa_data: {
        recalls: [
          {
            NHTSACampaignNumber: '20V123000',
            Component: 'FUEL SYSTEM',
            Summary: 'The fuel pump may fail without warning.',
            Consequence: 'A stall increases the risk of a crash.',
            Remedy: 'Dealers will replace the fuel pump, free of charge.',
            ReportReceivedDate: '06/15/2020',
            ...extra,
          },
        ],
      },
    },
  });

  it('reads at AA with an ordinary recall', async () => {
    request.mockResolvedValue(RECALLS());

    const view = await render(
      <RecallDetailScreen
        vehicleId="db143cdc-e68c-46f0-849e-69f7a1873f58"
        onSignOut={jest.fn()}
        onAskAdvisor={jest.fn()}
      />
    );

    await view.findByText('FUEL SYSTEM');
    expect(belowFloor(auditText(view))).toEqual([]);
  });

  it('reads at AA on the do-not-drive banner', async () => {
    request.mockResolvedValue(RECALLS({ parkIt: true }));

    const view = await render(
      <RecallDetailScreen
        vehicleId="db143cdc-e68c-46f0-849e-69f7a1873f58"
        onSignOut={jest.fn()}
        onAskAdvisor={jest.fn()}
      />
    );

    await view.findByText('Do not drive this vehicle');
    expect(belowFloor(auditText(view))).toEqual([]);
  });

  it('reads at AA on the park-outside banner', async () => {
    request.mockResolvedValue(RECALLS({ parkOutSide: true }));

    const view = await render(
      <RecallDetailScreen
        vehicleId="db143cdc-e68c-46f0-849e-69f7a1873f58"
        onSignOut={jest.fn()}
        onAskAdvisor={jest.fn()}
      />
    );

    await view.findByText('Park outside, away from buildings');
    expect(belowFloor(auditText(view))).toEqual([]);
  });

  it('reads at AA with no recalls on record', async () => {
    request.mockResolvedValue({ vehicle: { year: 2015, make: 'BMW', model: 'M235i', nhtsa_data: null } });

    const view = await render(
      <RecallDetailScreen
        vehicleId="db143cdc-e68c-46f0-849e-69f7a1873f58"
        onSignOut={jest.fn()}
        onAskAdvisor={jest.fn()}
      />
    );

    await view.findByText('No recalls on record');
    expect(belowFloor(auditText(view))).toEqual([]);
  });

  it('does not draw a remedy section the data cannot fill', async () => {
    // The stored payloads predate `Remedy`. A "How it gets fixed" heading over
    // an empty box reads as "nobody knows how to fix this".
    request.mockResolvedValue({
      vehicle: {
        year: 2015,
        make: 'BMW',
        model: 'M235i',
        nhtsa_data: {
          recalls: [
            {
              NHTSACampaignNumber: '19V098000',
              Component: 'BACK OVER PREVENTION',
              Summary: 'The rearview camera image may fail to display.',
              ReportReceivedDate: '03/02/2019',
            },
          ],
        },
      },
    });

    const view = await render(
      <RecallDetailScreen
        vehicleId="db143cdc-e68c-46f0-849e-69f7a1873f58"
        onSignOut={jest.fn()}
        onAskAdvisor={jest.fn()}
      />
    );

    await view.findByText('BACK OVER PREVENTION');
    expect(view.queryByText('How it gets fixed')).toBeNull();
    expect(belowFloor(auditText(view))).toEqual([]);
  });
});

/**
 * The wishlist, 5.6 — the one screen that widens the mobile surface.
 *
 * Its "Add to wishlist" button is near-black text on white, the same
 * construction as the advisor CTA that shipped at 4.47:1.
 *
 * ⚠ **This suite cannot see `opacity` either.** `auditText` derives each text's
 * surface from the style tree, and a parent alpha never reaches the comparison
 * — measured, by dropping the disabled CTA's original `opacity: 0.55` to
 * `0.12`: all 39 tests stayed green while the label became unreadable. So the
 * disabled state uses an explicit fill instead, which *is* measured. Anything
 * greyed out with `opacity` in this app is outside both contrast guards.
 */
describe('the wishlist', () => {
  it('reads at AA with items on the list', async () => {
    request.mockResolvedValue({
      wishlistItems: [
        {
          id: 'w1',
          item_name: 'CVT fluid flush',
          item_type: 'maintenance',
          category: 'Transmission',
          description: 'Due at the next service.',
          estimated_cost_parts: 120,
          estimated_cost_labor: 180,
        },
      ],
    });

    const view = await render(
      <WishlistScreen vehicleId="db143cdc-e68c-46f0-849e-69f7a1873f58" onSignOut={jest.fn()} />
    );

    await view.findByText('CVT fluid flush');
    expect(belowFloor(auditText(view))).toEqual([]);
  });

  it('reads at AA in its empty state, which is what a new user sees', async () => {
    request.mockResolvedValue({ wishlistItems: [] });

    const view = await render(
      <WishlistScreen vehicleId="db143cdc-e68c-46f0-849e-69f7a1873f58" onSignOut={jest.fn()} />
    );

    await view.findByText('Nothing on the list yet');
    expect(belowFloor(auditText(view))).toEqual([]);
  });

  it('reads at AA with the add button disabled', async () => {
    // The composer is empty on load, so the CTA renders in its disabled fill.
    // This assertion only means something because that state is an explicit
    // colour rather than an opacity — see the warning above.
    request.mockResolvedValue({ wishlistItems: [] });

    const view = await render(
      <WishlistScreen vehicleId="db143cdc-e68c-46f0-849e-69f7a1873f58" onSignOut={jest.fn()} />
    );

    await view.findByText('Add to wishlist');
    expect(belowFloor(auditText(view))).toEqual([]);
  });

  it('reads at AA on its error state', async () => {
    request.mockRejectedValue(new ApiRequestError({ status: 500, message: 'Upstream is down' }));

    const view = await render(
      <WishlistScreen vehicleId="db143cdc-e68c-46f0-849e-69f7a1873f58" onSignOut={jest.fn()} />
    );

    await view.findByText('Could not load the wishlist');
    expect(belowFloor(auditText(view))).toEqual([]);
  });
});

/**
 * The service milestone screen, 5.6.
 *
 * Two states worth measuring separately: the mileage gate it opens on, and the
 * milestone behind it. The gate has a white primary CTA with near-black ink —
 * the construction that shipped at 4.47:1 on the advisor — and the milestone
 * carries an "on the wishlist" state that uses an explicit dim fill rather than
 * `opacity`, because this suite cannot see a parent alpha.
 */
describe('the service milestone screen', () => {
  const CAR = {
    vehicle: { year: 2015, make: 'BMW', model: 'M235i', current_mileage: 66000 },
    knowledge: {
      maintenance_schedule: [
        {
          service: 'Engine oil and filter',
          interval_miles: 7500,
          description: 'Drain the oil, replace the filter.',
          priority: 'Critical',
        },
        {
          service: 'Brake fluid flush',
          interval_months: 24,
          description: 'Absorbs water whether you drive it or not.',
          priority: 'Critical',
        },
      ],
    },
  };

  it('reads at AA on the mileage gate it opens on', async () => {
    request.mockResolvedValue(CAR);

    const view = await render(
      <ServiceMilestoneScreen
        vehicleId="db143cdc-e68c-46f0-849e-69f7a1873f58"
        onSignOut={jest.fn()}
      />
    );

    await view.findByText('Still around 66,000 miles?');
    expect(belowFloor(auditText(view))).toEqual([]);
  });

  it('reads at AA on the milestone, once the reading is confirmed', async () => {
    request.mockResolvedValue(CAR);

    const view = await render(
      <ServiceMilestoneScreen
        vehicleId="db143cdc-e68c-46f0-849e-69f7a1873f58"
        onSignOut={jest.fn()}
      />
    );

    fireEvent.press(await view.findByText('That is right'));

    // The oil interval lands the car inside a milestone; brake fluid has no
    // recorded date, so it renders in the "timed by date" block rather than
    // vanishing — the defect this whole screen's logic was rewritten for.
    await view.findByText('Timed by date, not mileage');
    expect(belowFloor(auditText(view))).toEqual([]);
  });

  it('reads at AA on its error state', async () => {
    request.mockRejectedValue(new ApiRequestError({ status: 500, message: 'Upstream is down' }));

    const view = await render(
      <ServiceMilestoneScreen
        vehicleId="db143cdc-e68c-46f0-849e-69f7a1873f58"
        onSignOut={jest.fn()}
      />
    );

    await view.findByText('Could not load this car');
    expect(belowFloor(auditText(view))).toEqual([]);
  });

  it('surfaces a time-only service rather than dropping it', async () => {
    // Not a contrast assertion. This is the brake-fluid regression, checked on
    // a rendered screen: a car whose only structured entry is time-based must
    // still show that entry somewhere.
    request.mockResolvedValue({
      vehicle: { year: 2018, make: 'Honda', model: 'Accord', current_mileage: 94800 },
      knowledge: {
        maintenance_schedule: [
          { service: 'Brake fluid flush', interval_months: 36, priority: 'Critical' },
        ],
      },
    });

    const view = await render(
      <ServiceMilestoneScreen
        vehicleId="a1000000-0000-0000-0000-000000000001"
        onSignOut={jest.fn()}
      />
    );

    fireEvent.press(await view.findByText('That is right'));

    await view.findByText('Timed by date, not mileage');
    expect(view.queryByText(/Brake fluid flush/)).not.toBeNull();
    expect(belowFloor(auditText(view))).toEqual([]);
  });
});

/**
 * Sign-in — the first screen anyone sees, and until 7 Aug 2026 **no test
 * mounted it**.
 *
 * Its submit button is disabled on arrival: the form is empty, so the state a
 * new user actually meets is the greyed-out one. It used `opacity: 0.4` on a
 * white fill with a near-black label — about 1.85:1 against a 4.5 floor —
 * and neither guard could see it. The source scan reads colour literals and
 * there are none; this suite did not composite a parent alpha until today.
 */
describe('the sign-in screen', () => {
  it('reads at AA in the disabled state it opens in', async () => {
    const view = await render(<SignInScreen />);

    await view.findByText('Sign in');
    expect(belowFloor(auditText(view))).toEqual([]);
  });
});

/**
 * The two screens that make a person a user, 8 Aug.
 *
 * Until the mobile-first pivot neither existed: `SignInScreen` could only sign
 * in, and there was no add-vehicle anywhere in the app. They are now the first
 * two screens anyone sees, which makes them the two most expensive places for
 * unreadable text — and both open in a disabled state, which is the class of
 * defect that has slipped past twice already.
 */
describe('sign-up', () => {
  it('reads at AA in create-account mode', async () => {
    const view = await render(<SignInScreen />);

    fireEvent.press(await view.findByText('New here? Create an account'));

    await view.findByText('Create your garage');
    expect(belowFloor(auditText(view))).toEqual([]);
  });
});

describe('add a car', () => {
  it('reads at AA in the disabled state it opens in', async () => {
    // The form is empty on arrival, so the submit button renders in its
    // unavailable fill — the state a new user actually meets first.
    const view = await render(
      <AddVehicleScreen onAdded={jest.fn()} onSignOut={jest.fn()} />
    );

    await view.findByText('Add to my garage');
    expect(belowFloor(auditText(view))).toEqual([]);
  });

  it('reads at AA with the form filled and both choices rendered', async () => {
    const view = await render(
      <AddVehicleScreen onAdded={jest.fn()} onSignOut={jest.fn()} />
    );

    fireEvent.changeText(view.getByLabelText('Model year'), '2020');
    fireEvent.changeText(view.getByLabelText('Make'), 'Subaru');
    fireEvent.changeText(view.getByLabelText('Model'), 'WRX');

    // Both the selected and unselected chip, since they are different fills.
    await view.findByText('Not for me');
    expect(belowFloor(auditText(view))).toEqual([]);
  });

});
