/*
  # Create mod_names_cache table

  1. New Tables
    - `mod_names_cache`
      - `id` (uuid, primary key)
      - `vehicle_id` (uuid, foreign key to vehicles)
      - `performance_goal` (text, enum: mild|moderate|aggressive)
      - `mod_names` (jsonb, array of {name, difficulty, purpose})
      - `cached_at` (timestamptz)
      - `created_at` (timestamptz)

  2. Indexes
    - (vehicle_id, performance_goal) for fast lookups

  3. Security
    - Enable RLS on `mod_names_cache` table
    - Add policy for authenticated users to read their own data
    - Add policy for authenticated users to insert/update their own data
    - Add policy for authenticated users to delete their own data
*/

CREATE TABLE IF NOT EXISTS mod_names_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  performance_goal text NOT NULL CHECK (performance_goal IN ('mild', 'moderate', 'aggressive')),
  mod_names jsonb NOT NULL DEFAULT '[]'::jsonb,
  cached_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(vehicle_id, performance_goal)
);

CREATE INDEX IF NOT EXISTS idx_mod_names_cache_vehicle_goal 
  ON mod_names_cache(vehicle_id, performance_goal);

ALTER TABLE mod_names_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own mod names cache"
  ON mod_names_cache
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM vehicles
      WHERE vehicles.id = mod_names_cache.vehicle_id
      AND vehicles.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own mod names cache"
  ON mod_names_cache
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM vehicles
      WHERE vehicles.id = vehicle_id
      AND vehicles.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update own mod names cache"
  ON mod_names_cache
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM vehicles
      WHERE vehicles.id = mod_names_cache.vehicle_id
      AND vehicles.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM vehicles
      WHERE vehicles.id = vehicle_id
      AND vehicles.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own mod names cache"
  ON mod_names_cache
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM vehicles
      WHERE vehicles.id = mod_names_cache.vehicle_id
      AND vehicles.user_id = auth.uid()
    )
  );
