import { apiRequest } from './client';
import type { InvoiceFile } from './documents';
import { ALLOWED_IMAGE_TYPES } from '@crewchief/core/validation';
import { MAX_STORED_PHOTO_BYTES } from '@crewchief/core/image-resize';

/**
 * Adding a photograph of the car, from the phone.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * `uploadVehiclePhoto` is a Next server action on the cookie session, so the
 * phone could never reach it. Until 15 Aug there was no way to add a vehicle
 * photograph from the app at all — which made the identity plate the only
 * reachable state, and a plate you cannot replace is a dead end rather than a
 * fallback. `POST /api/v1/upload-photo` is the bearer route built for it.
 *
 * ── The two checks that happen here rather than at the server ───────────────
 *
 * Both are also enforced server-side and neither is trusted from here — they
 * exist so the common refusals cost nothing. A phone on cellular should not
 * spend a megabyte discovering that the file was a megabyte too big.
 */

/** Thrown before anything leaves the phone. Carries a sentence for the screen. */
export class VehiclePhotoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VehiclePhotoError';
  }
}

const megabytes = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1);

export async function uploadVehiclePhoto(
  vehicleId: string,
  file: InvoiceFile,
): Promise<{ photoUrl: string | null }> {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    throw new VehiclePhotoError('That file type cannot be used as a photo. Choose a picture.');
  }

  /*
    ⚠ Reachable in ordinary use, unlike its web counterpart.

    The browser downscales before upload; the phone can only reduce encoder
    quality, because `expo-image-manipulator` is not in this build. So a large
    capture genuinely can land over the ceiling, and the message has to be one
    an owner can act on rather than a generic failure.

    `size` is optional on purpose — absent means unknown, and an unknown size is
    not evidence of harm. The server decides in that case.
  */
  if (typeof file.size === 'number' && file.size > MAX_STORED_PHOTO_BYTES) {
    throw new VehiclePhotoError(
      `That photo is ${megabytes(file.size)} MB and the limit is ${megabytes(
        MAX_STORED_PHOTO_BYTES,
      )} MB. Try one taken at a lower resolution.`,
    );
  }

  const form = new FormData();
  /*
    React Native's file-part convention — `apiRequest` sends multipart over XHR
    precisely so this shape is the right one. The cast is because the DOM lib
    types `append` against `Blob | string`; RN reads exactly these three keys
    and streams the file from `uri`.
  */
  form.append('file', { uri: file.uri, name: file.name, type: file.type } as unknown as Blob);
  form.append('vehicleId', vehicleId);

  const body = await apiRequest<{ success?: unknown; error?: unknown; photoUrl?: unknown }>(
    '/upload-photo',
    {
      method: 'POST',
      body: form,
      /*
        30s, matching the invoice upload. An upload legitimately outlasts a
        read — this one adds a storage write and a row update — and a cold
        function has measured ~6s on its own. Long enough to succeed, short
        enough that nobody concludes the app has hung.
      */
      timeoutMs: 30_000,
    },
  );

  /*
    The 200-with-`success: false` branch. The route returns a real status for
    every failure it owns, so this is the belt to that braces — and the server's
    own sentence is preferred over anything invented here, because the one
    refusal an owner will actually meet is the size ceiling and its message
    already names the number.
  */
  if (body.success === false) {
    throw new VehiclePhotoError(
      typeof body.error === 'string' ? body.error : 'That photo could not be saved.',
    );
  }

  return { photoUrl: typeof body.photoUrl === 'string' ? body.photoUrl : null };
}
