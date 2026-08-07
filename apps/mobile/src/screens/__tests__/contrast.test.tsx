import { render } from '@testing-library/react-native';

import { GarageScreen } from '../GarageScreen';
import { VehicleDetailScreen } from '../VehicleDetailScreen';
import { InvoiceScanScreen } from '../InvoiceScanScreen';
import { RecallDetailScreen } from '../RecallDetailScreen';
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
