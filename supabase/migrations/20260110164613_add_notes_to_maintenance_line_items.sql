/*
  # Add notes field to maintenance_line_items

  1. New Columns
    - `notes` (text, optional) - Store work notes and details from completion

  2. Purpose
    - Allow users to capture work notes when marking items as completed
    - Store these notes in the maintenance history for reference
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'maintenance_line_items' AND column_name = 'notes'
  ) THEN
    ALTER TABLE maintenance_line_items ADD COLUMN notes text;
  END IF;
END $$;
