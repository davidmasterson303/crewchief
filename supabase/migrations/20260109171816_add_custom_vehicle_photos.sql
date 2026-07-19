/*
  # Add Custom Vehicle Photo Support

  1. New Columns
    - `custom_image_url` (text) - Stores user-uploaded vehicle photo URL
    - `custom_image_uploaded_at` (timestamptz) - Tracks when custom photo was uploaded
    - `custom_image_storage_path` (text) - Stores the storage path for cleanup

  2. Changes
    - Adds custom_image_url column to vehicles table for user-uploaded photos
    - Keeps existing image_url for stock/API-generated images
    - Custom photos take priority over stock images when displaying vehicles

  3. Security
    - No RLS changes needed (uses existing vehicle RLS)

  4. Important Notes
    - Custom photos are stored in Supabase Storage 'vehicle-documents' bucket
    - Users can upload, replace, or remove custom photos
    - Removing custom photo reverts to stock image display
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vehicles' AND column_name = 'custom_image_url'
  ) THEN
    ALTER TABLE vehicles ADD COLUMN custom_image_url text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vehicles' AND column_name = 'custom_image_uploaded_at'
  ) THEN
    ALTER TABLE vehicles ADD COLUMN custom_image_uploaded_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vehicles' AND column_name = 'custom_image_storage_path'
  ) THEN
    ALTER TABLE vehicles ADD COLUMN custom_image_storage_path text;
  END IF;
END $$;
