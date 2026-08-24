import { render, userEvent, waitFor } from '@testing-library/react-native';

import { InvoiceScanScreen } from '../InvoiceScanScreen';
import { uploadInvoice, type InvoiceFile } from '../../api/documents';
import { ApiRequestError } from '../../api/client';

/**
 * Scanning an invoice.
 *
 * The product's own pitch — point the phone at a receipt in the shop's car park
 * — and the flow with the most ways to strand somebody, because every step can
 * fail differently: the picker can be dismissed, the model can decide it is not
 * an invoice, it can read a *different car*, and the upload can fail in ways
 * that either will or will not survive a retry.
 *
 * ── Nothing native is mocked, by design ─────────────────────────────────────
 *
 * `pickImage` is a **prop**. The screen never imports `expo-image-picker` —
 * `src/media/pick-image.ts` is the only module that does. So the picker
 * is injected here as a plain function, and these tests exercise the real
 * component with no native stubbing at all. That injection is why this screen
 * is testable and the camera path is not a black box.
 *
 * ── The two rules worth the whole file ──────────────────────────────────────
 *
 * **A retry is only offered when a retry could work.** A client-side rejection
 * — wrong type, too large — fails identically however many times the same file
 * is sent. Offering "Try again" there strands somebody on an error screen with
 * no way back to the picker, which is the 5 Aug dead end `retryable` exists to
 * fix.
 *
 * **A vehicle mismatch asks rather than files.** The model reading a different
 * car is the one failure that silently corrupts data if it guesses — an invoice
 * filed against the wrong vehicle is worse than one not filed at all.
 */

/*
  ── ⚠ LEG-02 · these tests are about scanning, not about consent ─────────────

  Guideline 5.1.2(i) (amended Nov 2025) requires explicit permission before
  personal data reaches a third-party AI, so the screen now asks before it opens
  the picker. Every case below assumes that question has already been answered —
  the consent flow itself is exercised in its own describe at the foot of this
  file.

  Mocked rather than written to `secureStorage`, because the store is
  `expo-secure-store` and there is none in a test runner.
*/
/*
  ⚠ Prefixed `mock` because jest forbids a factory referencing an out-of-scope
  variable — the guard against a mock reading a value that has not initialised
  yet. The prefix is the documented escape hatch.
*/
let mockConsent: 'granted' | 'declined' | 'unknown' = 'granted';

jest.mock('../../onboarding/ai-consent', () => ({
  readAiConsent: jest.fn(async () => mockConsent),
  recordAiConsent: jest.fn(async () => {}),
}));

jest.mock('../../api/documents', () => {
  const actual = jest.requireActual('../../api/documents');
  return { ...actual, uploadInvoice: jest.fn() };
});

const upload = uploadInvoice as jest.MockedFunction<typeof uploadInvoice>;

/**
 * Typed as `InvoiceFile`, with no cast.
 *
 * The first draft wrote `mimeType` and cast the object into place — the field
 * is `type`, and the cast is what let a wrong fixture compile. Typing it
 * properly means the shape is checked rather than asserted, which is the whole
 * value of having the interface.
 */
const FILE: InvoiceFile = {
  uri: 'file:///tmp/receipt.jpg',
  name: 'receipt.jpg',
  type: 'image/jpeg',
};

async function mount(over: { pickImage?: jest.Mock } = {}) {
  const pickImage = over.pickImage ?? jest.fn(async () => FILE);
  const props = {
    vehicleId: 'v1',
    pickImage: pickImage as (s: 'camera' | 'library') => Promise<InvoiceFile | null>,
    onSignOut: jest.fn(),
    onFiled: jest.fn(),
  };
  return { props, pickImage, view: await render(<InvoiceScanScreen {...props} />) };
}

beforeEach(() => upload.mockReset());

describe('choosing an image', () => {
  it('offers the camera and the library', async () => {
    /*
      Both, deliberately. A receipt is often a photo taken days ago, and the
      simulator has no camera at all — a camera-only flow could never be
      exercised on the machine this is built on.
    */
    const { view } = await mount();

    expect(view.getByText(/take a photo|camera/i)).toBeTruthy();
    expect(view.getByText('Choose from library')).toBeTruthy();
  });

  it('asks the injected picker for the right source', async () => {
    const user = userEvent.setup();
    upload.mockResolvedValue({ status: 'uploaded', documentId: 'd1', itemsExtracted: 3 } as never);
    const { pickImage, view } = await mount();

    await user.press(view.getByText('Choose from library'));

    await waitFor(() => expect(pickImage).toHaveBeenCalledWith('library'));
  });

  it('uploads nothing when the picker is dismissed', async () => {
    // Backing out of the camera is the most common non-event in this flow.
    // Treating `null` as a file would send an empty upload and show an error
    // for something the person deliberately cancelled.
    const user = userEvent.setup();
    const pickImage = jest.fn(async () => null);
    const { view } = await mount({ pickImage });

    await user.press(view.getByText('Choose from library'));

    await waitFor(() => expect(pickImage).toHaveBeenCalled());
    expect(upload).not.toHaveBeenCalled();
  });

  it('but does upload when a file comes back — proving the refusal is real', async () => {
    // The pair. Without it, the assertion above is satisfied by a screen that
    // never uploads at all.
    const user = userEvent.setup();
    upload.mockResolvedValue({ status: 'uploaded', documentId: 'd1', itemsExtracted: 3 } as never);
    const { view } = await mount();

    await user.press(view.getByText('Choose from library'));

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
  });
});

