-- Replace the broad public SELECT policy on vehicle-documents storage bucket
-- with one scoped to authenticated users who own the vehicle referenced in the path

DROP POLICY IF EXISTS "Allow all downloads from vehicle-documents" ON storage.objects;

CREATE POLICY "Authenticated users can read their own vehicle documents"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'vehicle-documents'
    AND (storage.foldername(name))[1]::uuid IN (
      SELECT id FROM public.vehicles WHERE user_id = auth.uid()
    )
  );
