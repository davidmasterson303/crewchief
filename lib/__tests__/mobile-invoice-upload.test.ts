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

/**
 * `XMLHttpRequest`, because **multipart no longer goes over `fetch`**.
 *
 * The global `fetch` in the app is Expo's, and its multipart encoder needs a
 * real `Blob` — which React Native's `Blob` cannot produce here, since it
 * implements no `arrayBuffer()` and `FileReaderModule` is not compiled into the
 * installed binary. So `apiRequest` sends forms through React Native's own
 * networking, which understands the `{ uri, name, type }` part and streams the
 * file from disk.
 *
 * This fake stands in for that transport and records what was sent.
 */
class FakeXHR {
  static last: FakeXHR | null = null;
  /** Queued reply for the next request. */
  static next: { status: number; body: unknown } = { status: 200, body: {} };

  method = '';
  url = '';
  headers: Record<string, string> = {};
  body: FormData | null = null;
  timeout = 0;
  status = 0;
  responseText = '';

  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;

  constructor() {
    FakeXHR.last = this;
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(key: string, value: string) {
    this.headers[key] = value;
  }

  send(body: FormData) {
    this.body = body;
    this.status = FakeXHR.next.status;
    this.responseText = JSON.stringify(FakeXHR.next.body);
    this.onload?.();
  }
}

(global as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = FakeXHR;

/**
 * React Native's `FormData`, not the browser's.
 *
 * Node's built-in `FormData` follows the web spec, where a value may only be a
 * string or a `Blob` — so appending `{ uri, name, type }` **stringifies it to
 * "[object Object]"**, and a test using it would assert against a shape the app
 * never produces.
 *
 * React Native's implementation keeps whatever it is given and hands it to its
 * networking layer through `getParts()`, which is the entire mechanism the
 * upload depends on. Expo patches that class rather than replacing it, so this
 * is what runs on the device.
 */
class RNFormData {
  private parts: [string, unknown][] = [];

  append(name: string, value: unknown) {
    this.parts.push([name, value]);
  }

  get(name: string): unknown {
    const found = this.parts.find(([key]) => key === name);
    return found ? found[1] : null;
  }

  getParts() {
    return this.parts;
  }
}

(global as unknown as { FormData: unknown }).FormData = RNFormData;

/** Queue the transport's reply, whichever transport the call ends up using. */
function reply(status: number, body: unknown) {
  FakeXHR.next = { status, body };
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

/** What the upload actually sent, for assertions. */
function sent(): FakeXHR {
  if (!FakeXHR.last) throw new Error('No request was sent');
  return FakeXHR.last;
}

const FILE = { uri: 'file:///tmp/invoice.jpg', name: 'invoice.jpg', type: 'image/jpeg' };
const VEHICLE = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  jest.clearAllMocks();
  FakeXHR.last = null;
  FakeXHR.next = { status: 200, body: {} };
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
    void (reply(200, { success: false, error: 'SOMETHING_NEW' }));

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
    void (reply(200, { success: true, documentId: 'doc-2' }));

    const result = await uploadInvoice({ vehicleId: VEHICLE, file: FILE });
    expect(result).toEqual({ status: 'uploaded', documentId: 'doc-2', itemsExtracted: 0 });
  });
});

