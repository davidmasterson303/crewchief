import { apiRequest, ApiRequestError } from './client';
import { MAX_FILE_SIZE, ALLOWED_DOCUMENT_TYPES } from '@wellkept/core/validation';

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
 * `@wellkept/core/validation` rather than restated, so the two cannot drift.
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
    React Native's file-part convention, which is what its own networking
    understands — and `apiRequest` now sends multipart over XHR precisely so
    this shape is the right one. See the note there for why the `Blob` route is
    closed on this binary.

    The cast is because the DOM lib types `append` against `Blob | string`.
    RN reads exactly these three keys and streams the file from `uri`.
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
 * A technical line for **any** thrown value, for `__DEV__` builds.
 *
 * ── Why this is not `instanceof ApiRequestError` and nothing else ───────────
 *
 * Because that is exactly how the instrumentation went blind. The error screen
 * rendered a diagnostic only for `ApiRequestError`, so the one branch that
 * reached the generic "Something went wrong" — an error of some *other* type —
 * was also the one branch with no detail. A tester hit it 2/2 and had nothing
 * to report but a duration.
 *
 * The rule now: every failure says what it was, without exception. An error
 * this code did not anticipate is precisely the one worth naming.
 */
export function diagnoseUploadError(error: unknown): string {
  if (error instanceof ApiRequestError) return error.diagnostic;

  if (error instanceof InvoiceFileError) return `file-rejected · ${error.message}`;

  if (error instanceof Error) {
    /*
      Name *and* message. The name is what distinguishes a TypeError thrown
      while building a request from an Error thrown by a module that refused
      one, and it is the half usually dropped.
    */
    const where = error.stack?.split('\n')[1]?.trim();
    return [`${error.name} · ${error.message}`, where].filter(Boolean).join(' · ');
  }

  // Something threw a non-Error. Rare, and unreadable without saying so.
  return `non-error thrown · ${String(error)}`;
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
      return 'Well Kept took too long to read that invoice. Your photo was not lost — try again.';
    }

    if (error.kind === 'offline') {
      return 'Could not reach Well Kept. Check your connection.';
    }

    /*
      Ours, not theirs. The request could not be built, so nothing about the
      person's network or their photo is at fault and neither should be
      blamed. The `__DEV__` diagnostic beside this carries the detail.
    */
    if (error.kind === 'request') {
      return 'Well Kept could not send that invoice. This is a bug on our side, not a problem with your photo.';
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
        : 'Well Kept would not accept this upload on your current session.';
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

  /*
    The generic fallback still exists, but it is no longer a dead end: the
    `__DEV__` diagnostic beside it now names the thrown type either way.
  */
  return 'Something went wrong uploading that invoice.';
}

/**
 * A short-lived link to the stored invoice behind one scanned visit.
 *
 * ── ⚠ Two notes in this app said this could not be done ────────────────────
 *
 * *"The document is a stored file behind a signed URL and no route on this app
 * mints one, so a 'view invoice' control could not work"* — `53bcf0a`, and
 * again in `6560f1b`. Both were true when written. `/api/v1/document-url` is
 * the route they were missing, and its authorization is the web action's,
 * reachable by bearer token.
 *
 * ── ⛔ It 404s until `web-live` is promoted, and the copy says which ────────
 *
 * The route is new and the deployed API has been frozen since 23 Aug, so on a
 * phone talking to `crewchief.davidmasterson.co` today this returns a 404 from
 * a deployment that has never heard of the path — §8's "a 404 on a path that
 * works perfectly on `main`", which is named there as the most confusing shape
 * a bug can take.
 *
 * So a 404 is not reported as "invoice missing". It is reported as what it
 * almost certainly is, in words somebody can act on. The distinction costs one
 * branch and saves the next person half an hour of looking for a file that is
 * sitting exactly where it should be.
 */
export async function invoiceUrl(
  vehicleId: string,
  documentId: string
): Promise<{ url: string } | { error: string }> {
  try {
    const body = await apiRequest<{ success?: boolean; url?: string }>(
      `/document-url?vehicleId=${encodeURIComponent(vehicleId)}&documentId=${encodeURIComponent(
        documentId
      )}`
    );

    if (body?.url) return { url: body.url };
    return { error: 'That invoice could not be opened.' };
  } catch (error) {
    const apiError = error as ApiRequestError;

    if (apiError.status === 404) {
      return {
        error:
          'Opening the original invoice needs a newer version of the Well Kept API than this app is talking to.',
      };
    }

    /*
      ⚠ Not `describeUploadError`. Its copy is written for the upload flow and
      reassures somebody about a photograph they have just taken — *"took too
      long to read that invoice. Your photo was not lost"* — which is a
      confident description of work that is not happening. Nothing is being
      uploaded here and nothing is being read; a stored file is being fetched.
    */
    if (apiError.kind === 'offline') {
      return { error: 'Could not reach Well Kept. Check your connection.' };
    }

    if (apiError.kind === 'timeout') {
      return { error: 'That took too long. The invoice is still here — try again.' };
    }

    return { error: 'That invoice could not be opened.' };
  }
}
