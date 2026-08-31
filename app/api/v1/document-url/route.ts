import { logger } from '@wellkept/core/logger';
import { type NextRequest } from 'next/server';
import type { ApiResponse } from '@wellkept/core/types';
import { checkRateLimit, getClientIdentifier, rateLimitResponse } from '@/lib/rate-limit';
import { authorizeVehicleAccess } from '@/lib/api-auth';
import { vehicleIdFromStoragePath } from '@wellkept/core/storage-paths';

export const dynamic = 'force-dynamic';

/** An hour, matching the web action. Long enough to read a PDF, short enough to expire. */
const SIGNED_URL_TTL_SECONDS = 3600;

/**
 * A short-lived link to one stored invoice, for the phone.
 *
 * ── Why this route had to exist ─────────────────────────────────────────────
 *
 * David, 30 Aug: *"should be option to open actual pdf invoice as well, or at
 * least to download it."*
 *
 * The mobile app has said it could not do this twice, in writing, and both
 * times the note was correct: *"the document is a stored file behind a signed
 * URL and no route on this app mints one, so a 'view invoice' control could not
 * work"* (`53bcf0a`, repeated in `6560f1b`). The web has minted them since
 * March — but as a **server action**, which the phone cannot call: it
 * authenticates with a bearer token against `/api/v1/*`. This is that action's
 * authorization, reachable the way the phone reaches things.
 *
 * ── ⚠ Two ids arrive and both are checked, which is the whole point ─────────
 *
 * `SEC-01` was exactly this shape: `parseInvoiceLineItems` verified `vehicleId`
 * and then used `documentId` — the caller's other argument, never checked —
 * against the service role. An authenticated user passing their own vehicle and
 * a stranger's document deleted that stranger's line items and had their
 * `file_url` returned.
 *
 * So the document is fetched **scoped to the vehicle that was authorized**, and
 * the path's own vehicle prefix is checked against it a second time. The second
 * check is not redundant: a row could carry a path written before the prefix
 * convention, and minting a URL for it would leak a file the row's own id says
 * belongs here.
 *
 * ── ⚠ Demo vehicles get nothing, and that is deliberate ────────────────────
 *
 * `vehicle_documents` is scoped to owners with no demo arm — `20260801140000`,
 * a decision rather than an omission, because the demo's rows are
 * `demo-placeholder.local` paths pointing at no file. `load-maintenance-data`
 * makes the same call and reports them **omitted rather than empty**.
 *
 * ── ⛔ This is a new route, so it needs a promote to exist ──────────────────
 *
 * `web-live` has been frozen since 23 Aug. Until it moves, the phone calls this
 * path and gets a 404 from a deployment that has never heard of it — §8's "a
 * 404 on a path that works perfectly on `main`". The client says so in as many
 * words rather than showing a generic failure; see `invoiceUrl` in
 * `apps/mobile/src/api/documents.ts`.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const identifier = getClientIdentifier(request);
  const rateLimit = await checkRateLimit(identifier, 'default');
  if (!rateLimit.allowed) {
    logger.warn('API:DOCUMENT_URL', 'Rate limit exceeded', { identifier });
    return rateLimitResponse(rateLimit);
  }

  try {
    const vehicleId = request.nextUrl.searchParams.get('vehicleId');
    const documentId = request.nextUrl.searchParams.get('documentId');

    if (!vehicleId || !documentId) {
      return Response.json(
        { success: false, error: 'Missing vehicleId or documentId' } as ApiResponse,
        { status: 400 }
      );
    }

    const access = await authorizeVehicleAccess(vehicleId, { intent: 'read' });
    if (!access.ok) {
      return access.response;
    }

    if (access.isDemo) {
      /*
        The demo's documents are placeholder paths pointing at no file. A 404 is
        the honest answer — there is nothing to open — and it is the same answer
        a real caller gets for a document that is not theirs, so this does not
        become an oracle for which vehicles are demos.
      */
      return Response.json({ success: false, error: 'Document not found' } as ApiResponse, {
        status: 404,
      });
    }

    const { data: document, error } = await access.client
      .from('vehicle_documents')
      .select('file_url')
      /* Both ids, and the vehicle is the one that was authorized. SEC-01. */
      .eq('id', documentId)
      .eq('vehicle_id', vehicleId)
      .maybeSingle();

    if (error) {
      logger.warn('API:DOCUMENT_URL', 'Document lookup failed', { vehicleId, error });
      return Response.json({ success: false, error: 'Could not open that invoice' } as ApiResponse, {
        status: 500,
      });
    }

    const filePath = document?.file_url;
    if (!filePath) {
      return Response.json({ success: false, error: 'Document not found' } as ApiResponse, {
        status: 404,
      });
    }

    /*
      ⚠ The second check. The row said this document belongs to this vehicle;
      the path has to agree. A row whose path carries a different vehicle's
      prefix is a row that would mint a link to somebody else's file, and the
      row's own foreign key cannot see that.
    */
    const pathVehicleId = vehicleIdFromStoragePath(filePath);
    if (pathVehicleId !== vehicleId) {
      logger.warn('API:DOCUMENT_URL', 'Path does not match the authorized vehicle', {
        vehicleId,
        pathVehicleId,
      });
      return Response.json({ success: false, error: 'Document not found' } as ApiResponse, {
        status: 404,
      });
    }

    const { data, error: signError } = await access.client.storage
      .from('vehicle-documents')
      .createSignedUrl(filePath, SIGNED_URL_TTL_SECONDS);

    if (signError || !data?.signedUrl) {
      logger.warn('API:DOCUMENT_URL', 'Signing failed', { vehicleId, error: signError });
      return Response.json({ success: false, error: 'Could not open that invoice' } as ApiResponse, {
        status: 500,
      });
    }

    return Response.json({ success: true, url: data.signedUrl, expiresInSeconds: SIGNED_URL_TTL_SECONDS });
  } catch (error) {
    logger.error('API:DOCUMENT_URL', error as Error);
    return Response.json({ success: false, error: 'Could not open that invoice' } as ApiResponse, {
      status: 500,
    });
  }
}