describe('uploadInvoice — what is sent', () => {
  it('sends multipart without a hand-written Content-Type', async () => {
    reply(200, { success: true, documentId: 'd', itemsExtracted: 0 });

    await uploadInvoice({ vehicleId: VEHICLE, file: FILE });

    expect(sent().url).toBe('https://example.test/api/v1/upload-document');
    expect(sent().method).toBe('POST');

    /*
      A hand-set multipart Content-Type omits the boundary the runtime
      generates, leaving a body the server cannot parse. React Native writes
      the header itself, so this must never appear.
    */
    expect(sent().headers['Content-Type']).toBeUndefined();
    expect(sent().headers['content-type']).toBeUndefined();
    expect(sent().body).toBeInstanceOf(RNFormData);
  });

  it('still sends the bearer token', async () => {
    reply(200, { success: true, documentId: 'd', itemsExtracted: 0 });

    await uploadInvoice({ vehicleId: VEHICLE, file: FILE });

    expect(sent().headers.Authorization).toBe('Bearer a-token');
  });

  it('omits the confirmation flag unless it was given', async () => {
    reply(200, { success: true, documentId: 'd', itemsExtracted: 0 });

    await uploadInvoice({ vehicleId: VEHICLE, file: FILE });
    expect(sent().body?.get('bypassVehicleCheck')).toBeNull();

    await uploadInvoice({ vehicleId: VEHICLE, file: FILE, confirmVehicle: true });
    expect(sent().body?.get('bypassVehicleCheck')).toBe('true');
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
    void (reply(200, { success: true, documentId: 'd', itemsExtracted: 1 }));

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

describe('the three failures that shared one sentence', () => {
  /*
    "Could not reach Well Kept. Check your connection." covered genuinely
    offline, a request abandoned by us, and a server that never answered —
    three different fixes behind one line. It cost three rounds of testing and
    sent a tester to check their Wi-Fi while a serverless function was merely
    cold.
  */
  it('says "too long" for a timeout, not "check your connection"', () => {
    const timedOut = new ApiRequestError({
      status: 0,
      message: 'Well Kept did not answer within 45 seconds.',
      origin: 'device',
      kind: 'timeout',
      elapsedMs: 45_000,
    });

    expect(describeUploadError(timedOut)).toMatch(/too long/i);
    expect(describeUploadError(timedOut)).not.toMatch(/connection/i);
    // The photo is still on the phone, and saying so is the difference
    // between a retry and a reshoot.
    expect(describeUploadError(timedOut)).toMatch(/not lost/i);
  });

  it('keeps "check your connection" for a genuine offline failure', () => {
    const offline = new ApiRequestError({
      status: 0,
      message: 'Could not reach Well Kept. Check your connection.',
      origin: 'device',
      kind: 'offline',
      elapsedMs: 120,
    });

    expect(describeUploadError(offline)).toMatch(/connection/i);
  });

  it('carries elapsed time and cause in the diagnostic', () => {
    // The number that was missing every time: an instant failure and a
    // failure at a platform ceiling are the same sentence without it.
    const error = new ApiRequestError({
      status: 0,
      message: 'x',
      origin: 'device',
      kind: 'timeout',
      elapsedMs: 10_042,
      cause: 'Network request failed',
    });

    expect(error.diagnostic).toContain('10042ms');
    expect(error.diagnostic).toContain('timeout');
    expect(error.diagnostic).toContain('Network request failed');
  });

  it('records elapsed time on HTTP failures too', () => {
    // A 502 at ten seconds is a platform ceiling; a 502 at fifty milliseconds
    // is a bad deploy. The status alone cannot tell them apart.
    const gatewayError = new ApiRequestError({ status: 502, message: 'Bad gateway', elapsedMs: 10_003 });
    expect(gatewayError.diagnostic).toContain('10003ms');
    expect(gatewayError.kind).toBe('http');
  });
});

describe('the FormData part the runtime will actually accept', () => {
  /*
    Every upload died in 4–6ms with `Unsupported FormDataPart implementation`,
    before a socket opened, and was reported as a connectivity problem for
    three rounds. Expo replaces the global `fetch`, and its multipart encoder
    accepts only a string, a real Blob, or something implementing `bytes()` —
    never React Native's `{ uri, name, type }` convention.
  */
  it("appends React Native's { uri, name, type } part", async () => {
    reply(200, { success: true, documentId: 'd', itemsExtracted: 0 });

    await uploadInvoice({ vehicleId: VEHICLE, file: FILE });

    const part = sent().body?.get('file') as unknown as {
      uri?: string;
      name?: string;
      type?: string;
    };

    /*
      The shape RN's networking streams from disk. A `Blob` here is the version
      that cannot work on this binary at all — RN's Blob exposes no
      `arrayBuffer()` and `FileReaderModule` is not compiled in.
    */
    expect(part.uri).toBe('file:///tmp/invoice.jpg');
  });

  it('keeps the filename, because the server builds a storage path from it', async () => {
    // The server calls vehicleStoragePath(..., file.name). A nameless part
    // uploads and is then stored under a broken path.
    reply(200, { success: true, documentId: 'd', itemsExtracted: 0 });

    await uploadInvoice({ vehicleId: VEHICLE, file: FILE });

    const part = sent().body?.get('file') as unknown as { name?: string; type?: string };
    expect(part.name).toBe('invoice.jpg');
    expect(part.type).toBe('image/jpeg');
  });
});

describe('a failure before the socket opens is not "offline"', () => {
  it('blames neither the network nor the photo', () => {
    // David's point after the FormData defect: a 4ms throw is a bug in this
    // app. Reporting it as connectivity is what hid it for three rounds.
    const unsendable = new ApiRequestError({
      status: 0,
      message: 'Well Kept could not send that request.',
      origin: 'device',
      kind: 'request',
      elapsedMs: 4,
      cause: 'Unsupported FormDataPart implementation',
    });

    const shown = describeUploadError(unsendable);
    expect(shown).not.toMatch(/connection|wi-?fi|offline/i);
    expect(shown).toMatch(/bug on our side/i);
    expect(unsendable.diagnostic).toContain('4ms');
  });
});
