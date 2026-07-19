/*
  # Add Mod Tier Tracking and Backfill System

  ## Summary
  This migration extends the performance mod system to support an achievement-based tier progression
  model. Rather than letting users choose their performance tier freely, the tier is now earned by
  completing or acknowledging mods at each level.

  ## Changes

  ### Modified Tables

  #### modification_tracking
  - `tier` (text) — which tier (mild/moderate/aggressive) this mod belongs to
  - `is_backfill` (boolean) — whether this mod was AI-generated to replace a skipped mod
  - `backfill_reason` (text, nullable) — the skipped mod name that triggered this backfill

  #### vehicles
  - `earned_tier` (text) — the tier the owner has actually earned (computed, stored for perf)
    defaults to 'mild' so all vehicles start at the beginning

  ### New Tables

  #### tier_backfill_queue
  - Tracks pending backfill generation requests when mods are skipped
  - `vehicle_id`, `tier`, `skipped_mod_name`, `status` (pending/completed/failed), timestamps

  ## Security
  - RLS enabled on tier_backfill_queue
  - Policies restricted to authenticated users who own the vehicle

  ## Notes
  1. earned_tier is stored on vehicles for fast reads; recomputed on every mod status change
  2. is_backfill flag lets us distinguish AI-generated replacement mods from original suggestions
  3. Backfill queue enables async processing of replacement mod generation
*/

-- Add tier column to modification_tracking
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'modification_tracking' AND column_name = 'tier'
  ) THEN
    ALTER TABLE modification_tracking ADD COLUMN tier text DEFAULT 'mild' NOT NULL
      CHECK (tier IN ('mild', 'moderate', 'aggressive'));
  END IF;
END $$;

-- Add is_backfill column to modification_tracking
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'modification_tracking' AND column_name = 'is_backfill'
  ) THEN
    ALTER TABLE modification_tracking ADD COLUMN is_backfill boolean DEFAULT false NOT NULL;
  END IF;
END $$;

-- Add backfill_reason column to modification_tracking
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'modification_tracking' AND column_name = 'backfill_reason'
  ) THEN
    ALTER TABLE modification_tracking ADD COLUMN backfill_reason text;
  END IF;
END $$;

-- Add earned_tier column to vehicles
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vehicles' AND column_name = 'earned_tier'
  ) THEN
    ALTER TABLE vehicles ADD COLUMN earned_tier text DEFAULT 'mild' NOT NULL
      CHECK (earned_tier IN ('mild', 'moderate', 'aggressive'));
  END IF;
END $$;

-- Create tier_backfill_queue table
CREATE TABLE IF NOT EXISTS tier_backfill_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  tier text NOT NULL CHECK (tier IN ('mild', 'moderate', 'aggressive')),
  skipped_mod_name text NOT NULL,
  replacement_mod_name text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tier_backfill_queue_vehicle_tier_status
  ON tier_backfill_queue(vehicle_id, tier, status);

ALTER TABLE tier_backfill_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view backfill queue for their vehicles"
  ON tier_backfill_queue FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM vehicles
      WHERE vehicles.id = tier_backfill_queue.vehicle_id
      AND vehicles.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert backfill queue for their vehicles"
  ON tier_backfill_queue FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM vehicles
      WHERE vehicles.id = tier_backfill_queue.vehicle_id
      AND vehicles.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update backfill queue for their vehicles"
  ON tier_backfill_queue FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM vehicles
      WHERE vehicles.id = tier_backfill_queue.vehicle_id
      AND vehicles.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM vehicles
      WHERE vehicles.id = tier_backfill_queue.vehicle_id
      AND vehicles.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete backfill queue for their vehicles"
  ON tier_backfill_queue FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM vehicles
      WHERE vehicles.id = tier_backfill_queue.vehicle_id
      AND vehicles.user_id = auth.uid()
    )
  );

-- Service role can access all (needed for server-side backfill processing)
CREATE POLICY "Service role can manage all backfill queue"
  ON tier_backfill_queue FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
