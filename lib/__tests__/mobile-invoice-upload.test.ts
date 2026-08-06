/**
 * The invoice upload, and the two refusals that arrive as success.
 *
 * @jest-environment node
 *
 * Phase 3.3's testable half. The camera needs a native module and therefore a
 * cloud build; the upload and the error taxonomy are ordinary code, and they
 * are where the complexity actually is.
 *
 * **The property worth the most here**: `VEHICLE_MISMATCH` and
 * `NOT_AUTOMOTIVE_INVOICE` come back as **HTTP 200 with `success: false`**.
 * They are conclusions rather than faults — the model ran and decided — so the
 * route returns them without an error status, on purpose. `apiRequest` only
 * throws on `!response.ok`, so neither throws, and a caller written the obvious
 * way would tell someone their invoice was filed when it was refused.
 *
 * Same placement argument as `mobile-api-client.test.ts`: with `../config` and
 * `../auth/session` mocked, no React Native reaches this module, so it runs in
 * the web suite instead of waiting on a runner that does not exist.
 */

/* Module, not a global script — see the note in `mobile-session.test.ts`. */
export {};

jest.mock(
  '../../apps/mobile/src/config',
  () => ({ API_BASE_URL: 'https://example.test', API_PREFIX: '/api/v1' }),
  { virtual: true }
);

const getAccessToken = jest.fn<Promise<string | null>, []>();
jest.mock(
  '../../apps/mobile/src/auth/session',
  () => ({ getAccessToken: () => getAccessToken() }),
  { virtual: true }
);

/* eslint-disable @typescript-eslint/no-var-requires */
const {
  uploadInvoice,
  describeUploadError,
  InvoiceFileError,
} = require('../../apps/mobile/src/api/documents');
const { ApiRequestError } = require('../../apps/mobile/src/api/client');
/* eslint-enable @typescript-eslint/no-var-requires */

const fetchMock = jest.fn();
global.fetch = fetchMock as unknown as typeof fetch;

function reply(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

const FILE = { uri: 'file:///tmp/invoice.jpg', name: 'invoice.jpg', type: 'image/jpeg' };
const VEHICLE = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  jest.clearAllMocks();
  getAccessToken.mockResolvedValue('a-token');
});

describe('uploadInvoice — the 200-with-success-false refusals', () => {
  it('reports a vehicle mismatch as its own outcome, not as success', async () => {
    fetchMock.mockResolvedValue(
      reply(200, {
        success: false,
        error: 'VEHICLE_MISMATCH',
        message: 'This looks like a 2015 BMW M235i.',
        extractedVehicle: { year: 2015, make: 'BMW', model: 'M235i' },
        expectedVehicle: { year: 2018, make: 'Honda', model: 'Accord' },
      })
    );

    const result = await uploadInvoice({ vehicleId: VEHICLE, file: FILE });

    // The whole point: HTTP said 200 and this must not read as filed.
    expect(result.status).toBe('vehicle-mismatch');
    expect(result.extracted).toEqual({ year: 2015, make: 'BMW', model: 'M235i' });
    expect(result.expected).toEqual({ year: 2018, make: 'Honda', model: 'Accord' });
  });

  it('reports a non-invoice photograph as its own outcome', async () => {
    fetchMock.mockResolvedValue(
      reply(200, {
        success: false,
        error: 'NOT_AUTOMOTIVE_INVOICE',
        message: 'That looks like a restaurant receipt.',
      })
    );

    const result = await uploadInvoice({ vehicleId: VEHICLE, file: FILE });

    expect(result.status).toBe('not-an-invoice');
    expect(result.message).toBe('That looks like a restaurant receipt.');
  });

  it('raises rather than guesses when success is false for an unknown reason', async () => {
    // A server that has shipped a third refusal to a client that predates it.
    // Treating it as filed is the exact defect this module is shaped around.
    fetchMock.mockResolvedValue(reply(200, { success: false, error: 'SOMETHING_NEW' }));

    await expect(uploadInvoice({ vehicleId: VEHICLE, file: FILE })).rejects.toThrow(
      'SOMETHING_NEW'
    );
  });
});

describe('uploadInvoice — success', () => {
  it('returns the document and its line-item count', async () => {
    fetchMock.mockResolvedValue(
      reply(200, { success: true, documentId: 'doc-1', itemsExtracted: 4 })
    );

    await expect(uploadInvoice({ vehicleId: VEHICLE, file: FILE })).resolves.toEqual({
      status: 'uploaded',
      documentId: 'doc-1',
      itemsExtracted: 4,
    });
  });

  it('treats zero extracted items as filed, because it is', async () => {
    // An invoice whose lines could not be itemised is still stored. Reporting
    // it as a failure would lose a document the server kept.
    fetchMock.mockResolvedValue(reply(200, { success: true, documentId: 'doc-2' }));

    const result = await uploadInvoice({ vehicleId: VEHICLE, file: FILE });
    expect(result).toEqual({ status: 'uploaded', documentId: 'doc-2', itemsExtracted: 0 });
  });
});