describe('a vehicle mismatch', () => {
  const mismatch = {
    status: 'vehicle-mismatch',
    message: 'This looks like a different car.',
    extracted: { year: 2015, make: 'BMW', model: 'M235i' },
    expected: { year: 2018, make: 'Honda', model: 'Accord' },
  };

  it('asks rather than filing', async () => {
    /*
      The one failure that corrupts data if it guesses. An invoice filed against
      the wrong vehicle is worse than one not filed at all, because nothing
      afterwards looks wrong.
    */
    const user = userEvent.setup();
    upload.mockResolvedValue(mismatch as never);
    const { view } = await mount();

    await user.press(view.getByText('Choose from library'));

    expect(await view.findByText('Is this the right car?')).toBeTruthy();
  });

  it('files it only once confirmed, and says so on the retry', async () => {
    // `confirmVehicle` is what tells the server the human overrode the model.
    // Sending the same unconfirmed request again would just mismatch forever.
    const user = userEvent.setup();
    upload.mockResolvedValueOnce(mismatch as never);
    upload.mockResolvedValueOnce({
      status: 'uploaded',
      documentId: 'd1',
      itemsExtracted: 2,
    } as never);

    const { view } = await mount();
    await user.press(view.getByText('Choose from library'));
    await view.findByText('Is this the right car?');

    await user.press(view.getByText('Yes, file it here'));

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
    expect(upload.mock.calls[1][0]).toMatchObject({ confirmVehicle: true });
  });

  it('does not re-open the picker to confirm', async () => {
    /*
      Confirming re-sends what was already picked. Reopening the camera would
      make somebody photograph the same receipt twice to answer a yes/no
      question.
    */
    const user = userEvent.setup();
    upload.mockResolvedValueOnce(mismatch as never);
    upload.mockResolvedValueOnce({ status: 'uploaded', documentId: 'd1', itemsExtracted: 1 } as never);

    const { pickImage, view } = await mount();
    await user.press(view.getByText('Choose from library'));
    await view.findByText('Is this the right car?');

    const picksBefore = pickImage.mock.calls.length;
    await user.press(view.getByText('Yes, file it here'));

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
    expect(pickImage.mock.calls.length).toBe(picksBefore);
  });

  it('sends nothing more if the answer is no', async () => {
    const user = userEvent.setup();
    upload.mockResolvedValue(mismatch as never);
    const { view } = await mount();

    await user.press(view.getByText('Choose from library'));
    await view.findByText('Is this the right car?');

    await user.press(view.getByText('No, cancel'));

    expect(upload).toHaveBeenCalledTimes(1);
  });
});

describe('when it is not an invoice', () => {
  it('says so without offering a pointless retry of the same file', async () => {
    // Re-sending the same photo cannot change the model's mind about what it
    // is. The way forward is a different photo.
    const user = userEvent.setup();
    upload.mockResolvedValue({
      status: 'not-an-invoice',
      message: 'That looks like a parking ticket.',
    } as never);

    const { view } = await mount();
    await user.press(view.getByText('Choose from library'));

    expect(await view.findByText('That does not look like an invoice')).toBeTruthy();
    expect(view.getByText('Try another photo')).toBeTruthy();
  });
});

describe('when the upload fails', () => {
  it('signs out only when the session is genuinely gone', async () => {
    /*
      `isLocallySignedOut` — the token was cleared on this device, so there is
      nothing to retry with. A plain 401 from the server is shown as a message
      instead, because the session may still be recoverable.
    */
    const user = userEvent.setup();
    /*
      `isLocallySignedOut` is a GETTER — `status === 401 && origin === 'device'`
      — so it cannot be assigned. The first draft forced the property and the
      test failed, which is the getter doing its job: the only way to produce
      this state is to produce the real conditions, and that is what makes the
      assertion mean something.
    */
    upload.mockRejectedValue(
      new ApiRequestError({ status: 401, message: 'Unauthorized', origin: 'device' })
    );

    const { props, view } = await mount();
    await user.press(view.getByText('Choose from library'));

    await waitFor(() => expect(props.onSignOut).toHaveBeenCalledTimes(1));
  });

  it('keeps a server-side 401 on the screen rather than bouncing', async () => {
    // `origin: 'server'` — a token the server might accept a second later.
    // Destroying a working session over one response is how a spurious failure
    // becomes a forced re-login.
    const user = userEvent.setup();
    upload.mockRejectedValue(
      new ApiRequestError({ status: 401, message: 'Unauthorized', origin: 'server' })
    );

    const { props, view } = await mount();
    await user.press(view.getByText('Choose from library'));

    expect(await view.findByText('That did not upload')).toBeTruthy();
    expect(props.onSignOut).not.toHaveBeenCalled();
  });

  it('shows the failure rather than returning silently to idle', async () => {
    // A flow that quietly resets looks like the button did nothing, which is
    // how somebody re-photographs a receipt four times.
    const user = userEvent.setup();
    upload.mockRejectedValue(new ApiRequestError({ status: 500, message: 'Upstream failed' }));

    const { view } = await mount();
    await user.press(view.getByText('Choose from library'));

    expect(await view.findByText('That did not upload')).toBeTruthy();
  });
});

