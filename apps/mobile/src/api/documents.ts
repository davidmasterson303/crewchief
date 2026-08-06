import { apiRequest, ApiRequestError } from './client';
import { MAX_FILE_SIZE, ALLOWED_DOCUMENT_TYPES } from '@crewchief/core/validation';

/**
 * Invoice upload — Phase 3.3's half that needs no camera.
 *
 * ── Why this exists before the screen does ──────────────────────────────────
 *
 * 3.3 is "camera, upload, the error taxonomy". Only the first of those needs a
 * native module, and a native module costs one of fifteen cloud builds a month.
 * The upload and the taxonomy are ordinary code, fully testable under Node
 * today, and they are the part with the actual complexity — so they are built
 * and covered first, and picking an image is the small piece that lands once
 * the build is spent.
 *
 * Staged with no caller for a few hours on 5 Aug and flagged as such at the
 * time; `InvoiceScanScreen` closed that gap the same day.
 *
 * ── The failure that a normal error path cannot see ─────────────────────────
 *
 * **Two rejections come back as HTTP 200 with `success: false`.**
 * `VEHICLE_MISMATCH` (the extracted invoice looks like a different car) and
 * `NOT_AUTOMOTIVE_INVOICE` (the photograph is not an invoice) are answers, not
 * failures — the model ran and reached a conclusion — so the route returns them
 * without an error status, deliberately.
 *
 * `apiRequest` throws on `!response.ok`, so it will not throw for either. A
 * caller written the obvious way — `await upload(); // it worked` — treats both
 * as success and tells someone their invoice was filed when it was refused.
 * That is why this module returns a **discriminated result** for the outcomes
 * the server reached, and reserves exceptions for the ones it did not: no
 * network, no session, rate limited, storage broken.
 *
 * ── Why the size and type checks happen here too ────────────────────────────
 *
 * The server checks both and is the authority. This checks first because the
 * subject is a photograph taken seconds ago on a phone, possibly on a cellular
 * connection: uploading eight megabytes in order to be told it is over the
 * limit spends someone's data and a minute of their time to learn something
 * knowable before the first byte leaves. The limits are imported from
 * `@crewchief/core/validation` rather than restated, so the two cannot drift.
 */

/** What the caller hands over — the shape React Native's FormData accepts. */
export interface InvoiceFile {
  /** `file://…` from the picker or camera. */
  uri: string;
  name: string;
  /** Must be one of `ALLOWED_DOCUMENT_TYPES`. */
  type: string;
  /**
   * Bytes, when the picker reported it. Optional because not every source
   * knows — and an unknown size is not a reason to refuse, only a reason to
   * let the server be the one to say no.
   */
  size?: number;
}

/** A vehicle as the extractor read it off the invoice, for the mismatch prompt. */
export interface ExtractedVehicle {
  year?: number | null;
  make?: string | null;
  model?: string | null;
}

export type InvoiceUploadResult =
  /** Filed. `itemsExtracted` is how many line items came off it. */
  | { status: 'uploaded'; documentId: string | null; itemsExtracted: number }
  /**
   * The invoice appears to be for a different car. **Not an error** — the
   * owner is the one who knows, and `confirmVehicle` re-sends the same file
   * with the heuristic overridden.
   */
  | {
      status: 'vehicle-mismatch';
      message: string;
      extracted: ExtractedVehicle | null;
      expected: ExtractedVehicle | null;
    }
  /** The photograph is not an automotive invoice. Also an answer, not a fault. */
  | { status: 'not-an-invoice'; message: string };

export interface UploadInvoiceParams {
  vehicleId: string;
  file: InvoiceFile;
  /**
   * Re-send after a `vehicle-mismatch`, with the owner's confirmation.
   *
   * Overrides an **AI heuristic only**. It does not bypass authorization and
   * cannot: `uploadInvoice` authorizes the vehicle before this flag is read,
   * and since `b70832b` the route does too. The action's own comment says the
   * same, because the name invites the opposite reading.
   */
  confirmVehicle?: boolean;
}

/** Client-side refusals, thrown before anything is uploaded. */
export class InvoiceFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvoiceFileError';
  }
}

const megabytes = (bytes: number) => Math.round(bytes / 1024 / 1024);

