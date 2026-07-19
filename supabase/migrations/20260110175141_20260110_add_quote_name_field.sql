/*
  # Add quote name field to quote_requests table

  1. Changes
    - Add optional `name` column to `quote_requests` table
    - Store user-provided custom names or auto-generated default names
    - Add index for efficient queries

  2. New Columns
    - `name` (text, nullable) - Custom or auto-generated quote name
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'quote_requests' AND column_name = 'name'
  ) THEN
    ALTER TABLE quote_requests ADD COLUMN name text;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_quote_requests_name ON quote_requests(name);