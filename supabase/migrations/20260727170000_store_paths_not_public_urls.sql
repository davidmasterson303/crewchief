/*
  # Replace unresolvable public URLs with storage paths

  ## The problem

  Migration 20260726180000 made `vehicle-documents` private. A private bucket
  does not serve `/object/public/…` at all — that path returns

    400 {"statusCode":"404","error":"Bucket not found"}

  Three upload sites kept calling `.getPublicUrl()` and persisting the result:
  `uploadInvoice` (vehicle_documents.file_url), `uploadVehiclePhoto`
  (vehicles.custom_image_url) and `uploadConsultantDocument`
  (consultant_documents.file_url). Every URL any of them wrote is dead, and was
  dead the moment it was written.

  Confirmed on vehicle db143cdc-e68c-46f0-849e-69f7a1873f58 (2015 BMW M235i):
  its `custom_image_url` is a getPublicUrl result and returns 400. That is the
  broken hero image — the photograph itself is intact in storage, only the
  pointer to it is wrong.

  ## What replaces them

  Not a signed URL. Those expire after an hour, so persisting one moves the
  breakage rather than fixing it. The **path** is stored, and a signed URL is
  minted per read:

    placeholder://{vehicleId}/{kind}/{file}

  See `storedUrl` in `packages/core/src/storage-paths.ts`. The application
  change ships with this migration; neither half is any use alone.

  ## Recovering the path

  For photos, `vehicles.custom_image_storage_path` already holds it — that
  column has been written correctly all along and is what the delete-and-
  replace path reads. It is preferred wherever present.

  Everywhere else the path is the tail of the dead URL, after
  `/object/public/vehicle-documents/`. No object is moved, renamed or deleted:
  this only rewrites pointers, and every one of them points where it always
  should have.

  ## Rows this cannot fix

  A URL with no derivable path, and no storage path beside it, is left alone.
  There is nothing to rewrite it to, and guessing would produce a pointer that
  fails at sign time instead of at fetch time — the same breakage, later and
  less legibly.
*/

-- ============================================================
-- vehicles.custom_image_url
-- ============================================================

/*
  The storage path column first: it is authoritative. Only rows that are not
  already converted are touched, so this is safe to re-run.
*/
UPDATE vehicles
SET custom_image_url = 'placeholder://' || custom_image_storage_path
WHERE custom_image_storage_path IS NOT NULL
  AND custom_image_url IS NOT NULL
  AND custom_image_url NOT LIKE 'placeholder://%';

/*
  Then any row whose path column was never populated, deriving it from the URL
  and backfilling both. Postgres evaluates every SET expression against the row
  as it was before the statement, so the second assignment still sees the old
  URL rather than the value the first one just wrote.
*/
UPDATE vehicles
SET custom_image_url = 'placeholder://' || split_part(custom_image_url, '/object/public/vehicle-documents/', 2),
    custom_image_storage_path = split_part(custom_image_url, '/object/public/vehicle-documents/', 2)
WHERE custom_image_url LIKE '%/object/public/vehicle-documents/%';

-- ============================================================
-- Document tables
-- ============================================================

UPDATE vehicle_documents
SET file_url = 'placeholder://' || split_part(file_url, '/object/public/vehicle-documents/', 2)
WHERE file_url LIKE '%/object/public/vehicle-documents/%';

UPDATE consultant_documents
SET file_url = 'placeholder://' || split_part(file_url, '/object/public/vehicle-documents/', 2)
WHERE file_url LIKE '%/object/public/vehicle-documents/%';

/*
  `maintenance_line_items.invoice_url` is copied from `vehicle_documents.file_url`
  by parseInvoiceLineItems, so it inherited the same dead URLs.
*/
UPDATE maintenance_line_items
SET invoice_url = 'placeholder://' || split_part(invoice_url, '/object/public/vehicle-documents/', 2)
WHERE invoice_url LIKE '%/object/public/vehicle-documents/%';

/*
  ## Verifying

    -- expect 0 across all four: no public URL survives anywhere
    SELECT
      (SELECT count(*) FROM vehicles WHERE custom_image_url LIKE '%/object/public/%'),
      (SELECT count(*) FROM vehicle_documents WHERE file_url LIKE '%/object/public/%'),
      (SELECT count(*) FROM consultant_documents WHERE file_url LIKE '%/object/public/%'),
      (SELECT count(*) FROM maintenance_line_items WHERE invoice_url LIKE '%/object/public/%');

    -- expect 0: every converted photo points at an object that exists
    SELECT count(*) FROM vehicles v
    WHERE v.custom_image_url LIKE 'placeholder://%'
      AND NOT EXISTS (
        SELECT 1 FROM storage.objects o
        WHERE o.bucket_id = 'vehicle-documents'
          AND o.name = replace(v.custom_image_url, 'placeholder://', '')
      );

    -- the reported vehicle, specifically
    SELECT custom_image_url, custom_image_storage_path FROM vehicles
    WHERE id = 'db143cdc-e68c-46f0-849e-69f7a1873f58';

  The demo has no objects in this bucket and no custom photos, so
  `node scripts/verify-demo.mjs` must be completely unaffected. Any change
  there means something here was wrong.
*/