/**
 * Turn a `file://` URI into something the runtime's `fetch` will actually send.
 *
 * ── The defect this replaces ────────────────────────────────────────────────
 *
 * This appended `{ uri, name, type }` — **React Native's** file-part
 * convention — and every upload died in 4–6ms with
 * `Unsupported FormDataPart implementation`, before a socket ever opened. Three
 * rounds of testing read that as a connectivity problem, because the client
 * reported it as one.
 *
 * The cause is that Expo replaces the global `fetch`, and its own multipart
 * encoder accepts **only** a string, a real `Blob`, or an object implementing
 * `bytes()`. Its source says so directly:
 *
 *     `uri` is not supported for React Native's FormData.
 *
 * So the two conventions are both real and mutually exclusive, and this app
 * had the wrong one. It is also why `components/DocumentUploadDialog.tsx`
 * posts to the same endpoint from the web without trouble: a browser hands
 * `fetch` a `File` already.
 *
 * ── Why a `File` and not a bare `Blob` ──────────────────────────────────────
 *
 * The filename has to survive. Expo's encoder writes `filename=` into the
 * content-disposition header only when the part has a `name`, and the server
 * builds its storage path from `file.name` — `vehicleStoragePath(vehicleId,
 * 'invoices', file.name)`. A nameless part would upload and then be stored
 * under a broken path. React Native's `File` extends `Blob` and exposes
 * `name`, so it satisfies both the `instanceof Blob` branch and the header.
 *
 * ── Why this needs no new native module ─────────────────────────────────────
 *
 * `Blob`, `File` and `XMLHttpRequest` are React Native globals, and
 * `BlobModule` is already compiled into the installed binary — verified by
 * reading it out of the app's dylib before writing this, because a module the
 * binary lacks crashes on launch. `expo-file-system` would have been the
 * tidier read and is **not** installed; using it would have cost a cloud build.
 */
async function readAsUploadPart(file: InvoiceFile): Promise<File> {
  const blob = await readBlob(file.uri);

  /*
    `file.type` rather than `blob.type`: the picker knows what it produced, and
    a blob read from a cache URI can come back with an empty type. An empty
    content-type is what makes the server's allowlist reject a perfectly good
    JPEG.
  */
  return new File([blob], file.name, { type: file.type });
}

/**
 * Read a local URI into a `Blob`.
 *
 * `XMLHttpRequest` rather than `fetch`, deliberately: the global `fetch` here
 * is Expo's, and it is not required to understand `file://`. XHR is React
 * Native's own and does, which is the whole reason this path exists.
 */
function readBlob(uri: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.responseType = 'blob';
    request.onload = () => resolve(request.response as Blob);
    request.onerror = () =>
      // A file the picker just handed us and we cannot read is a device
      // problem, not a network one — and must not be reported as "offline".
      reject(new InvoiceFileError('That image could not be read from your device.'));
    request.open('GET', uri, true);
    request.send(null);
  });
}

