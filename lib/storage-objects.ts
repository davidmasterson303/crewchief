/**
 * Reading `vehicle-documents` objects on the server.
 *
 * Two server paths need an attachment's *bytes* rather than a URL: the
 * consultant sends them to Gemini as inline data, and the invoice processor
 * parses them. Both used to do `fetch(doc.file_url)`, which worked only for as
 * long as that column held a public URL.
 *
 * It never should have: the bucket is private (migration 20260726180000), so
 * an HTTP fetch of one of its objects cannot succeed regardless of what is
 * stored. The column now holds a storage path (see `storedUrl` in
 * `@crewchief/core/storage-paths`), and the bytes come out of the Storage API
 * directly — no URL, no signing, no round trip through the public internet to
 * reach a file this process can already read.
 */

import { getServiceRoleClient } from '@/lib/supabase';
import {
  storagePathFromStoredUrl,
  vehicleIdFromStoragePath,
} from '@crewchief/core/storage-paths';
import { logger } from '@crewchief/core/logger';

export const DOCUMENTS_BUCKET = 'vehicle-documents';

/**
 * The bytes behind a stored file URL, or null if they could not be read.
 *
 * **`vehicleId` is the vehicle the caller proved access to, and it is
 * required.** This function reads with the service role, which bypasses RLS
 * completely, so the path it is handed must be checked against the
 * authorization the caller actually holds — not merely against the fact that
 * they hold one.
 *
 * ── What this used to do ────────────────────────────────────────────────────
 *
 * It took a `fileUrl` and nothing else. Both callers are exported server
 * actions, which Next.js compiles into public POST endpoints, and both
 * authorize a `vehicleId` and then pass a *separate*, caller-supplied file
 * path straight through. Two consequences, both live:
 *
 *   1. **Any object in the bucket, under anyone's vehicle.** A caller who owns
 *      one vehicle could attach `placeholder://{someone-elses-vehicle}/…` and
 *      have the consultant read a stranger's invoice out to them. The service
 *      role does not care whose object it is; nothing else was asking.
 *   2. **Any URL at all.** A value that was not a stored path fell through to
 *      `fetch(fileUrl)` — an arbitrary server-side request with the response
 *      body handed to a model that then describes it back. That is a
 *      server-side request forgery with a built-in exfiltration channel, and
 *      it reached internal addresses this process can resolve and the caller
 *      cannot.
 *
 * `resolveVehiclePhoto` has carried the correct version of check 1 since Phase
 * 2.9 — "ownership was proven for `vehicleId`, not for whatever this column
 * happens to point at". This is the same rule, in the one other place a
 * caller-supplied storage path meets a privileged client.
 *
 * The arbitrary-fetch branch is gone rather than guarded. It existed for demo
 * assets and legacy rows, and its own comment conceded those "point at URLs
 * that no longer resolve" — so it could not succeed for the reason it was
 * kept, while succeeding fine for reasons nobody wanted.
 */
export async function downloadStoredFile(
  fileUrl: string,
  vehicleId: string
): Promise<Buffer | null> {
  const filePath = storagePathFromStoredUrl(fileUrl);

  if (!filePath) {
    // Not one of ours. Previously fetched over the network; now refused. A
    // caller cannot tell this from an unreadable object, which is correct —
    // both mean "no bytes", and neither should confirm what does exist.
    logger.warn('STORAGE:NOT_A_STORED_PATH', 'Refusing to read a non-stored value', {
      vehicleId,
    });
    return null;
  }

  if (vehicleIdFromStoragePath(filePath) !== vehicleId) {
    logger.warn('STORAGE:CROSS_VEHICLE_READ', 'Refusing a path outside the authorized vehicle', {
      vehicleId,
      filePath,
    });
    return null;
  }

  const { data, error } = await getServiceRoleClient()
    .storage.from(DOCUMENTS_BUCKET)
    .download(filePath);

  if (error || !data) {
    logger.warn('STORAGE:DOWNLOAD_FAILED', 'Could not read stored object', {
      filePath,
      error: error?.message,
    });
    return null;
  }

  return Buffer.from(await data.arrayBuffer());
}
