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
import { storagePathFromStoredUrl } from '@crewchief/core/storage-paths';
import { logger } from '@crewchief/core/logger';

export const DOCUMENTS_BUCKET = 'vehicle-documents';

/**
 * The bytes behind a stored file URL, or null if they could not be read.
 *
 * **This authorizes nothing.** It uses the service-role client, which bypasses
 * RLS entirely, so callers must have proved vehicle access before reaching
 * here — every current caller does, via `authorizeVehicleAccess`.
 *
 * A value that is not a stored path still goes over the network. That covers
 * demo assets and any legacy row written before the convention; those rows
 * point at URLs that no longer resolve, so the fetch fails and the caller
 * handles null exactly as it would any other unreadable attachment.
 */
export async function downloadStoredFile(fileUrl: string): Promise<Buffer | null> {
  const filePath = storagePathFromStoredUrl(fileUrl);

  if (!filePath) {
    try {
      const response = await fetch(fileUrl);
      if (!response.ok) return null;
      return Buffer.from(await response.arrayBuffer());
    } catch {
      return null;
    }
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