export async function uploadInvoice({
  vehicleId,
  file,
  confirmVehicle = false,
}: UploadInvoiceParams): Promise<InvoiceUploadResult> {
  if (!ALLOWED_DOCUMENT_TYPES.includes(file.type)) {
    /*
      Named rather than listed: the server's comma-separated MIME list is
      wording for a developer, and this is read by someone who just took a
      photograph.


      No PDF in this sentence. The server accepts them; the picker is
      `mediaTypes: ['images']` and cannot select one, so naming a PDF sends
      someone looking for a control that does not exist. Same defect as the
      scan screen's blurb, which lost the same claim — it survived here because
      the string lives in a different file.
    */
    throw new InvoiceFileError('That file type cannot be read. Choose a photo.');
  }

  if (typeof file.size === 'number' && file.size > MAX_FILE_SIZE) {
    throw new InvoiceFileError(
      `That file is too large — the limit is ${megabytes(MAX_FILE_SIZE)} MB.`
    );
  }

  const form = new FormData();
  form.append('file', await readAsUploadPart(file));
  form.append('vehicleId', vehicleId);
  if (confirmVehicle) {
    // Sent only when true. The route reads `=== 'true'`, so a literal "false"
    // is equivalent to absence — but sending it would imply a decision nobody
    // made.
    form.append('bypassVehicleCheck', 'true');
  }

  const body = await apiRequest<{
    success?: unknown;
    error?: unknown;
    message?: unknown;
    documentId?: unknown;
    itemsExtracted?: unknown;
    extractedVehicle?: unknown;
    expectedVehicle?: unknown;
  }>('/upload-document', {
    method: 'POST',
    body: form,
    /*
      **Reduced from 45s.** That number was chosen to leave room for a
      serverless ceiling that turned out not to exist — every failure was a
      4ms client-side throw. Kept as a budget rather than reverted to the 20s
      default, because an upload legitimately outlasts a read: a comparable
      multipart-plus-vision call measured **7.7s warm**, this endpoint adds a
      storage write and a document row, and a cold function added ~6s when
      measured separately. 30s covers that with margin and still fails before
      anyone concludes the app has hung.
    */
    timeoutMs: 30_000,
  });

  /*
    The 200-with-`success: false` branch. Checked before the success branch
    because both carry HTTP 200 and only this field separates them.
  */
  if (body.success === false) {
    if (body.error === 'VEHICLE_MISMATCH') {
      return {
        status: 'vehicle-mismatch',
        message:
          typeof body.message === 'string'
            ? body.message
            : 'This invoice looks like it is for a different vehicle.',
        extracted: asVehicle(body.extractedVehicle),
        expected: asVehicle(body.expectedVehicle),
      };
    }

    if (body.error === 'NOT_AUTOMOTIVE_INVOICE') {
      return {
        status: 'not-an-invoice',
        message:
          typeof body.message === 'string'
            ? body.message
            : 'That does not look like a vehicle invoice.',
      };
    }

    /*
      A 200 with `success: false` and an error this build does not recognise.
      Raised rather than returned: the taxonomy above is the set of outcomes
      this screen knows how to offer a next step for, and silently treating an
      unknown one as success is the exact bug this module is shaped to avoid.
    */
    throw new ApiRequestError({
      status: 200,
      message: typeof body.error === 'string' ? body.error : 'The invoice could not be read.',
    });
  }

  return {
    status: 'uploaded',
    documentId: typeof body.documentId === 'string' ? body.documentId : null,
    // Zero is a real answer — an invoice whose lines could not be itemised is
    // still filed, and the screen says so rather than claiming a number.
    itemsExtracted: typeof body.itemsExtracted === 'number' ? body.itemsExtracted : 0,
  };
}

function asVehicle(value: unknown): ExtractedVehicle | null {
  if (!value || typeof value !== 'object') return null;
  const { year, make, model } = value as Record<string, unknown>;
  return {
    year: typeof year === 'number' ? year : null,
    make: typeof make === 'string' ? make : null,
    model: typeof model === 'string' ? model : null,
  };
}

/**
 * How a failed upload should read to the person who just took the photograph.
 *
 * Kept beside the taxonomy rather than in the screen, so the wording is
 * reviewable next to the statuses it describes and a second screen cannot
 * invent a different vocabulary for the same failure.
 */
export function describeUploadError(error: unknown): string {
  if (error instanceof InvoiceFileError) return error.message;

  if (error instanceof ApiRequestError) {
    /*
      Reported before the status checks, because the three failures that share
      status 0 are the ones that have cost the most time. Each names a
      different fix: nothing was sent, or nothing came back.
    */
    if (error.kind === 'timeout') {
      return 'CrewChief took too long to read that invoice. Your photo was not lost — try again.';
    }

    if (error.kind === 'offline') {
      return 'Could not reach CrewChief. Check your connection.';
    }

    /*
      Ours, not theirs. The request could not be built, so nothing about the
      person's network or their photo is at fault and neither should be
      blamed. The `__DEV__` diagnostic beside this carries the detail.
    */
    if (error.kind === 'request') {
      return 'CrewChief could not send that invoice. This is a bug on our side, not a problem with your photo.';
    }

    if (error.status === 401) {
      /*
        The two 401s are different problems and now say so. Until 5 Aug both
        read "Your session ended", so an upload that never left the phone was
        indistinguishable from one the server refused — which is precisely the
        question that mattered when uploads began 401ing while every read on the
        same session kept working.

        The wording still avoids blaming the person. "This device" and "the
        server" are the two places the answer can be, and naming which one is
        what makes the next report useful rather than ambiguous.
      */
      return error.isLocallySignedOut
        ? 'This device is signed out. Sign in again to upload this.'
        : 'CrewChief would not accept this upload on your current session.';
    }
    if (error.status === 404) return 'That vehicle is no longer in your garage.';
    if (error.status === 413) return 'That file is too large to upload.';
    if (error.status === 429) return 'Too many uploads just now. Try again in a minute.';
    if (error.status === 503) return 'Storage is unavailable right now. Your photo was not lost.';
    // 0 is no connectivity, and `apiRequest` already words that one for a
    // phone. Everything else carries the server's own message, which those
    // routes write to be shown.
    return error.message;
  }

  return 'Something went wrong uploading that invoice.';
}
