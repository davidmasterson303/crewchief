/*
  # Add part_number to invoice_line_items

  1. Changes
    - Add `part_number` column to `invoice_line_items` table to store part numbers extracted from invoices
    
  2. Notes
    - Part numbers may not always be present on invoices, so this field is nullable
    - This allows better tracking of specific parts used in maintenance
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoice_line_items' AND column_name = 'part_number'
  ) THEN
    ALTER TABLE invoice_line_items ADD COLUMN part_number text;
  END IF;
END $$;