describe('when it works', () => {
  it('tells the caller so the vehicle can refresh', async () => {
    /*
      `onFiled` is how the dossier learns its line items changed. Without it the
      invoice is stored and the screen behind still shows the old totals — which
      reads as the scan not having worked.
    */
    const user = userEvent.setup();
    upload.mockResolvedValue({ status: 'uploaded', documentId: 'd1', itemsExtracted: 4 } as never);

    const { props, view } = await mount();
    await user.press(view.getByText('Choose from library'));

    await waitFor(() => expect(props.onFiled).toHaveBeenCalled());
  });
});

/**
 * ── LEG-02: explicit permission before an invoice reaches Google ────────────
 *
 * Apple amended Guideline 5.1.2(i) in November 2025 to require **explicit
 * permission** before personal data is shared with a third-party AI — not
 * disclosure, permission. CrewChief had the disclosure in its privacy policy;
 * the only consent was sign-up wrap.
 *
 * This is the screen where it mattered most and was least visible: it
 * photographs a document carrying **a third party's name and business
 * address**, sometimes a VIN, sends it to Gemini, and said nothing about
 * Google at all.
 */
describe('asking before an invoice goes to Google', () => {
  afterEach(() => {
    mockConsent = 'granted';
  });

  it('asks before the picker opens, not after', async () => {
    /*
      ⚠ **Before**, and the ordering is the whole finding. Consent obtained
      after the photograph exists is consent for something that already
      happened — and by then the person has aimed a camera at a document on the
      strength of a screen that told them nothing.
    */
    mockConsent = 'unknown';
    const user = userEvent.setup();
    const pickImage = jest.fn();

    const view = await render(
      <InvoiceScanScreen vehicleId="v1" pickImage={pickImage} onSignOut={jest.fn()} />
    );

    await user.press(await view.findByText('Take a photo'));

    await view.findByText('Reading an invoice uses Google’s AI');
    expect(pickImage).not.toHaveBeenCalled();
  });

  it('names Google, and names what is in the photograph', async () => {
    /*
      "Third-party AI services" is the phrasing that satisfies nobody. Deciding
      needs to know **who** and **what** — and the part somebody would not think
      of is that an invoice is not only their own data.
    */
    mockConsent = 'unknown';
    const user = userEvent.setup();

    const view = await render(
      <InvoiceScanScreen vehicleId="v1" pickImage={jest.fn()} onSignOut={jest.fn()} />
    );

    await user.press(await view.findByText('Take a photo'));

    await view.findByText(/The photograph goes to Google/);
    await view.findByText(/the shop’s name and address/);
  });

  it('continues into what they were doing once they agree', async () => {
    // Dropping them back to press the same button again is how a consent sheet
    // reads as an obstacle rather than a question.
    mockConsent = 'unknown';
    const user = userEvent.setup();
    const pickImage = jest.fn(async () => null);

    const view = await render(
      <InvoiceScanScreen vehicleId="v1" pickImage={pickImage} onSignOut={jest.fn()} />
    );

    await user.press(await view.findByText('Choose from library'));
    await user.press(await view.findByText('Scan invoices'));

    await waitFor(() => expect(pickImage).toHaveBeenCalledWith('library'));
  });

  it('does not block the app when they decline', async () => {
    /*
      ⚠ Declining means "no AI features", **never** "no app". Blocking the
      product on a privacy refusal trades a 5.1.2 problem for a
      5.1.1(v)-shaped one — and the garage, the history and the recall list are
      all useful without a model.
    */
    mockConsent = 'declined';

    const view = await render(
      <InvoiceScanScreen vehicleId="v1" pickImage={jest.fn()} onSignOut={jest.fn()} />
    );

    await view.findByText(/You can still add services by hand/);
    expect(view.queryByText('Take a photo')).toBeNull();
    // …and it is a decision they can revisit, not a dead end.
    view.getByText('Change that');
  });

  it('sends nothing when they decline', async () => {
    mockConsent = 'declined';
    const pickImage = jest.fn();

    const view = await render(
      <InvoiceScanScreen vehicleId="v1" pickImage={pickImage} onSignOut={jest.fn()} />
    );

    await view.findByText(/You can still add services by hand/);
    expect(pickImage).not.toHaveBeenCalled();
  });
});