describe('uploadInvoice — what is sent', () => {
  it('sends multipart without a hand-written Content-Type', async () => {
    fetchMock.mockResolvedValue(reply(200, { success: true, documentId: 'd', itemsExtracted: 0 }));

    await uploadInvoice({ vehicleId: VEHICLE, file: FILE });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://example.test/api/v1/upload-document');
    expect(init.method).toBe('POST');

    /*
      Two failures this pins at once. A hand-set multipart Content-Type omits
      the boundary the runtime generates and the server cannot parse the body;
      and `JSON.stringify(formData)` is `"{}"`, which uploads nothing while
      looking entirely successful.
    */
    expect(init.headers['Content-Type']).toBeUndefined();
    expect(init.body).toBeInstanceOf(FormData);
    expect(typeof init.body).not.toBe('string');
  });

  it('still sends the bearer token', async () => {
    fetchMock.mockResolvedValue(reply(200, { success: true, documentId: 'd', itemsExtracted: 0 }));

    await uploadInvoice({ vehicleId: VEHICLE, file: FILE });

    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer a-token');
  });

  it('omits the confirmation flag unless it was given', async () => {
    fetchMock.mockResolvedValue(reply(200, { success: true, documentId: 'd', itemsExtracted: 0 }));

    await uploadInvoice({ vehicleId: VEHICLE, file: FILE });
    expect(fetchMock.mock.calls[0][1].body.get('bypassVehicleCheck')).toBeNull();

    fetchMock.mockClear();
    await uploadInvoice({ vehicleId: VEHICLE, file: FILE, confirmVehicle: true });
    expect(fetchMock.mock.calls[0][1].body.get('bypassVehicleCheck')).toBe('true');
  });
});

describe('uploadInvoice — refused before anything is uploaded', () => {
  it('refuses a file type the server would reject anyway', async () => {
    await expect(
      uploadInvoice({ vehicleId: VEHICLE, file: { ...FILE, type: 'video/mp4' } })
    ).rejects.toBeInstanceOf(InvoiceFileError);

    // The point of checking here is that the bytes never leave the phone.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses an oversized file without spending the upload', async () => {
    await expect(
      uploadInvoice({ vehicleId: VEHICLE, file: { ...FILE, size: 11 * 1024 * 1024 } })
    ).rejects.toThrow(/too large/i);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lets an unknown size through, because unknown is not oversized', async () => {
    // Not every picker reports a size. Refusing on absence would block a valid
    // upload to avoid a check the server performs anyway.
    fetchMock.mockResolvedValue(reply(200, { success: true, documentId: 'd', itemsExtracted: 1 }));

    await expect(uploadInvoice({ vehicleId: VEHICLE, file: FILE })).resolves.toMatchObject({
      status: 'uploaded',
    });
  });
});

describe('describeUploadError', () => {
  /*
    The two 401s say different things, and that difference is the whole reason
    the 5 Aug upload failure took a second round trip to diagnose. Both read
    "Your session ended", so an upload the phone refused to send was
    indistinguishable from one the server rejected — while every read on the
    same session kept working.
  */
  it('tells a genuinely signed-out device to sign in', () => {
    const local = new ApiRequestError({
      status: 401,
      message: 'Not signed in',
      origin: 'device',
    });

    expect(local.isLocallySignedOut).toBe(true);
    expect(describeUploadError(local)).toMatch(/sign in again/i);
  });

  it('does not claim the session ended when the server rejected it', () => {
    // Default origin is 'server'. Saying "your session ended" here is a claim
    // this client cannot support — and was false in the real report, where
    // every other screen stayed authenticated.
    const remote = new ApiRequestError({ status: 401, message: 'Unauthorized' });

    expect(remote.isLocallySignedOut).toBe(false);
    expect(describeUploadError(remote)).not.toMatch(/session ended/i);
    expect(describeUploadError(remote)).toMatch(/would not accept/i);
  });

  it('names no PDF anywhere, because the picker cannot select one', () => {
    // The claim was removed from the scan screen and survived in this string,
    // which is its own small lesson about copy living in two files.
    const messages = [
      describeUploadError(new ApiRequestError({ status: 401, message: 'x', origin: 'device' })),
      describeUploadError(new ApiRequestError({ status: 500, message: 'x' })),
      describeUploadError(new InvoiceFileError('That file type cannot be read. Choose a photo.')),
    ];

    for (const message of messages) expect(message).not.toMatch(/pdf/i);
  });

  it('says a rate limit is temporary rather than broken', () => {
    expect(describeUploadError(new ApiRequestError({ status: 429, message: 'Slow down' })))
      .toMatch(/try again/i);
  });

  it('reassures that a storage outage did not eat the photo', () => {
    // 503 is the bucket being unconfigured. The photograph is still on the
    // phone, and saying so is the difference between a retry and a reshoot.
    expect(describeUploadError(new ApiRequestError({ status: 503, message: 'Storage' })))
      .toMatch(/not lost/i);
  });

  it("passes through the server's own wording when it wrote one", () => {
    expect(
      describeUploadError(new ApiRequestError({ status: 500, message: 'Failed to save document' }))
    ).toBe('Failed to save document');
  });

  it('does not leak a raw object at someone who photographed a bill', () => {
    expect(describeUploadError({ weird: true })).toBe(
      'Something went wrong uploading that invoice.'
    );
  });
});
