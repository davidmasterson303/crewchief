/*
  # Add Performance Stats Manual Override Flag

  1. Changes
    - Adds `perf_stats_manual_override` boolean column to `vehicles` table
    - When true, the performance-stats API will not overwrite manually set HP/torque/0-60 values
    - This prevents the AI from overriding values that were explicitly set by the consultant

  2. Notes
    - Defaults to false (existing behavior unchanged)
    - Set to true when consultant uses [UPDATE_PERFORMANCE_STATS] action tag
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vehicles' AND column_name = 'perf_stats_manual_override'
  ) THEN
    ALTER TABLE vehicles ADD COLUMN perf_stats_manual_override boolean DEFAULT false;
  END IF;
END $$;
