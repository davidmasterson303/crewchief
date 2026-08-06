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
  /*
    The `{ uri, name, type }` shape is React Native's file part; the cast is
    because the DOM lib types `append` against `Blob | string` and there is no
    Blob here. The runtime reads exactly these three keys.
  */
  form.append('file', { uri: file.uri, name: file.name, type: file.type } as unknown as Blob);
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
      Longer than a read, and chosen from a measurement rather than a guess: a
      comparable multipart-plus-vision call on this infrastructure answered in
      **7.7s warm** (the anonymous front-door check, 5 Aug). This endpoint does
      strictly more — a storage write and a document row on top of the same
      vision pass — so 45s leaves room for a cold function without leaving
      someone watching a spinner indefinitely.

      If uploads fail at a consistent number well under this, the ceiling is
      the platform's and not ours, and the answer is a job plus a poll rather
      than a larger number here.
    */
    timeoutMs: 45_000,
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
