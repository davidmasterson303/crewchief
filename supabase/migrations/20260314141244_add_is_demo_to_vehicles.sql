/*
  # Add is_demo flag to vehicles

  1. Changes
    - Adds `is_demo` boolean column to `vehicles` table (default false)
    - This flag marks vehicles as part of the shared demo dataset
    - Demo vehicles are read-only and protected from deletion

  2. Notes
    - All existing vehicles default to is_demo = false
    - Demo vehicles are seeded with a fixed demo_user_id
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vehicles' AND column_name = 'is_demo'
  ) THEN
    ALTER TABLE vehicles ADD COLUMN is_demo boolean NOT NULL DEFAULT false;
  END IF;
END $$;
