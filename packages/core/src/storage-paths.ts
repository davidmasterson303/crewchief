/**
 * Storage paths for the `vehicle-documents` bucket.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * Four upload paths each invented their own convention:
 *
 *   uploadInvoice               {vehicleId}/{file}
 *   uploadVehiclePhoto          vehicle-photos/{vehicleId}/{file}
 *   uploadConsultantDocument    consultant-docs/{vehicleId}/{sessionId}/{file}
 *   uploadInvoiceForCompletion  invoices/{file}          <- no vehicle at all
 *
 * That broke three things simultaneously:
 *
 *   - The storage RLS policy keys on `(storage.foldername(name))[1]::uuid`.
 *     'vehicle-photos', 'consultant-docs' and 'invoices' cannot cast to a
 *     uuid, so the policy could not protect those objects at all.
 *   - Signed-URL minting derives the vehicle from the first path segment, so
 *     it only worked for the first convention.
 *   - Account deletion had to special-case each shape, and still cannot purge
 *     the fourth, because those objects carry no owner.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 *
 * **The first path segment is always a vehicle id.** Everything else is
 * organisation below that. This makes ownership derivable from the path
 * alone, which is what both the RLS policy and the deletion sweep rely on.
 *
 * Never build one of these paths by hand.
 */

/** Sub-folders under a vehicle. Values appear in stored paths — renaming one strands existing objects. */
export type StorageKind = 'invoices' | 'photos' | 'consultant';

/**
 * Filenames reach us from user uploads, so they can contain anything —
 * slashes would silently create folders and escape the vehicle prefix.
 */
function safeFileName(fileName: string): string {
  return fileName
    .replace(/[/\\]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .slice(-120); // keep the extension; drop any absurd prefix
}

/**
 * Build a storage path.
 *
 *   vehicleStoragePath('veh-1', 'invoices', 'Shop Receipt.pdf')
 *     -> 'veh-1/invoices/1769...-Shop_Receipt.pdf'
 *
 * `segments` inserts extra levels between the kind and the file — used by
 * consultant documents to group by session.
 */
export function vehicleStoragePath(
  vehicleId: string,
  kind: StorageKind,
  fileName: string,
  segments: string[] = []
): string {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const middle = segments.length > 0 ? `${segments.join('/')}/` : '';
  return `${vehicleId}/${kind}/${middle}${unique}-${safeFileName(fileName)}`;
}

/**
 * The vehicle a path belongs to, or null if it predates the convention.
 *
 * Used to authorize signed-URL requests and to sweep storage on account
 * deletion. Legacy objects under `vehicle-photos/`, `consultant-docs/` and
 * `invoices/` return null: their first segment is not a vehicle id, which is
 * exactly the problem this module fixes going forward.
 */
export function vehicleIdFromStoragePath(path: string): string | null {
  const [first] = path.split('/');
  if (!first) return null;

  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(first);

  return isUuid ? first : null;
}

/** Every prefix under which a vehicle's objects can live, newest convention first. */
export function vehicleStoragePrefixes(vehicleId: string): string[] {
  return [
    // Current convention — one prefix covers all kinds.
    vehicleId,
    // Legacy, retained so account deletion still reaches objects written
    // before the unification. Remove once no such objects remain.
    `vehicle-photos/${vehicleId}`,
    `consultant-docs/${vehicleId}`,
  ];
}
