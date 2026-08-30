/**
 * A caller-supplied storage path meeting a privileged client.
 *
 * @jest-environment node
 *
 * `downloadStoredFile` reads with the service role, which bypasses RLS
 * completely. Its callers authorize a `vehicleId` and then hand it a
 * *separate* file path that came from the request body. Until 31 Jul nothing
 * tied those two together, so proving access to one vehicle was enough to read
 * an object under any other — and a value that was not a storage path at all
 * was fetched over the network and handed to a model.
 *
 * These tests are the guard, written the way `resolveVehiclePhoto`'s are: the
 * refusals are asserted as *refusals to reach the privileged client*, not as
 * error strings, because the property is that the read never happens.
 */

import { downloadStoredFile } from '../storage-objects';
import { storedUrl } from '@wellkept/core/storage-paths';

const VEHICLE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_VEHICLE_ID = '22222222-2222-4222-8222-222222222222';

const download = jest.fn();

jest.mock('@/lib/supabase', () => ({
  getServiceRoleClient: () => ({
    storage: { from: () => ({ download: (path: string) => download(path) }) },
  }),
}));

describe('downloadStoredFile', () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    download.mockReset();
    download.mockResolvedValue({
      data: { arrayBuffer: async () => new TextEncoder().encode('bytes').buffer },
      error: null,
    });
    global.fetch = jest.fn(async () => {
      throw new Error('downloadStoredFile must not make network requests');
    }) as never;
  });

  afterAll(() => {
    global.fetch = realFetch;
  });

  it('reads an object belonging to the authorized vehicle', async () => {
    const result = await downloadStoredFile(
      storedUrl(`${VEHICLE_ID}/consultant/invoice.pdf`),
      VEHICLE_ID
    );

    expect(download).toHaveBeenCalledWith(`${VEHICLE_ID}/consultant/invoice.pdf`);
    expect(result).not.toBeNull();
  });

  /*
    The hole, as it was reachable: authorize your own vehicle, attach a path
    under someone else's. The consultant would read a stranger's invoice out
    to the caller in plain language.
  */
  it('refuses a path under a different vehicle, without reading it', async () => {
    const result = await downloadStoredFile(
      storedUrl(`${OTHER_VEHICLE_ID}/consultant/private-invoice.pdf`),
      VEHICLE_ID
    );

    expect(result).toBeNull();
    expect(download).not.toHaveBeenCalled();
  });

  it('refuses a path with no vehicle prefix at all', async () => {
    // The legacy layouts — `invoices/…`, `vehicle-photos/…`. Ownership is not
    // derivable from them, so they cannot be authorized and are not read.
    const result = await downloadStoredFile(storedUrl('invoices/old.pdf'), VEHICLE_ID);

    expect(result).toBeNull();
    expect(download).not.toHaveBeenCalled();
  });

  describe('never makes a network request', () => {
    /*
      The second half of the hole. A value that was not a stored path fell
      through to `fetch(fileUrl)` — an arbitrary server-side request whose
      response was passed to Gemini, which then described it back to the
      caller. Cloud metadata endpoints and internal services are reachable from
      this process and not from the browser, which is the whole point of SSRF.
    */
    const cases = [
      ['a cloud metadata address', 'http://169.254.169.254/latest/meta-data/iam/security-credentials/'],
      ['an internal service', 'http://localhost:8080/admin'],
      ['an ordinary external URL', 'https://example.com/invoice.pdf'],
      ['a file URL', 'file:///etc/passwd'],
    ];

    it.each(cases)('%s', async (_label, url) => {
      const result = await downloadStoredFile(url as string, VEHICLE_ID);

      expect(result).toBeNull();
      expect(global.fetch).not.toHaveBeenCalled();
      expect(download).not.toHaveBeenCalled();
    });
  });

  it('returns null when the object genuinely cannot be read', async () => {
    download.mockResolvedValue({ data: null, error: { message: 'not found' } });

    const result = await downloadStoredFile(
      storedUrl(`${VEHICLE_ID}/consultant/missing.pdf`),
      VEHICLE_ID
    );

    expect(result).toBeNull();
  });

  it('gives a refused read and a failed read the same answer', async () => {
    // Both are null. A caller must not be able to tell "not yours" from "not
    // there" — the same argument as NOT_FOUND_MESSAGE in lib/api-auth.
    download.mockResolvedValue({ data: null, error: { message: 'not found' } });
    const missing = await downloadStoredFile(
      storedUrl(`${VEHICLE_ID}/consultant/missing.pdf`),
      VEHICLE_ID
    );
    const forbidden = await downloadStoredFile(
      storedUrl(`${OTHER_VEHICLE_ID}/consultant/real.pdf`),
      VEHICLE_ID
    );

    expect(forbidden).toEqual(missing);
  });
});
