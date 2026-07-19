/*
  # Add Performance Modification Cache Table

  1. New Tables
    - `performance_mod_cache`
      - Stores pre-fetched mods for all performance goals per vehicle
      - `id` (uuid, primary key)
      - `vehicle_id` (uuid, foreign key to vehicles)
      - `performance_goal` (text, mild/moderate/aggressive)
      - `mods_data` (jsonb, array of mod objects with details)
      - `cached_at` (timestamptz, when cache was created)
      - Composite unique constraint on (vehicle_id, performance_goal)

  2. Purpose
    - Eliminate repeated API calls when switching performance goals
    - Pre-cache all mod options on first vehicle addition
    - Enable snappy goal switching with zero loading states
    - Store modification details alongside mods for instant access

  3. Security
    - Enable RLS on `performance_mod_cache` table
    - Add policy for authenticated users to read/write cache for their vehicles
    - Automatic cascade delete when vehicle is deleted
*/

CREATE TABLE IF NOT EXISTS performance_mod_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  performance_goal text NOT NULL CHECK (performance_goal IN ('mild', 'moderate', 'aggressive')),
  mods_data jsonb NOT NULL DEFAULT '[]'::jsonb,
  cached_at timestamptz DEFAULT now(),
  UNIQUE(vehicle_id, performance_goal)
);

ALTER TABLE performance_mod_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view mod cache for their vehicles"
  ON performance_mod_cache FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM vehicles
      WHERE vehicles.id = performance_mod_cache.vehicle_id
      AND vehicles.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert mod cache for their vehicles"
  ON performance_mod_cache FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM vehicles
      WHERE vehicles.id = performance_mod_cache.vehicle_id
      AND vehicles.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update mod cache for their vehicles"
  ON performance_mod_cache FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM vehicles
      WHERE vehicles.id = performance_mod_cache.vehicle_id
      AND vehicles.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM vehicles
      WHERE vehicles.id = performance_mod_cache.vehicle_id
      AND vehicles.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete mod cache for their vehicles"
  ON performance_mod_cache FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM vehicles
      WHERE vehicles.id = performance_mod_cache.vehicle_id
      AND vehicles.user_id = auth.uid()
    )
  );
