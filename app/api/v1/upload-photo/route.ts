import { NextRequest, NextResponse } from 'next/server';
import { uploadVehiclePhoto } from '@/app/actions';
import { logger } from '@crewchief/core/logger';
import { ALLOWED_IMAGE_TYPES } from '@crewchief/core/validation';
import { checkStoredPhotoSize } from '@crewchief/core/image-resize';
import type { ApiResponse } from '@crewchief/core/types';
import { checkRateLimit, getClientIdentifier, rateLimitResponse } from '@/lib/rate-limit';
import { authorizeVehicleAccess } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

/**
 * `POST /api/v1/upload-photo` — a vehicle photograph, from a bearer client.
 *
 * ── Why this route had to exist ─────────────────────────────────────────────
 *
 * `uploadVehiclePhoto` is a **server action**, which means a cookie session.
 * The phone has no cookie jar — it presents a bearer token — so until now there
 * was no way to add a vehicle photograph from the phone at all.
 *
 * That was not a missing button. David found it on 15 Aug looking at a garage
 * card with no photo and no way to fix it: **the identity plate is a finished
 * design for a car with no photograph, and it was the only state reachable.**
 * A plate you cannot replace is a dead end rather than a fallback.
 *
 * ── The shape is `upload-document`'s, deliberately ──────────────────────────
 *
 * A thin route that authorizes for the **HTTP status** and delegates to the
 * action. The action authorizes too, and that is not redundancy: a server
 * action is an independently reachable POST and always must. What this adds is
 * the status code, which the action cannot express — it returns
 * `{ success: false, error }` and a caller mapping that would fall through to
 * 500 for everything.
 *
 * ⚠ That matters more than it looks. `apps/mobile/src/api/client.ts` keys
 * sign-out off `status === 401`, so on a 500 it never fires: an expired session
 * would show "try again" forever, and trying again cannot help.
 */
export async function POST(request: NextRequest): Promise<Response> {
  logger.info('API:UPLOAD_PHOTO', 'Upload request received');

  const identifier = getClientIdentifier(request);
  const rateLimit = await checkRateLimit(identifier, 'upload');
  if (!rateLimit.allowed) {
    logger.warn('API:UPLOAD_PHOTO', 'Rate limit exceeded', { identifier });
    return rateLimitResponse(rateLimit);
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const vehicleId = formData.get('vehicleId') as string | null;

    if (!file || !vehicleId) {
      return NextResponse.json(
        { success: false, error: 'Missing file or vehicleId' } as ApiResponse,
        { status: 400 }
      );
    }

    /*
      Authorized before the file is inspected. Reading and validating a body on
      behalf of a caller who may not touch the vehicle is work done for someone
      with no claim to it — the same ordering `upload-document` sets out.
    */
    const access = await authorizeVehicleAccess(vehicleId, { intent: 'write' });
    if (!access.ok) {
      return access.response;
    }

    /*
      Images only, and a narrower list than the document upload's.

      An invoice may legitimately be a PDF; a vehicle photograph may not. The
      stored file is rendered in an `<img>` on web and an `Image` on the phone,
      so accepting anything those cannot decode stores a permanent broken hero.
    */
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      logger.warn('API:UPLOAD_PHOTO', 'Rejected file type', { vehicleId, type: file.type });
      return NextResponse.json(
        {
          success: false,
          error: 'That file type cannot be used as a photo. Choose a JPEG, PNG or WebP.',
        } as ApiResponse,
        { status: 400 }
      );
    }

    /*
      ⚠ The ceiling, and the reason it is returned rather than absorbed.

      `MAX_STORED_PHOTO_BYTES` exists because this account still holds a
      3000×4000 / 2.3 MB original that **has never once decoded on device** —
      the garage card's timeout exists solely to escape it. Storing another one
      would reintroduce that bug for the next car.

      The web path is protected by a browser-side downscale before upload. The
      phone has no canvas and no image manipulator in this build, so it reduces
      capture quality and cannot guarantee a dimension. Which makes this refusal
      **reachable in normal use on mobile in a way it is not on web** — so the
      reason travels back to the caller intact and is shown to the owner, rather
      than becoming a generic failure they cannot act on.
    */
    const sizeCheck = checkStoredPhotoSize(file.size);
    if (!sizeCheck.ok) {
      logger.warn('API:UPLOAD_PHOTO', 'Refused an oversized vehicle photo', {
        vehicleId,
        bytes: file.size,
      });
      return NextResponse.json(
        { success: false, error: sizeCheck.reason } as ApiResponse,
        { status: 400 }
      );
    }

    const result = await uploadVehiclePhoto(formData);

    if (!result.success) {
      logger.error('API:UPLOAD_PHOTO', new Error(result.error ?? 'Upload failed'));
      return NextResponse.json(
        { success: false, error: result.error ?? 'Failed to upload photo' } as ApiResponse,
        { status: 500 }
      );
    }

    logger.info('API:UPLOAD_PHOTO', 'Photo stored', { vehicleId });

    /*
      The signed URL comes back so the caller can show the photograph it just
      uploaded without refetching the garage. Best-effort in the action — the
      upload has already succeeded by then — so `null` here means "stored, ask
      again later", never "failed".
    */
    return NextResponse.json({
      success: true,
      photoUrl: result.photoUrl ?? null,
    } as ApiResponse);
  } catch (error) {
    logger.error('API:UPLOAD_PHOTO', error as Error);
    return NextResponse.json(
      { success: false, error: 'Failed to upload photo' } as ApiResponse,
      { status: 500 }
    );
  }
}
