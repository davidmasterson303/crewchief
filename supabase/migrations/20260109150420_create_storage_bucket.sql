/*
  # Create Storage Bucket for Vehicle Documents

  1. Storage Setup
    - Create public bucket named "vehicle-documents"
    - Enable public access for simple POC implementation
    - Add policies for upload and read operations

  2. Security
    - Public bucket allows direct access without signed URLs
    - RLS policies allow all operations (MVP permissive mode)
    - Ready for authentication restrictions in future

  Important Notes:
    - Public bucket simplifies POC development
    - No signed URLs needed for file access
    - Files are accessible via direct public URLs
*/

-- Create the storage bucket for vehicle documents
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'vehicle-documents',
  'vehicle-documents',
  true,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/jpg', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/jpg', 'image/webp', 'application/pdf'];

-- Create permissive storage policies for MVP (matching other tables)
-- Drop existing policies if they exist and recreate them
DROP POLICY IF EXISTS "Allow all uploads to vehicle-documents" ON storage.objects;
DROP POLICY IF EXISTS "Allow all downloads from vehicle-documents" ON storage.objects;
DROP POLICY IF EXISTS "Allow all deletes from vehicle-documents" ON storage.objects;
DROP POLICY IF EXISTS "Allow all updates to vehicle-documents" ON storage.objects;

-- Allow all uploads
CREATE POLICY "Allow all uploads to vehicle-documents"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'vehicle-documents');

-- Allow all downloads
CREATE POLICY "Allow all downloads from vehicle-documents"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'vehicle-documents');

-- Allow all deletes
CREATE POLICY "Allow all deletes from vehicle-documents"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'vehicle-documents');

-- Allow all updates
CREATE POLICY "Allow all updates to vehicle-documents"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'vehicle-documents')
  WITH CHECK (bucket_id = 'vehicle-documents');
