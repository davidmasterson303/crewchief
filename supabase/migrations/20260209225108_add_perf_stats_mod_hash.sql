/*
  # Add performance stats mod hash tracking

  1. Modified Tables
    - `vehicles`
      - `perf_stats_mod_hash` (text) - stores a hash of mods considered in the last performance stats calculation
        so we know when to recalculate

  2. Notes
    - This enables auto-recalculation of performance stats when mods change
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vehicles' AND column_name = 'perf_stats_mod_hash'
  ) THEN
    ALTER TABLE vehicles ADD COLUMN perf_stats_mod_hash text DEFAULT '';
  END IF;
END $$;
