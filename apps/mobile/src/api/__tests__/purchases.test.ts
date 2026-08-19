/**
 * Reporting a purchase to the server.
 *
 * Phase 6, E8. The mapping from status to verdict is tested in
 * `purchase-flow.test.ts`, beside the route contract it mirrors. What is tested
 * here is the part that only exists on the device: which failures mean Apple
 * declined something, and which mean nothing was ever asked.
 *
 * The distinction matters because the money has already left before this
 * function is called. A failure reported as "we could not confirm your
 * purchase" when the request was never sent invites somebody to buy it twice.
 */

/* Must be `mock`-prefixed: jest hoists the factory above this declaration. */
const mockApiRequest = jest.fn();

jest.mock('../client', () => {
  class ApiRequestError extends Error {
    status: number;
    origin: string;
    constructor({ status, origin = 'server' }: { status: number; origin?: string }) {
      super(`status ${status}`);
      this.status = status;
      this.origin = origin;
    }
  }
  return {
    ApiRequestError,
    apiRequest: (...args: unknown[]) => mockApiRequest(...args),
  };
});

import { ApiRequestError } from '../client';
import { verifyPurchase } from '../purchases';

beforeEach(() => mockApiRequest.mockReset());

describe('what the server said', () => {
  it('sends the signed transaction and nothing else', async () => {
    /*
      No tier, no product, no expiry. Every one of those would be a value the
      device chose, and the server takes them from inside Apple's signature.
    */
    mockApiRequest.mockResolvedValue({ entitlement: { tier: 'paid', recorded: true } });

    await verifyPurchase('signed-jws');

    expect(mockApiRequest).toHaveBeenCalledWith('/iap/verify', {
      method: 'POST',
      body: { jwsRepresentation: 'signed-jws' },
    });
  });

  it('reads a paid entitlement', async () => {
    mockApiRequest.mockResolvedValue({ entitlement: { tier: 'paid', recorded: true } });
    await expect(verifyPurchase('j')).resolves.toEqual({ kind: 'entitled', tier: 'paid' });
  });

  it('does not read a 200 with nothing recorded as entitlement', async () => {
    mockApiRequest.mockResolvedValue({ entitlement: { tier: null, recorded: false } });
    await expect(verifyPurchase('j')).resolves.toEqual({ kind: 'recorded-not-entitled' });
  });

  it.each([
    [409, 'belongs-to-another-account'],
    [503, 'retry-later'],
    [400, 'rejected'],
    [500, 'network'],
  ])('maps a %s from the route', async (status, kind) => {
    mockApiRequest.mockRejectedValue(new ApiRequestError({ status: status as number }));
    await expect(verifyPurchase('j')).resolves.toMatchObject({ kind });
  });
});

describe('failures where nothing was ever asked', () => {
  it('treats a device-side 401 as network, not as a rejected purchase', async () => {
    /*
      `apiRequest` throws a 401 with `origin: 'device'` when no token is stored
      — it decides that locally and sends nothing. Reporting it as `rejected`
      would tell somebody Apple would not confirm a transaction that was never
      presented to anybody.
    */
    mockApiRequest.mockRejectedValue(new ApiRequestError({ status: 401, origin: 'device' }));

    await expect(verifyPurchase('j')).resolves.toEqual({ kind: 'network' });
  });

  it('still treats a server 401 as rejected', async () => {
    // Anti-vacuous: the rule above is about origin, not about the status.
    mockApiRequest.mockRejectedValue(new ApiRequestError({ status: 401, origin: 'server' }));

    await expect(verifyPurchase('j')).resolves.toEqual({ kind: 'rejected' });
  });

  it('treats a thrown non-HTTP failure as network rather than deciding', async () => {
    mockApiRequest.mockRejectedValue(new Error('timeout'));
    await expect(verifyPurchase('j')).resolves.toEqual({ kind: 'network' });
  });
});
