/*
  # Add Focal Point Fields to Vehicles

  ## Summary
  Adds two new columns to the `vehicles` table to store the user-defined focal point
  for their custom vehicle photo. This enables smart cropping in the dashboard hero
  banner and garage cards so the car stays centered in the frame.

  ## New Columns
  - `focal_point_x` (float, nullable) — Horizontal focal point as a percentage (0–100). Defaults to 50 (center).
  - `focal_point_y` (float, nullable) — Vertical focal point as a percentage (0–100). Defaults to 50 (center).

  ## Notes
  1. Both fields are nullable. NULL means "no focal point set yet" — treated as 50/50 in the UI.
  2. No RLS changes needed; existing vehicle RLS policies cover these new columns automatically.
  3. Safe to run multiple times due to IF NOT EXISTS guards.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vehicles' AND column_name = 'focal_point_x'
  ) THEN
    ALTER TABLE vehicles ADD COLUMN focal_point_x float DEFAULT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vehicles' AND column_name = 'focal_point_y'
  ) THEN
    ALTER TABLE vehicles ADD COLUMN focal_point_y float DEFAULT NULL;
  END IF;
END $$;
