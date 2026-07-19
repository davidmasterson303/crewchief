/*
  # Add Vehicle Image URL Storage

  1. New Columns
    - `image_url` (text) - Stores the processed/retrieved vehicle image URL
    - `processed_image_at` (timestamptz) - Tracks when the image was processed

  2. Changes
    - Adds image_url column to vehicles table for storing cached vehicle images
    - Prevents re-generating images on every load

  3. Security
    - No RLS changes needed (uses existing vehicle RLS)
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vehicles' AND column_name = 'image_url'
  ) THEN
    ALTER TABLE vehicles ADD COLUMN image_url text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vehicles' AND column_name = 'processed_image_at'
  ) THEN
    ALTER TABLE vehicles ADD COLUMN processed_image_at timestamptz;
  END IF;
END $$;
