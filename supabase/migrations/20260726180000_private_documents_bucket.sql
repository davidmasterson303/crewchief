/*
  # Make vehicle-documents private, and fix policies that never worked

  ## The problem

  `vehicle-documents` is `public = true`. A public Supabase bucket serves
  objects through `/object/public/…`, a path that **never evaluates RLS**. So
  the correctly-scoped read policy added in June 2026 has been dead code:
  every uploaded invoice — names, addresses, VINs, shop names, amounts — is
  readable by anyone holding or guessing a URL.

  ## Why the existing policies could not have worked either

  They key on `(storage.foldername(name))[1]::uuid`, which assumes the first
  path segment is a vehicle id. Four upload paths each used a different
  convention, so for three of them the first segment was `vehicle-photos`,
  `consultant-docs` or `invoices` — values that cannot cast to a uuid. Those
  objects were unprotected by policy *and* would have become unreachable by
  their owners the moment the bucket went private.

  The application now writes everything as `{vehicleId}/{kind}/…`
  (lib/storage-paths.ts), so the first segment is reliably a vehicle id.
  **That code change must ship before this migration**, or new uploads land
  under paths these policies reject.

  ## Ordering

    1. purge orphans, while a permissive delete path still exists
    2. rewrite policies
    3. flip the bucket private

  Flipping first would leave nothing able to clean up the orphans.
*/

-- ============================================================
-- 1. Purge orphaned objects
-- ============================================================

/*
  54 objects, ~22MB, none referenced by any row in any table.

  Cause: when Gemini parsing failed, uploadInvoice deleted the
  vehicle_documents row but never the uploaded file. A rejected parse is a
  normal outcome — not an automotive invoice, wrong vehicle, unreadable scan
  — so this leaked on the common path rather than an edge case. Fixed in
  application code alongside this migration.

  Deleting only what nothing points at. Anything referenced by
  vehicle_documents is preserved, which today is nothing real: all 5 rows
  hold demo-placeholder URLs that never resolved.

  Demo vehicles have zero objects in this bucket, so the public demo cannot
  be affected.
*/
DELETE FROM storage.objects
WHERE bucket_id = 'vehicle-documents'
  AND name NOT IN (
    SELECT replace(file_url, 'placeholder://', '')
    FROM vehicle_documents
    WHERE file_url LIKE 'placeholder://%'
  );

-- ============================================================
-- 2. Policies keyed on the unified path
-- ============================================================

DROP POLICY IF EXISTS "Authenticated users can read their own vehicle documents" ON storage.objects;
DROP POLICY IF EXISTS "Allow all uploads to vehicle-documents" ON storage.objects;
DROP POLICY IF EXISTS "Allow all downloads from vehicle-documents" ON storage.objects;
DROP POLICY IF EXISTS "Allow all deletes from vehicle-documents" ON storage.objects;
DROP POLICY IF EXISTS "Allow all updates to vehicle-documents" ON storage.objects;

/*
  The upload/update/delete policies carried no TO clause, so they applied to
  every role including anon — anyone could upload, overwrite or delete any
  object in the bucket. Each is now scoped to authenticated owners.

  `foldername(name)` is used rather than split_part so behaviour matches the
  original policy. The regex guard prevents a cast error on any legacy path
  that survives the purge above.
*/

CREATE POLICY "Owners read their vehicle documents"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'vehicle-documents'
    AND (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
    AND ((storage.foldername(name))[1])::uuid IN (
      SELECT id FROM public.vehicles WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Owners upload to their vehicle folder"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'vehicle-documents'
    AND (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
    AND ((storage.foldername(name))[1])::uuid IN (
      SELECT id FROM public.vehicles WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Owners update their vehicle documents"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'vehicle-documents'
    AND (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
    AND ((storage.foldername(name))[1])::uuid IN (
      SELECT id FROM public.vehicles WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Owners delete their vehicle documents"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'vehicle-documents'
    AND (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
    AND ((storage.foldername(name))[1])::uuid IN (
      SELECT id FROM public.vehicles WHERE user_id = auth.uid()
    )
  );

-- ============================================================
-- 3. Private
-- ============================================================

/*
  With this set, `/object/public/…` stops resolving and every read must go
  through a signed URL. The app mints those in getSignedInvoiceUrl, which
  proves vehicle ownership *before* signing — a signed URL bypasses RLS for
  its lifetime, so the check cannot be left to the policy afterwards.

  Server-side work is unaffected: the service-role client bypasses both.
*/
UPDATE storage.buckets
SET public = false
WHERE id = 'vehicle-documents';

/*
  ## Verifying

    -- expect public = false
    SELECT id, public FROM storage.buckets WHERE id = 'vehicle-documents';

    -- expect 0; every surviving object sits under a vehicle-id prefix
    SELECT count(*) FROM storage.objects
    WHERE bucket_id = 'vehicle-documents'
      AND (storage.foldername(name))[1] !~ '^[0-9a-f-]{36}$';

    -- how many objects remain
    SELECT count(*) FROM storage.objects WHERE bucket_id = 'vehicle-documents';

  Then from the repo: `node scripts/verify-demo.mjs` — the demo has no objects
  in this bucket, so it must be completely unaffected. Any change there means
  something in this migration was wrong.

  `garage-images` is deliberately left public: two background images, no
  personal data, referenced by no code.
*/
