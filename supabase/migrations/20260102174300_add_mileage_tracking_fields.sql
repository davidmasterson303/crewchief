/*
  # Add mileage tracking fields

  1. New Columns
    - `last_mileage_update_date` on `vehicles` table
      - Tracks when mileage was last updated
      - Allows calculation of estimated miles driven
      - Used to prompt for monthly mileage updates
  
  2. Purpose
    - Enable monthly mileage update reminders based on avg_miles_per_month
    - Users are prompted when estimated_miles_driven >= avg_miles_per_month
    - Supports proactive vehicle health monitoring
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vehicles' AND column_name = 'last_mileage_update_date'
  ) THEN
    ALTER TABLE vehicles ADD COLUMN last_mileage_update_date timestamptz DEFAULT now();
  END IF;
END $$;