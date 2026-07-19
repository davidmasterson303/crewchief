/*
  # Add shop_name field to service_items

  1. Changes
    - Add `shop_name` column to `service_items` table to store repair shop details
    - Nullable column with no default for flexibility
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'service_items' AND column_name = 'shop_name'
  ) THEN
    ALTER TABLE service_items ADD COLUMN shop_name text;
  END IF;
END $$;